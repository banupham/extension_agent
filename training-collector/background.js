'use strict';

importScripts('core/episode_builder.js', 'core/raw_session_store.js', 'core/indexeddb_chunk_store.js');

const EPISODE_STATE_KEY = 'trainingCollectorStateV03';
const AUTO_EXPORT_ALARM = 'training-collector-v072-auto-export';
const AUTO_EXPORT_SCOPE = 'TRAINING_COLLECTOR_OFFSCREEN_V06';
const AUTO_EXPORT_MAX_ATTEMPTS = 5;
const RECENT_SESSION_LIMIT = 20;
const EpisodeBuilder = globalThis.TrainingCollectorV02.EpisodeBuilder;
const RawStore = globalThis.TrainingCollectorV03.RawSessionStore;
const ChunkStore = globalThis.TrainingCollectorV06.IndexedDbChunkStore.createChunkStore({ chunkSize: RawStore.CHUNK_SIZE });
const EMPTY = { active: false, episode: null };
const autoExportInFlight = new Set();
let browserSessionInitPromise = null;
let rawAppendChain = Promise.resolve();

function nowIso() { return new Date().toISOString(); }
function scheduleAutoExportRetry(delayMinutes = 0.5) {
  try { chrome.alarms.create(AUTO_EXPORT_ALARM, { delayInMinutes: Math.max(0.5, Number(delayMinutes || 0.5)) }); } catch {}
}

async function loadEpisodeState() {
  const data = await chrome.storage.local.get(EPISODE_STATE_KEY);
  return data[EPISODE_STATE_KEY] || { ...EMPTY };
}
async function saveEpisodeState(state) { await chrome.storage.local.set({ [EPISODE_STATE_KEY]: state }); return state; }
async function activeTab() { const tabs = await chrome.tabs.query({ active: true, currentWindow: true }); return tabs[0] || null; }
async function requestSnapshot(tabId) {
  try { return await chrome.tabs.sendMessage(tabId, { scope: 'TRAINING_COLLECTOR_V03', type: 'SNAPSHOT' }); }
  catch (error) { return { ok: false, error: String(error?.message || error) }; }
}

async function closeDanglingSessions() {
  const sessions = await ChunkStore.listSessionsByStatus('active', 500);
  const closed = [];
  for (const session of sessions) {
    const integrity = await ChunkStore.verifySession(session, { tailCount: 3 }).catch(error => ({ ok: false, problems: [{ code: 'verification_error', error: String(error?.message || error) }] }));
    session.status = 'closed-inferred';
    session.endedAt = session.lastSeenAt || session.startedAt || nowIso();
    session.endReason = 'previous_browser_session_no_longer_active';
    session.integrity = { ...integrity, verifiedAt: nowIso(), scope: 'tail' };
    session.autoExport = session.autoExport || { status: 'pending', attempts: 0 };
    if (!session.autoExport.status || ['verifying', 'preparing-download', 'downloading'].includes(session.autoExport.status)) {
      session.autoExport.status = 'pending';
      session.autoExport.recoveredAt = nowIso();
    }
    await ChunkStore.putSession(session);
    closed.push(session);
  }
  return closed;
}

async function hasOffscreenDocument() {
  if (typeof chrome.runtime.getContexts !== 'function') return false;
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL('offscreen.html')] });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen?.createDocument) throw new Error('offscreen_api_unavailable');
  if (await hasOffscreenDocument()) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Temporary development auto-export of closed raw sessions as gzip JSONL.'
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (!/single offscreen|already exists/i.test(message)) throw error;
  }
}

function recoverableAutoExport(session, force = false) {
  if (!session || session.status === 'active' || Number(session.eventCount || 0) <= 0) return false;
  const state = session.autoExport?.status || 'pending';
  if (state === 'complete' || state === 'skipped-empty') return false;
  if (!force && Number(session.autoExport?.attempts || 0) >= AUTO_EXPORT_MAX_ATTEMPTS) return false;
  return true;
}

async function autoExportSession(sessionId, options = {}) {
  const force = !!options.force;
  if (autoExportInFlight.has(sessionId)) return { skipped: true, reason: 'already_in_flight' };
  autoExportInFlight.add(sessionId);
  let session = null;
  try {
    session = await ChunkStore.getSession(sessionId);
    if (!session || session.status === 'active') return { skipped: true, reason: 'session_not_closed' };
    if (Number(session.eventCount || 0) <= 0) {
      session.autoExport = { ...(session.autoExport || {}), status: 'skipped-empty', attempts: Number(session.autoExport?.attempts || 0), updatedAt: nowIso() };
      await ChunkStore.putSession(session);
      return { skipped: true, reason: 'empty_session' };
    }
    if (session.autoExport?.status === 'complete' && !force) return { skipped: true, reason: 'already_exported' };
    const attempts = Number(session.autoExport?.attempts || 0);
    if (!force && attempts >= AUTO_EXPORT_MAX_ATTEMPTS) return { skipped: true, reason: 'attempt_limit' };

    session.autoExport = {
      ...(session.autoExport || {}),
      status: 'verifying',
      attempts: attempts + 1,
      attemptedAt: nowIso(),
      error: null,
      temporaryDevelopmentAdapter: true
    };
    await ChunkStore.putSession(session);

    const integrity = await ChunkStore.verifySession(session, { full: true, tailCount: 3 });
    session.integrity = { ...integrity, verifiedAt: nowIso(), scope: 'full' };
    session.autoExport = { ...session.autoExport, status: 'preparing-download', integrityOk: !!integrity.ok };
    await ChunkStore.putSession(session);

    await ensureOffscreenDocument();
    const result = await chrome.runtime.sendMessage({ scope: AUTO_EXPORT_SCOPE, type: 'AUTO_EXPORT_SESSION', sessionId: session.sessionId });
    if (!result?.ok) throw new Error(result?.error || 'offscreen_auto_export_failed');

    session = await ChunkStore.getSession(session.sessionId) || session;
    session.autoExport = {
      ...(session.autoExport || {}),
      status: 'complete',
      completedAt: nowIso(),
      downloadId: result.downloadId ?? null,
      byteLength: Number(result.byteLength || 0),
      eventCount: Number(result.eventCount || session.eventCount || 0),
      downloadState: result.downloadState || 'complete',
      error: null,
      temporaryDevelopmentAdapter: true
    };
    await ChunkStore.putSession(session);
    return { ok: true, sessionId: session.sessionId, downloadId: result.downloadId ?? null };
  } catch (error) {
    if (session?.sessionId) {
      session = await ChunkStore.getSession(session.sessionId) || session;
      session.autoExport = {
        ...(session.autoExport || {}),
        status: 'failed',
        failedAt: nowIso(),
        error: String(error?.message || error),
        temporaryDevelopmentAdapter: true
      };
      await ChunkStore.putSession(session);
      if (Number(session.autoExport.attempts || 0) < AUTO_EXPORT_MAX_ATTEMPTS) scheduleAutoExportRetry(0.5);
      return { ok: false, sessionId: session.sessionId, error: session.autoExport.error };
    }
    return { ok: false, sessionId, error: String(error?.message || error) };
  } finally {
    autoExportInFlight.delete(sessionId);
  }
}

async function autoExportClosedSessions(extraSessions = []) {
  const candidates = new Map();
  for (const session of extraSessions || []) if (session?.sessionId) candidates.set(session.sessionId, session);
  for (const status of ['closed-inferred', 'closed']) {
    for (const session of await ChunkStore.listSessionsByStatus(status, 500)) candidates.set(session.sessionId, session);
  }
  const results = [];
  for (const session of candidates.values()) {
    if (!recoverableAutoExport(session)) continue;
    results.push(await autoExportSession(session.sessionId));
  }
  return results;
}

async function recentSessions() {
  return (await ChunkStore.listSessions(RECENT_SESSION_LIMIT)).map(session => ({
    sessionId: session.sessionId,
    schemaVersion: session.schemaVersion,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    eventCount: Number(session.eventCount || 0),
    chunkCount: Number(session.chunkCount || 0),
    integrity: session.integrity || null,
    autoExport: session.autoExport || { status: session.status === 'active' ? 'not-applicable-active' : 'pending', attempts: 0 }
  }));
}

async function createBrowserSession() {
  const closed = await closeDanglingSessions();
  const startedAt = nowIso();
  const session = RawStore.createSession(RawStore.makeSessionId(), startedAt);
  session.integrity = { ok: true, verifiedAt: null, scope: 'not-yet-verified' };
  await ChunkStore.putSession(session);
  await chrome.storage.session.set({ [RawStore.CURRENT_SESSION_KEY]: session.sessionId });
  autoExportClosedSessions(closed).catch(() => scheduleAutoExportRetry(0.5));
  return session;
}

async function ensureBrowserSessionUnlocked() {
  const current = await chrome.storage.session.get(RawStore.CURRENT_SESSION_KEY);
  const sessionId = current[RawStore.CURRENT_SESSION_KEY];
  if (sessionId) {
    const session = await ChunkStore.getSession(sessionId);
    if (session?.status === 'active' && session.schemaVersion === RawStore.VERSION) return session;
    if (session?.status === 'active' && session.schemaVersion !== RawStore.VERSION) {
      session.status = 'closed';
      session.endedAt = nowIso();
      session.endReason = `schema_upgrade_to_${RawStore.VERSION}`;
      session.autoExport = session.autoExport || { status: 'pending', attempts: 0 };
      await ChunkStore.putSession(session);
      await chrome.storage.session.remove(RawStore.CURRENT_SESSION_KEY);
      autoExportClosedSessions([session]).catch(() => scheduleAutoExportRetry(0.5));
    }
  }
  return createBrowserSession();
}
async function ensureBrowserSession() {
  if (!browserSessionInitPromise) browserSessionInitPromise = ensureBrowserSessionUnlocked().finally(() => { browserSessionInitPromise = null; });
  return browserSessionInitPromise;
}

function eventLastSeenIso(events) {
  let max = 0;
  for (const event of events || []) {
    const ts = Number(event?.tsEpochMs || 0);
    if (Number.isFinite(ts)) max = Math.max(max, ts);
  }
  return max > 0 ? new Date(max).toISOString() : nowIso();
}

async function appendRawBatchUnlocked(sender, batch) {
  const session = await ensureBrowserSession();
  const incoming = Array.isArray(batch?.events) ? batch.events : [];
  const batchId = typeof batch?.batchId === 'string' ? batch.batchId : null;
  if (!incoming.length) return { ok: true, ack: true, batchId, sessionId: session.sessionId, appended: 0 };
  const captureSource = typeof batch?.source === 'string' ? batch.source : 'unknown';
  let seq = Number(session.eventCount || 0);
  const normalizedEvents = [];
  for (const raw of incoming) {
    const normalized = RawStore.normalizeEvent(raw);
    if (!normalized) continue;
    seq += 1;
    normalizedEvents.push({
      ...normalized,
      captureSource,
      sessionSeq: seq,
      tabId: sender.tab?.id ?? null,
      windowId: sender.tab?.windowId ?? null,
      frameId: sender.frameId ?? 0,
      documentId: sender.documentId || null,
      documentLifecycle: sender.documentLifecycle || null
    });
  }
  if (!normalizedEvents.length) return { ok: true, ack: true, batchId, sessionId: session.sessionId, appended: 0 };
  const candidate = { ...session, eventCount: seq, lastSeenAt: eventLastSeenIso(incoming), integrity: { ok: true, verifiedAt: null, scope: 'pending-after-write' } };
  const result = await ChunkStore.append(candidate, normalizedEvents, batchId);
  return { ok: true, ack: true, batchId, sessionId: session.sessionId, duplicate: !!result.duplicate, appended: result.duplicate ? 0 : normalizedEvents.length, eventCount: Number(result.session?.eventCount || session.eventCount || 0) };
}
function appendRawBatch(sender, batch) {
  const job = rawAppendChain.then(() => appendRawBatchUnlocked(sender, batch));
  rawAppendChain = job.catch(() => {});
  return job;
}

async function rawPreview(sessionId, limit = 100) {
  await rawAppendChain;
  const session = await ChunkStore.getSession(sessionId);
  if (!session) return { session: null, events: [] };
  return { session, events: await ChunkStore.getTail(session, Math.max(1, Math.min(500, Number(limit || 100)))) };
}
async function exportMeta(sessionId) {
  await rawAppendChain;
  const session = await ChunkStore.getSession(sessionId);
  if (!session) throw new Error('raw_session_not_found');
  return { exportVersion: session.schemaVersion || RawStore.VERSION, exportedAt: nowIso(), session };
}
async function exportChunk(sessionId, chunkIndex) {
  await rawAppendChain;
  const session = await ChunkStore.getSession(sessionId);
  if (!session) throw new Error('raw_session_not_found');
  const index = Number(chunkIndex);
  if (!Number.isInteger(index) || index < 0 || index >= Number(session.chunkCount || 0)) throw new Error('raw_chunk_out_of_range');
  const record = await ChunkStore.getChunkRecord(sessionId, index);
  if (!record) throw new Error('raw_chunk_missing');
  return { chunkIndex: index, checksum: record.checksum || null, firstSeq: record.firstSeq || null, lastSeq: record.lastSeq || null, events: Array.isArray(record.events) ? record.events : [] };
}
async function verifyRawSession(sessionId, full = false) {
  await rawAppendChain;
  const session = await ChunkStore.getSession(sessionId);
  if (!session) throw new Error('raw_session_not_found');
  const integrity = await ChunkStore.verifySession(session, { full: !!full, tailCount: 3 });
  session.integrity = { ...integrity, verifiedAt: nowIso(), scope: full ? 'full' : 'tail' };
  await ChunkStore.putSession(session);
  return { session, integrity };
}

async function startEpisode(task) {
  const tab = await activeTab();
  if (!tab?.id || !/^https?:/i.test(tab.url || '')) throw new Error('Open a normal http/https page before starting an episode');
  const initial = await requestSnapshot(tab.id);
  const state = { active: true, episode: EpisodeBuilder.createEpisode({ task, tabId: tab.id, initialObservation: initial?.observation || null, now: nowIso() }) };
  await saveEpisodeState(state);
  await chrome.tabs.sendMessage(tab.id, { scope: 'TRAINING_COLLECTOR_V03', type: 'START_EPISODE_CAPTURE' }).catch(() => {});
  return state;
}
async function stopEpisode(outcome) {
  const state = await loadEpisodeState();
  if (!state.active || !state.episode) return state;
  const tabId = state.episode.tabId;
  if (tabId) await chrome.tabs.sendMessage(tabId, { scope: 'TRAINING_COLLECTOR_V03', type: 'STOP_EPISODE_CAPTURE' }).catch(() => {});
  state.active = false;
  state.episode.endedAt = nowIso();
  state.episode.finalOutcome = outcome || { status: 'stopped' };
  return saveEpisodeState(state);
}
async function transitionStart(sender, transition) {
  const state = await loadEpisodeState();
  if (sender.frameId !== 0 || !state.active || !state.episode || sender.tab?.id !== state.episode.tabId) return { ok: true, ignored: true };
  EpisodeBuilder.beginTransition(state.episode, transition || {});
  EpisodeBuilder.capTransitions(state.episode);
  await saveEpisodeState(state);
  return { ok: true };
}
async function transitionEnd(sender, transition) {
  const state = await loadEpisodeState();
  if (sender.frameId !== 0 || !state.active || !state.episode || sender.tab?.id !== state.episode.tabId) return { ok: true, ignored: true };
  const matched = EpisodeBuilder.finishTransition(state.episode, transition || {});
  await saveEpisodeState(state);
  return { ok: true, matched };
}

function bootstrap() {
  ensureBrowserSession().then(() => autoExportClosedSessions()).catch(() => scheduleAutoExportRetry(0.5));
}
chrome.runtime.onStartup.addListener(bootstrap);
chrome.runtime.onInstalled.addListener(bootstrap);
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm?.name !== AUTO_EXPORT_ALARM) return;
  autoExportClosedSessions().catch(() => scheduleAutoExportRetry(1));
});
bootstrap();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.scope !== 'TRAINING_COLLECTOR_V03') return false;
  (async () => {
    if (message.type === 'HELLO') {
      const session = await ensureBrowserSession();
      const episodeState = await loadEpisodeState();
      return {
        ok: true,
        browserSessionId: session.sessionId,
        episodeActive: sender.frameId === 0 && !!episodeState.active && episodeState.episode?.tabId === sender.tab?.id,
        frameId: sender.frameId ?? 0,
        documentId: sender.documentId || null
      };
    }
    if (message.type === 'RAW_BATCH') return appendRawBatch(sender, message.batch || {});
    if (message.type === 'GET_RAW_STATUS') return { ok: true, session: await ensureBrowserSession() };
    if (message.type === 'GET_RAW_PREVIEW') { const current = await ensureBrowserSession(); return { ok: true, ...(await rawPreview(message.sessionId || current.sessionId, message.limit || 100)) }; }
    if (message.type === 'GET_RAW_EXPORT_META') { const current = await ensureBrowserSession(); return { ok: true, data: await exportMeta(message.sessionId || current.sessionId) }; }
    if (message.type === 'GET_RAW_EXPORT_CHUNK') { const current = await ensureBrowserSession(); return { ok: true, data: await exportChunk(message.sessionId || current.sessionId, message.chunkIndex) }; }
    if (message.type === 'VERIFY_RAW_SESSION') { const current = await ensureBrowserSession(); return { ok: true, data: await verifyRawSession(message.sessionId || current.sessionId, !!message.full) }; }
    if (message.type === 'GET_RECENT_RAW_SESSIONS') return { ok: true, sessions: await recentSessions() };
    if (message.type === 'RETRY_AUTO_EXPORT') return { ok: true, result: await autoExportSession(String(message.sessionId || ''), { force: true }) };
    if (message.type === 'GET_STATE') return { ok: true, state: await loadEpisodeState(), rawSession: await ensureBrowserSession() };
    if (message.type === 'START_EPISODE') return { ok: true, state: await startEpisode(message.task || {}) };
    if (message.type === 'STOP_EPISODE') return { ok: true, state: await stopEpisode(message.outcome) };
    if (message.type === 'TRANSITION_START') return transitionStart(sender, message.transition);
    if (message.type === 'TRANSITION_END') return transitionEnd(sender, message.transition);
    return { ok: false, error: 'unknown_message' };
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});
