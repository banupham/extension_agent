'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const readline = require('readline');
const { WebSocketServer, WebSocket } = require('ws');

const HOST = process.env.TC_SOCKET_HOST || '127.0.0.1';
const PORT = Number(process.env.TC_SOCKET_PORT || 8765);
const DATA_DIR = path.resolve(process.env.TC_SOCKET_DATA_DIR || path.join(__dirname, '..', 'socket-data'));
const FINALIZE_GRACE_MS = Math.max(5000, Number(process.env.TC_SOCKET_FINALIZE_GRACE_MS || 45000));
const MAX_PAYLOAD = Math.max(1024 * 1024, Number(process.env.TC_SOCKET_MAX_PAYLOAD || 16 * 1024 * 1024));
const PIPELINE_ENABLED = process.env.TC_STRATEGY_PIPELINE_ENABLED !== '0';
const PIPELINE_BATCH_THRESHOLD = Math.max(1, Number(process.env.TC_STRATEGY_BATCH_THRESHOLD || 100));
const PIPELINE_AUTO_PROTECT = process.env.TC_STRATEGY_AUTO_PROTECT !== '0';
const BASE_DATASET_DIR = process.env.TC_STRATEGY_BASE_DATASET ? path.resolve(process.env.TC_STRATEGY_BASE_DATASET) : null;
const BASE_MODEL_FILE = process.env.TC_STRATEGY_BASE_MODEL ? path.resolve(process.env.TC_STRATEGY_BASE_MODEL) : null;
const PIPELINE_HEALTH_BASE = process.env.TC_STRATEGY_HEALTH_BASE || 'http://127.0.0.1:3000';
const PIPELINE_BROKER = process.env.TC_STRATEGY_BROKER || 'ws://127.0.0.1:3000';
const PIPELINE_AGENT_ID = process.env.TC_STRATEGY_AGENT_ID || null;
const PIPELINE_MINIMUM_BENCHMARK_SCORE = Number(process.env.TC_STRATEGY_MINIMUM_BENCHMARK_SCORE || 90);
const PIPELINE_TIMEOUT_MS = Math.max(1000, Number(process.env.TC_STRATEGY_PROTECTION_TIMEOUT_MS || 10000));
const PIPELINE_VERSION = '0.1.0';
const SUPPORTED_REVIEW_EXPORT_VERSIONS = new Set(['0.1.0', '0.2.0']);
const REVIEW_DIR = path.join(DATA_DIR, 'task-episode-reviews');
const PIPELINE_DIR = path.join(DATA_DIR, 'pipeline');
const RECEIPT_DIR = path.join(PIPELINE_DIR, 'receipts');
const CANDIDATE_DIR = path.join(PIPELINE_DIR, 'candidates');
const WORK_DIR = path.join(PIPELINE_DIR, 'work');
const PIPELINE_STATE_FILE = path.join(PIPELINE_DIR, 'state.json');
const sessions = new Map();
const socketClients = new Set();
const processingEpisodeIds = new Set();
let pipelineChain = Promise.resolve();
let pipelineState = null;

function nowIso() { return new Date().toISOString(); }
function safeName(value) { return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_'); }
function rawPath(sessionId) { return path.join(DATA_DIR, `${safeName(sessionId)}.raw.jsonl`); }
function metaPath(sessionId) { return path.join(DATA_DIR, `${safeName(sessionId)}.meta.json`); }
function taskReviewPath(episodeId) { return path.join(REVIEW_DIR, `${safeName(episodeId)}.task-episode-review.json`); }
function receiptPath(episodeId) { return path.join(RECEIPT_DIR, `${safeName(episodeId)}.machine-eligibility.json`); }
function sha256Text(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function reviewDigest(review) { return sha256Text(JSON.stringify(review || null)); }
function readJsonSync(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0)))); }

async function ensureDataDir() {
  await Promise.all([
    fsp.mkdir(DATA_DIR, { recursive: true }),
    fsp.mkdir(REVIEW_DIR, { recursive: true }),
    fsp.mkdir(RECEIPT_DIR, { recursive: true }),
    fsp.mkdir(CANDIDATE_DIR, { recursive: true }),
    fsp.mkdir(WORK_DIR, { recursive: true })
  ]);
}
async function atomicJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await fsp.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fsp.rename(temp, file);
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(String(error?.code || ''))) break;
      await delay(20 * (attempt + 1));
    }
  }
  if (process.platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(String(lastError?.code || ''))) {
    try {
      await fsp.copyFile(temp, file);
      await fsp.rm(temp, { force: true });
      return;
    } catch (error) { lastError = error; }
  }
  await fsp.rm(temp, { force: true }).catch(() => {});
  throw lastError || new Error('atomic_json_replace_failed');
}
function send(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(payload)); } catch {}
}
function broadcast(payload) { for (const ws of socketClients) send(ws, payload); }
function queuePipeline(job) { const next = pipelineChain.then(job); pipelineChain = next.catch(error => console.error('[collector] pipeline error', error)); return next; }
function strategyPipelineTools() { return require('../tools/prepare_incremental_strategy_learning.js'); }

function defaultPipelineState() {
  return {
    pipelineVersion: PIPELINE_VERSION,
    updatedAt: nowIso(),
    enabled: PIPELINE_ENABLED,
    batchThreshold: PIPELINE_BATCH_THRESHOLD,
    autoProtect: PIPELINE_AUTO_PROTECT,
    baseDatasetConfigured: !!BASE_DATASET_DIR,
    baseModelConfigured: !!BASE_MODEL_FILE,
    processedReviewCount: 0,
    counts: { accept: 0, quarantine: 0, reject: 0, duplicate: 0, error: 0 },
    unassignedAcceptCount: 0,
    pendingCandidate: null,
    lastResult: null,
    lastError: null
  };
}
async function loadPipelineState() {
  if (pipelineState) return pipelineState;
  let stored = null;
  try { stored = JSON.parse(await fsp.readFile(PIPELINE_STATE_FILE, 'utf8')); } catch {}
  pipelineState = {
    ...defaultPipelineState(),
    ...(stored && typeof stored === 'object' ? stored : {}),
    enabled: PIPELINE_ENABLED,
    batchThreshold: PIPELINE_BATCH_THRESHOLD,
    autoProtect: PIPELINE_AUTO_PROTECT,
    baseDatasetConfigured: !!BASE_DATASET_DIR,
    baseModelConfigured: !!BASE_MODEL_FILE
  };
  return pipelineState;
}
async function listMachineReceipts() {
  await ensureDataDir();
  const names = (await fsp.readdir(RECEIPT_DIR)).filter(name => /\.machine-eligibility\.json$/i.test(name)).sort();
  const rows = [];
  for (const name of names) { try { rows.push(JSON.parse(await fsp.readFile(path.join(RECEIPT_DIR, name), 'utf8'))); } catch {} }
  return rows;
}
async function refreshPipelineSummary() {
  const state = await loadPipelineState();
  const receipts = await listMachineReceipts();
  const counts = { accept: 0, quarantine: 0, reject: 0, duplicate: 0, error: 0 };
  for (const receipt of receipts) {
    const status = String(receipt?.status || 'error');
    if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
    else counts.error += 1;
  }
  const assigned = new Set(Array.isArray(state.pendingCandidate?.episodeIds) ? state.pendingCandidate.episodeIds : []);
  state.processedReviewCount = receipts.length;
  state.counts = counts;
  state.unassignedAcceptCount = receipts.filter(row => row?.status === 'accept' && !assigned.has(row.episodeId)).length;
  state.updatedAt = nowIso();
  await atomicJson(PIPELINE_STATE_FILE, state);
  return state;
}
function publicPipelineState(state) {
  const candidate = state?.pendingCandidate || null;
  return {
    pipelineVersion: state?.pipelineVersion || PIPELINE_VERSION,
    updatedAt: state?.updatedAt || null,
    enabled: state?.enabled !== false,
    batchThreshold: Number(state?.batchThreshold || PIPELINE_BATCH_THRESHOLD),
    autoProtect: state?.autoProtect !== false,
    baseDatasetConfigured: state?.baseDatasetConfigured === true,
    baseModelConfigured: state?.baseModelConfigured === true,
    processedReviewCount: Number(state?.processedReviewCount || 0),
    counts: state?.counts || { accept: 0, quarantine: 0, reject: 0, duplicate: 0, error: 0 },
    unassignedAcceptCount: Number(state?.unassignedAcceptCount || 0),
    candidate: candidate ? {
      batchId: candidate.batchId || null,
      status: candidate.status || null,
      episodeCount: Array.isArray(candidate.episodeIds) ? candidate.episodeIds.length : 0,
      modelVersion: candidate.modelVersion || null,
      modelSha256: candidate.modelSha256 || null,
      protectionPass: candidate.protectionPass === true,
      promotionApplied: false,
      createdAt: candidate.createdAt || null,
      lastError: candidate.lastError || null
    } : null,
    lastResult: state?.lastResult || null,
    lastError: state?.lastError || null,
    productionPromotionAllowed: false
  };
}
async function pipelineStatus() { return publicPipelineState(await refreshPipelineSummary()); }

function reviewSafety(review) {
  const reasons = [];
  if (!review || typeof review !== 'object' || Array.isArray(review)) reasons.push('review_object_required');
  const episodeId = String(review?.episodeId || '').trim();
  if (!episodeId) reasons.push('episode_id_required');
  if (!SUPPORTED_REVIEW_EXPORT_VERSIONS.has(String(review?.reviewExportVersion || '').trim())) reasons.push('unsupported_review_export_version');
  if (String(review?.finalOutcome?.status || '').toLowerCase() !== 'success') reasons.push('automatic_pipeline_accepts_success_outcome_only');
  const privacy = review?.privacy || {};
  for (const key of ['rawTextValuesStored', 'passwordValuesStored', 'cookiesStored', 'storageSecretsStored', 'authorizationDataStored']) {
    if (privacy[key] !== false) reasons.push(`privacy_flag_not_safe:${key}`);
  }
  for (const key of ['selectorsExported', 'tabIdExported', 'rawActionCoordinatesExported']) {
    if (privacy[key] !== false) reasons.push(`export_privacy_flag_not_safe:${key}`);
  }
  return { ok: reasons.length === 0, episodeId, reasons };
}

async function writeTransportRejectReceipt(review, reasons) {
  const episodeId = String(review?.episodeId || '').trim();
  if (!episodeId) return null;
  const file = receiptPath(episodeId);
  if (fs.existsSync(file)) return readJsonSync(file);
  const receipt = {
    pipelineReceiptVersion: PIPELINE_VERSION,
    episodeId,
    reviewSha256: reviewDigest(review),
    processedAt: nowIso(),
    status: 'reject',
    reasons: [...new Set(reasons || ['transport_review_rejected'])],
    sourceReview: null,
    machineEligibility: null,
    persistedUnsafeReview: false,
    productionPromotionApplied: false
  };
  await atomicJson(file, receipt);
  const state = await refreshPipelineSummary();
  state.lastResult = { episodeId, status: receipt.status, reasons: receipt.reasons, at: receipt.processedAt };
  state.lastError = null;
  await atomicJson(PIPELINE_STATE_FILE, state);
  return receipt;
}

async function classifyReviewFile(file) {
  const review = JSON.parse(await fsp.readFile(file, 'utf8'));
  const episodeId = String(review?.episodeId || '').trim();
  const existingReceiptFile = receiptPath(episodeId);
  if (fs.existsSync(existingReceiptFile)) return readJsonSync(existingReceiptFile);

  const digest = reviewDigest(review);
  const work = path.join(WORK_DIR, `${safeName(episodeId)}-${digest.slice(0, 10)}`);
  await fsp.rm(work, { recursive: true, force: true });
  let receipt;
  try {
    const tools = strategyPipelineTools();
    const prepared = tools.prepareIncrementalStrategyLearning({ reviewRoot: file, baseDatasetDir: BASE_DATASET_DIR, outputDir: work });
    const item = (prepared.machineEligibility?.items || []).find(row => String(row?.episodeId || '') === episodeId) || null;
    if (item) {
      receipt = {
        pipelineReceiptVersion: PIPELINE_VERSION,
        episodeId,
        reviewSha256: digest,
        processedAt: nowIso(),
        status: item.status,
        reasons: Array.isArray(item.reasons) ? item.reasons : [],
        sourceReview: path.relative(DATA_DIR, file),
        machineEligibility: item,
        machineEligibilityVersion: prepared.machineEligibility?.machineTrainingEligibilityVersion || null,
        persistedUnsafeReview: false,
        productionPromotionApplied: false
      };
    } else if (Number(prepared.bundle?.excludedPreviouslyProcessedCount || 0) > 0) {
      receipt = {
        pipelineReceiptVersion: PIPELINE_VERSION,
        episodeId,
        reviewSha256: digest,
        processedAt: nowIso(),
        status: 'duplicate',
        reasons: ['episode_already_present_in_base_dataset_or_exclusion_set'],
        sourceReview: path.relative(DATA_DIR, file),
        machineEligibility: null,
        machineEligibilityVersion: prepared.machineEligibility?.machineTrainingEligibilityVersion || null,
        persistedUnsafeReview: false,
        productionPromotionApplied: false
      };
    } else {
      receipt = {
        pipelineReceiptVersion: PIPELINE_VERSION,
        episodeId,
        reviewSha256: digest,
        processedAt: nowIso(),
        status: 'reject',
        reasons: ['machine_eligibility_record_missing'],
        sourceReview: path.relative(DATA_DIR, file),
        machineEligibility: null,
        machineEligibilityVersion: prepared.machineEligibility?.machineTrainingEligibilityVersion || null,
        persistedUnsafeReview: false,
        productionPromotionApplied: false
      };
    }
  } catch (error) {
    receipt = {
      pipelineReceiptVersion: PIPELINE_VERSION,
      episodeId,
      reviewSha256: digest,
      processedAt: nowIso(),
      status: 'error',
      reasons: ['machine_pipeline_processing_error'],
      error: String(error?.message || error),
      sourceReview: path.relative(DATA_DIR, file),
      machineEligibility: null,
      persistedUnsafeReview: false,
      productionPromotionApplied: false
    };
  } finally { await fsp.rm(work, { recursive: true, force: true }).catch(() => {}); }

  await atomicJson(existingReceiptFile, receipt);
  const state = await refreshPipelineSummary();
  state.lastResult = { episodeId, status: receipt.status, reasons: receipt.reasons, at: receipt.processedAt };
  state.lastError = receipt.status === 'error' ? receipt.error : null;
  await atomicJson(PIPELINE_STATE_FILE, state);
  return receipt;
}

async function acceptedUnassignedReceipts() {
  const state = await loadPipelineState();
  const assigned = new Set(Array.isArray(state.pendingCandidate?.episodeIds) ? state.pendingCandidate.episodeIds : []);
  return (await listMachineReceipts()).filter(row => row?.status === 'accept' && !assigned.has(row.episodeId)).sort((a, b) => String(a.processedAt || '').localeCompare(String(b.processedAt || '')));
}

async function maybeBuildCandidateUnlocked() {
  const state = await refreshPipelineSummary();
  if (!PIPELINE_ENABLED || state.pendingCandidate) return state.pendingCandidate;
  if (!BASE_DATASET_DIR || !BASE_MODEL_FILE) return null;
  if (!fs.existsSync(BASE_DATASET_DIR) || !fs.existsSync(BASE_MODEL_FILE)) {
    state.lastError = 'strategy_base_dataset_or_model_path_missing';
    await atomicJson(PIPELINE_STATE_FILE, state);
    return null;
  }
  const accepted = await acceptedUnassignedReceipts();
  if (accepted.length < PIPELINE_BATCH_THRESHOLD) return null;
  const selected = accepted.slice(0, PIPELINE_BATCH_THRESHOLD);
  const batchId = `machine-${Date.now()}-${sha256Text(selected.map(row => row.episodeId).join('|')).slice(0, 8)}`;
  const inputDir = path.join(WORK_DIR, `${batchId}-input`);
  const outputDir = path.join(CANDIDATE_DIR, batchId);
  await fsp.rm(inputDir, { recursive: true, force: true });
  await fsp.mkdir(inputDir, { recursive: true });

  try {
    for (const row of selected) {
      const source = taskReviewPath(row.episodeId);
      if (!fs.existsSync(source)) throw new Error(`accepted_review_missing:${row.episodeId}`);
      await fsp.copyFile(source, path.join(inputDir, path.basename(source)));
    }
    const tools = strategyPipelineTools();
    const prepared = tools.prepareIncrementalStrategyLearning({ reviewRoot: inputDir, baseDatasetDir: BASE_DATASET_DIR, outputDir });
    if (Number(prepared.bundle?.machineAcceptEpisodeCount || 0) < PIPELINE_BATCH_THRESHOLD) throw new Error(`candidate_batch_recheck_below_threshold:${prepared.bundle?.machineAcceptEpisodeCount || 0}/${PIPELINE_BATCH_THRESHOLD}`);

    let finalized = tools.finalizeMachineAcceptedStrategyLearning(prepared, { baseDatasetDir: BASE_DATASET_DIR, baseModelFile: BASE_MODEL_FILE });
    let protectionError = null;
    if (PIPELINE_AUTO_PROTECT) {
      try {
        finalized = await tools.protectFinalizedCandidate(finalized, {
          baseModelFile: BASE_MODEL_FILE,
          outputDir,
          agentId: PIPELINE_AGENT_ID,
          healthBase: PIPELINE_HEALTH_BASE,
          broker: PIPELINE_BROKER,
          timeoutMs: PIPELINE_TIMEOUT_MS,
          minimumBenchmarkScore: PIPELINE_MINIMUM_BENCHMARK_SCORE,
          allowedTotalRegression: 0,
          allowedDimensionRegression: 0
        });
      } catch (error) {
        protectionError = String(error?.message || error);
        await atomicJson(path.join(outputDir, 'candidate-protection-error.json'), { failedAt: nowIso(), error: protectionError, productionPromotionApplied: false });
      }
    }

    const acceptedEpisodeIds = Array.isArray(prepared.machineEligibility?.machineAcceptEpisodeIds) ? prepared.machineEligibility.machineAcceptEpisodeIds : selected.map(row => row.episodeId);
    const candidateStatus = protectionError ? 'candidate-protection-error' : String(finalized.finalManifest?.status || 'candidate-awaiting-runtime-protection');
    pipelineState = await loadPipelineState();
    pipelineState.pendingCandidate = {
      batchId,
      createdAt: nowIso(),
      status: candidateStatus,
      episodeIds: acceptedEpisodeIds,
      modelVersion: finalized.finalManifest?.candidateModel?.modelVersion || finalized.candidate?.model?.modelVersion || null,
      modelSha256: finalized.finalManifest?.candidateModel?.sha256 || finalized.candidate?.modelHash || null,
      candidateModel: finalized.candidate?.modelFile ? path.relative(DATA_DIR, finalized.candidate.modelFile) : null,
      finalManifest: finalized.finalManifestFile ? path.relative(DATA_DIR, finalized.finalManifestFile) : null,
      protectionPass: finalized.protection?.pass === true,
      protectionStatus: finalized.protection?.status || null,
      lastError: protectionError,
      promotionApplied: false
    };
    pipelineState.lastError = protectionError;
    pipelineState.lastResult = { episodeId: null, status: candidateStatus, reasons: protectionError ? ['candidate_protection_error'] : ['candidate_batch_built'], at: nowIso() };
    await refreshPipelineSummary();
    await atomicJson(PIPELINE_STATE_FILE, pipelineState);
    console.log(`[collector] candidate ${batchId} status=${candidateStatus} episodes=${acceptedEpisodeIds.length}`);
    return pipelineState.pendingCandidate;
  } catch (error) {
    const stateAfterError = await loadPipelineState();
    stateAfterError.lastError = String(error?.message || error);
    stateAfterError.lastResult = { episodeId: null, status: 'candidate-build-error', reasons: ['candidate_build_error'], at: nowIso() };
    await atomicJson(PIPELINE_STATE_FILE, stateAfterError);
    console.error('[collector] candidate build error', error);
    return null;
  } finally { await fsp.rm(inputDir, { recursive: true, force: true }).catch(() => {}); }
}

function scheduleReviewProcessing(file) {
  const episodeId = safeName(path.basename(file).replace(/\.task-episode-review\.json$/i, ''));
  if (processingEpisodeIds.has(episodeId)) return;
  processingEpisodeIds.add(episodeId);
  queuePipeline(async () => {
    try {
      const receipt = await classifyReviewFile(file);
      await maybeBuildCandidateUnlocked();
      const pipeline = await pipelineStatus();
      broadcast({ type: 'task-episode-review-result', protocol: 'training-collector-v1', episodeId: receipt.episodeId, status: receipt.status, reasons: receipt.reasons || [], pipeline });
    } finally { processingEpisodeIds.delete(episodeId); }
  }).catch(() => {});
}

async function recoverPipelineBacklog() {
  if (!PIPELINE_ENABLED) return 0;
  await ensureDataDir();
  const names = (await fsp.readdir(REVIEW_DIR)).filter(name => /\.task-episode-review\.json$/i.test(name)).sort();
  let scheduled = 0;
  for (const name of names) {
    const file = path.join(REVIEW_DIR, name);
    let episodeId = null;
    try { episodeId = String(JSON.parse(await fsp.readFile(file, 'utf8'))?.episodeId || '').trim(); } catch {}
    if (!episodeId || fs.existsSync(receiptPath(episodeId))) continue;
    scheduleReviewProcessing(file); scheduled += 1;
  }
  queuePipeline(() => maybeBuildCandidateUnlocked()).catch(() => {});
  return scheduled;
}

async function receiveTaskReview(ws, message) {
  const review = message?.review;
  const safety = reviewSafety(review);
  if (!safety.ok) {
    const receipt = await writeTransportRejectReceipt(review, safety.reasons);
    const pipeline = await pipelineStatus();
    send(ws, { type: 'task-episode-review-ack', protocol: 'training-collector-v1', episodeId: safety.episodeId || String(message?.episodeId || ''), persisted: false, permanent: true, status: receipt?.status || 'reject', reasons: safety.reasons, pipeline });
    if (receipt) broadcast({ type: 'task-episode-review-result', protocol: 'training-collector-v1', episodeId: receipt.episodeId, status: receipt.status, reasons: receipt.reasons, pipeline });
    return;
  }

  const episodeId = safety.episodeId;
  const file = taskReviewPath(episodeId);
  const incomingDigest = reviewDigest(review);
  let duplicate = false;
  if (fs.existsSync(file)) {
    const existing = JSON.parse(await fsp.readFile(file, 'utf8'));
    const existingDigest = reviewDigest(existing);
    if (existingDigest !== incomingDigest) {
      send(ws, { type: 'task-episode-review-ack', protocol: 'training-collector-v1', episodeId, persisted: false, permanent: true, conflict: true, status: 'reject', reasons: ['episode_review_digest_conflict'], pipeline: await pipelineStatus() });
      return;
    }
    duplicate = true;
  } else { await atomicJson(file, review); }

  const priorReceipt = fs.existsSync(receiptPath(episodeId)) ? readJsonSync(receiptPath(episodeId)) : null;
  send(ws, { type: 'task-episode-review-ack', protocol: 'training-collector-v1', episodeId, persisted: true, permanent: false, duplicate, status: priorReceipt?.status || 'queued', reviewSha256: incomingDigest, pipeline: await pipelineStatus() });
  if (!priorReceipt && PIPELINE_ENABLED) scheduleReviewProcessing(file);
}

async function scanRawState(sessionId) {
  const file = rawPath(sessionId); let lastSeq = 0, eventCount = 0, hasSessionHeader = false;
  try {
    const input = fs.createReadStream(file, { encoding: 'utf8' });
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let record; try { record = JSON.parse(line); } catch { continue; }
      if (record.recordType === 'session') hasSessionHeader = true;
      if (record.recordType !== 'event') continue;
      const seq = Number(record.sessionSeq || 0); if (Number.isFinite(seq) && seq > lastSeq) lastSeq = seq; eventCount += 1;
    }
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  return { lastSeq, eventCount, hasSessionHeader };
}

async function loadSession(sessionId) {
  if (sessions.has(sessionId)) return sessions.get(sessionId);
  await ensureDataDir();
  let meta = null; try { meta = JSON.parse(await fsp.readFile(metaPath(sessionId), 'utf8')); } catch {}
  const scanned = await scanRawState(sessionId);
  const state = {
    sessionId,
    session: meta?.session || null,
    lastSeq: Math.max(Number(meta?.lastSeq || 0), scanned.lastSeq),
    eventCount: Math.max(Number(meta?.eventCount || 0), scanned.eventCount),
    hasSessionHeader: scanned.hasSessionHeader,
    status: meta?.status || 'open',
    connectedClients: new Set(),
    finalizeTimer: null,
    chain: Promise.resolve(),
    updatedAt: meta?.updatedAt || null,
    endedAt: meta?.endedAt || null,
    endReason: meta?.endReason || null
  };
  sessions.set(sessionId, state); return state;
}
function publicMeta(state) { return { protocol: 'training-collector-v1', sessionId: state.sessionId, session: state.session, lastSeq: state.lastSeq, eventCount: state.eventCount, status: state.status, updatedAt: state.updatedAt, endedAt: state.endedAt, endReason: state.endReason }; }
async function persistMeta(state) { state.updatedAt = nowIso(); await atomicJson(metaPath(state.sessionId), publicMeta(state)); }
async function appendRecord(state, record) { await fsp.appendFile(rawPath(state.sessionId), `${JSON.stringify(record)}\n`, 'utf8'); }
function queueState(state, job) { const next = state.chain.then(job); state.chain = next.catch(() => {}); return next; }

async function openSession(ws, message) {
  const session = message?.session; if (!session?.sessionId) throw new Error('missing_session_id');
  const state = await loadSession(String(session.sessionId));
  if (state.finalizeTimer) clearTimeout(state.finalizeTimer);
  state.finalizeTimer = null; state.connectedClients.add(ws); ws.sessionIds.add(state.sessionId); state.session = session;
  await queueState(state, async () => {
    if (!state.hasSessionHeader) { await appendRecord(state, { recordType: 'session', protocol: 'training-collector-v1', receivedAt: nowIso(), session }); state.hasSessionHeader = true; }
    else if (state.status !== 'open') await appendRecord(state, { recordType: 'session-resume', protocol: 'training-collector-v1', receivedAt: nowIso(), sessionId: state.sessionId, previousStatus: state.status });
    state.status = 'open'; state.endedAt = null; state.endReason = null; await persistMeta(state);
  });
  send(ws, { type: 'session-ack', protocol: 'training-collector-v1', sessionId: state.sessionId, resumeFromSeq: state.lastSeq });
}

async function appendBatch(ws, message) {
  const sessionId = String(message?.sessionId || ''); if (!sessionId) throw new Error('missing_session_id');
  const events = Array.isArray(message?.events) ? message.events : [], state = await loadSession(sessionId);
  state.connectedClients.add(ws); ws.sessionIds.add(sessionId);
  await queueState(state, async () => {
    const lines = []; let cursor = state.lastSeq;
    for (const event of events) {
      const seq = Number(event?.sessionSeq || 0); if (!Number.isInteger(seq) || seq <= 0 || seq <= cursor) continue;
      if (seq !== cursor + 1) { send(ws, { type: 'resync', protocol: 'training-collector-v1', sessionId, resumeFromSeq: state.lastSeq, expectedSeq: state.lastSeq + 1, receivedSeq: seq }); return; }
      lines.push(JSON.stringify({ recordType: 'event', ...event })); cursor = seq;
    }
    if (lines.length) { await fsp.appendFile(rawPath(sessionId), `${lines.join('\n')}\n`, 'utf8'); state.lastSeq = cursor; state.eventCount += lines.length; state.status = 'open'; await persistMeta(state); }
    send(ws, { type: 'batch-ack', protocol: 'training-collector-v1', sessionId, lastSeq: state.lastSeq, appended: lines.length });
  });
}

async function finalizeSession(state, details = {}) {
  await queueState(state, async () => {
    const expectedLastSeq = Number(details.expectedLastSeq || 0);
    if (expectedLastSeq > state.lastSeq || (state.status === 'closed' && expectedLastSeq <= state.lastSeq)) return;
    state.status = 'closed'; state.endedAt = details.endedAt || nowIso(); state.endReason = details.reason || 'socket_disconnect_grace_elapsed';
    await appendRecord(state, { recordType: 'session-end', protocol: 'training-collector-v1', sessionId: state.sessionId, endedAt: state.endedAt, reason: state.endReason, lastSeq: state.lastSeq, eventCount: state.eventCount });
    await persistMeta(state);
    console.log(`[collector] finalized ${state.sessionId} events=${state.eventCount} lastSeq=${state.lastSeq} reason=${state.endReason}`);
  });
}
async function closeSession(ws, message) {
  const sessionId = String(message?.sessionId || ''); if (!sessionId) throw new Error('missing_session_id');
  const state = await loadSession(sessionId), expectedLastSeq = Number(message?.expectedLastSeq || 0);
  if (expectedLastSeq > state.lastSeq) { send(ws, { type: 'resync', protocol: 'training-collector-v1', sessionId, resumeFromSeq: state.lastSeq }); return; }
  await finalizeSession(state, { expectedLastSeq, endedAt: message?.endedAt || nowIso(), reason: message?.reason || 'browser_session_closed' });
  send(ws, { type: 'session-closed', protocol: 'training-collector-v1', sessionId, lastSeq: state.lastSeq });
}
function scheduleDisconnectFinalize(state) {
  if (state.finalizeTimer || state.connectedClients.size > 0) return;
  state.finalizeTimer = setTimeout(() => {
    state.finalizeTimer = null;
    if (state.connectedClients.size > 0) return;
    finalizeSession(state, { expectedLastSeq: state.lastSeq, endedAt: nowIso(), reason: 'socket_disconnect_grace_elapsed' }).catch(error => console.error('[collector] finalize error', error));
  }, FINALIZE_GRACE_MS);
}

async function main() {
  await ensureDataDir();
  await refreshPipelineSummary();
  const wss = new WebSocketServer({ host: HOST, port: PORT, maxPayload: MAX_PAYLOAD, path: '/training-collector' });
  wss.on('connection', (ws, request) => {
    ws.sessionIds = new Set(); socketClients.add(ws); console.log(`[collector] connected ${request.socket.remoteAddress}`);
    ws.on('message', async data => {
      let message; try { message = JSON.parse(String(data)); } catch { return send(ws, { type: 'error', error: 'invalid_json' }); }
      try {
        if (message?.protocol && message.protocol !== 'training-collector-v1') throw new Error('unsupported_protocol');
        if (message.type === 'client-hello') { send(ws, { type: 'client-hello-ack', protocol: 'training-collector-v1', at: nowIso() }); return send(ws, { type: 'pipeline-status', protocol: 'training-collector-v1', pipeline: await pipelineStatus() }); }
        if (message.type === 'heartbeat') return send(ws, { type: 'heartbeat-ack', protocol: 'training-collector-v1', at: nowIso() });
        if (message.type === 'pipeline-status-request') return send(ws, { type: 'pipeline-status', protocol: 'training-collector-v1', pipeline: await pipelineStatus() });
        if (message.type === 'task-episode-review') return await receiveTaskReview(ws, message);
        if (message.type === 'session-open') return await openSession(ws, message);
        if (message.type === 'event-batch') return await appendBatch(ws, message);
        if (message.type === 'session-close') return await closeSession(ws, message);
        send(ws, { type: 'error', error: 'unknown_message_type' });
      } catch (error) { console.error('[collector] message error', error); send(ws, { type: 'error', error: String(error?.message || error) }); }
    });
    ws.on('close', () => {
      console.log('[collector] disconnected'); socketClients.delete(ws);
      for (const sessionId of ws.sessionIds) { const state = sessions.get(sessionId); if (!state) continue; state.connectedClients.delete(ws); scheduleDisconnectFinalize(state); }
    });
  });
  console.log(`[collector] listening ws://${HOST}:${PORT}/training-collector`);
  console.log(`[collector] data ${DATA_DIR}`);
  console.log(`[collector] disconnect finalize grace ${FINALIZE_GRACE_MS} ms`);
  console.log(`[collector] strategy pipeline enabled=${PIPELINE_ENABLED} threshold=${PIPELINE_BATCH_THRESHOLD} baseDataset=${!!BASE_DATASET_DIR} baseModel=${!!BASE_MODEL_FILE} autoProtect=${PIPELINE_AUTO_PROTECT}`);
  recoverPipelineBacklog().catch(error => console.error('[collector] backlog recovery error', error));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
