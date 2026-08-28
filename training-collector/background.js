'use strict';

importScripts(
  'core/episode_builder.js',
  'core/episode_capture_gate.js',
  'core/episode_state_queue.js',
  'core/raw_session_store.js',
  'core/indexeddb_chunk_store.js',
  'core/strategy_episode_view.js',
  'core/task_episode_review_export.js',
  'core/socket_mirror.js'
);

const EPISODE_STATE_KEY = 'trainingCollectorStateV03';
const TASK_REVIEW_OUTBOX_KEY = 'trainingCollectorTaskReviewOutboxV1';
const RECENT_SESSION_LIMIT = 20;
const SOCKET_ENDPOINT = 'ws://127.0.0.1:8765/training-collector';
const EpisodeBuilder = globalThis.TrainingCollectorV02.EpisodeBuilder;
const StrategyEpisodeView = globalThis.TrainingCollectorV09.StrategyEpisodeView;
const EpisodeCaptureGate = globalThis.TrainingCollectorV09.EpisodeCaptureGate;
const TaskEpisodeReviewExport = globalThis.TrainingCollectorV09.TaskEpisodeReviewExport;
const EpisodeStateQueueFactory = globalThis.TrainingCollectorV12.EpisodeStateQueue;
const RawStore = globalThis.TrainingCollectorV03.RawSessionStore;
const ChunkStore = globalThis.TrainingCollectorV06.IndexedDbChunkStore.createChunkStore({ chunkSize: RawStore.CHUNK_SIZE });
const SocketMirrorFactory = globalThis.TrainingCollectorV08.SocketMirror;
const EpisodeStateQueue = EpisodeStateQueueFactory?.createEpisodeStateQueue?.() || null;
const EMPTY = { active: false, episode: null };
const BROWSER_OBSERVATION_RETRIES = 5;
const BROWSER_OBSERVATION_RETRY_MS = 80;
let browserSessionInitPromise = null;
let rawAppendChain = Promise.resolve();
let taskReviewOutboxChain = Promise.resolve();

function nowIso() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0)))); }

async function loadEpisodeState() {
  const data = await chrome.storage.local.get(EPISODE_STATE_KEY);
  return data[EPISODE_STATE_KEY] || { ...EMPTY };
}
async function saveEpisodeState(state) {
  await chrome.storage.local.set({ [EPISODE_STATE_KEY]: state });
  return state;
}
function queueEpisodeMutation(job) { return EpisodeStateQueue?.enqueue ? EpisodeStateQueue.enqueue(job) : job(); }
async function consistentEpisodeState() { await EpisodeStateQueue?.drain?.(); return loadEpisodeState(); }

function transitionTargetLabel(transition) {
  const ref = transition?.action?.targetRef || null;
  const observation = transition?.strategyObservationBefore || null;
  if (!ref || !observation) return null;
  if (observation.focusedElement?.ref === ref) return observation.focusedElement.label || null;
  const match = (observation.interactiveElements || []).find(item => item?.ref === ref);
  return match?.label || null;
}
function episodeDiagnostic(state) {
  const transitions = Array.isArray(state?.episode?.transitions) ? state.episode.transitions : [];
  const pending = transitions.filter(item => item?.status === 'pending').map(item => ({
    transitionId: item.transitionId || null,
    startedAtMs: Number(item.startedAtMs || 0),
    actionKind: item.action?.kind || null,
    operation: item.action?.operation || null,
    targetLabel: transitionTargetLabel(item)
  }));
  return {
    active: !!state?.active,
    episodeId: state?.episode?.episodeId || null,
    transitionCount: transitions.length,
    completeTransitionCount: transitions.filter(item => item?.status === 'complete').length,
    pendingTransitionCount: pending.length,
    pending,
    trackedEpisodeTabCount: Array.isArray(state?.episode?.runtime?.trackedTabIds) ? state.episode.runtime.trackedTabIds.length : (state?.episode?.tabId ? 1 : 0),
    queue: EpisodeStateQueue?.status?.() || null,
    privacy: { selectorsIncluded: false, coordinatesIncluded: false, tabIdsIncluded: false, rawTextValuesIncluded: false }
  };
}
async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}
async function requestSnapshot(tabId) {
  try { return await chrome.tabs.sendMessage(tabId, { scope: 'TRAINING_COLLECTOR_V03', type: 'SNAPSHOT' }, { frameId: 0 }); }
  catch (error) { return { ok: false, error: String(error?.message || error) }; }
}

function episodeRelativeMs(episode) {
  const start = Date.parse(episode?.startedAt || '');
  return Number.isFinite(start) ? Math.max(0, Date.now() - start) : 0;
}
function urlToken(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `u${(hash >>> 0).toString(16)}`;
}
function runtimeKey(tabId) { return String(Number(tabId)); }
function ensureEpisodeRuntime(episode) {
  if (!episode || typeof episode !== 'object') return null;
  const rootTabId = Number(episode.tabId);
  const current = episode.runtime && typeof episode.runtime === 'object' ? episode.runtime : {};
  const tracked = Array.isArray(current.trackedTabIds) ? current.trackedTabIds.map(Number).filter(Number.isFinite) : [];
  if (Number.isFinite(rootTabId) && !tracked.includes(rootTabId)) tracked.unshift(rootTabId);
  episode.runtime = {
    rootTabId: Number.isFinite(Number(current.rootTabId)) ? Number(current.rootTabId) : rootTabId,
    trackedTabIds: [...new Set(tracked)],
    activeTabId: Number.isFinite(Number(current.activeTabId)) ? Number(current.activeTabId) : rootTabId,
    browserSeq: Math.max(0, Number(current.browserSeq || 0)),
    lastObservationByTabId: current.lastObservationByTabId && typeof current.lastObservationByTabId === 'object' ? current.lastObservationByTabId : {},
    historyByTabId: current.historyByTabId && typeof current.historyByTabId === 'object' ? current.historyByTabId : {},
    pendingOpenByTabId: current.pendingOpenByTabId && typeof current.pendingOpenByTabId === 'object' ? current.pendingOpenByTabId : {},
    pendingReloadByTabId: current.pendingReloadByTabId && typeof current.pendingReloadByTabId === 'object' ? current.pendingReloadByTabId : {},
    readyTabIds: Array.isArray(current.readyTabIds) ? [...new Set(current.readyTabIds.map(Number).filter(Number.isFinite))] : [],
    suppressActivationTabId: Number.isFinite(Number(current.suppressActivationTabId)) ? Number(current.suppressActivationTabId) : null
  };
  return episode.runtime;
}
function isTrackedEpisodeTab(episode, tabId) {
  const runtime = ensureEpisodeRuntime(episode);
  return !!runtime && runtime.trackedTabIds.includes(Number(tabId));
}
function addTrackedTab(runtime, tabId) {
  const id = Number(tabId);
  if (!Number.isFinite(id)) return;
  if (!runtime.trackedTabIds.includes(id)) runtime.trackedTabIds.push(id);
}
function removeTrackedTab(runtime, tabId) {
  const id = Number(tabId);
  runtime.trackedTabIds = runtime.trackedTabIds.filter(item => item !== id);
  runtime.readyTabIds = runtime.readyTabIds.filter(item => item !== id);
  delete runtime.lastObservationByTabId[runtimeKey(id)];
  delete runtime.historyByTabId[runtimeKey(id)];
  delete runtime.pendingOpenByTabId[runtimeKey(id)];
  delete runtime.pendingReloadByTabId[runtimeKey(id)];
}
function markReady(runtime, tabId, ready = true) {
  const id = Number(tabId);
  runtime.readyTabIds = runtime.readyTabIds.filter(item => item !== id);
  if (ready && Number.isFinite(id)) runtime.readyTabIds.push(id);
}
function cachedObservation(runtime, tabId) { return runtime?.lastObservationByTabId?.[runtimeKey(tabId)] || null; }
function rememberObservation(runtime, tabId, observation) {
  if (runtime && observation && typeof observation === 'object') runtime.lastObservationByTabId[runtimeKey(tabId)] = observation;
}
function strategyObservationFromRaw(raw, observationId) {
  if (!raw || !StrategyEpisodeView?.sanitizeSnapshot) return null;
  return StrategyEpisodeView.sanitizeSnapshot(raw, { observationId, capturedAt: nowIso() });
}
async function requestStrategyObservation(tabId, label = 'browser', retries = 1) {
  let latest = null;
  const attempts = Math.max(1, Number(retries || 1));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await requestSnapshot(tabId);
    if (response?.ok && response.observation) {
      const observed = strategyObservationFromRaw(response.observation, `${label}-${attempt}`);
      if (observed) latest = observed;
    }
    if (attempt + 1 < attempts) await sleep(BROWSER_OBSERVATION_RETRY_MS);
  }
  return latest;
}
function initHistory(runtime, tabId, url) {
  const key = runtimeKey(tabId);
  if (runtime.historyByTabId[key]) return runtime.historyByTabId[key];
  const token = urlToken(url);
  runtime.historyByTabId[key] = { tokens: [token], index: 0 };
  return runtime.historyByTabId[key];
}
function updateHistory(runtime, tabId, url) {
  const history = initHistory(runtime, tabId, url);
  const token = urlToken(url);
  const current = history.tokens[history.index] || null;
  if (current === token) return { operation: null, token };
  if (history.index > 0 && history.tokens[history.index - 1] === token) {
    history.index -= 1;
    return { operation: 'back', token };
  }
  if (history.index + 1 < history.tokens.length && history.tokens[history.index + 1] === token) {
    history.index += 1;
    return { operation: 'forward', token };
  }
  history.tokens = history.tokens.slice(0, history.index + 1);
  history.tokens.push(token);
  history.index = history.tokens.length - 1;
  return { operation: null, token };
}
function browserTransitionId(episode, operation) {
  const runtime = ensureEpisodeRuntime(episode);
  runtime.browserSeq += 1;
  return `browser-${String(episode.episodeId || 'episode')}-${runtime.browserSeq}-${operation}`;
}
function beginBrowserTransition(episode, operation, strategyObservationBefore, runtimeTabId) {
  if (!episode || !strategyObservationBefore) return null;
  const id = browserTransitionId(episode, operation);
  EpisodeBuilder.beginTransition(episode, {
    transitionId: id,
    startedAtMs: episodeRelativeMs(episode),
    strategyObservationBefore,
    sourceContext: { runtimeTabId: Number(runtimeTabId), browserLifecycle: true },
    action: { actionVersion: '0.3.0', kind: 'browser', operation, targetRef: null, t: episodeRelativeMs(episode) }
  });
  EpisodeBuilder.capTransitions(episode);
  return id;
}
function finishBrowserTransition(episode, transitionId, strategyObservationAfter, outcome = {}) {
  if (!episode || !transitionId || !strategyObservationAfter) return false;
  return EpisodeBuilder.finishTransition(episode, {
    transitionId,
    endedAtMs: episodeRelativeMs(episode),
    strategyObservationAfter,
    actionSucceeded: true,
    outcome: { browserLifecycle: true, ...outcome }
  });
}
function removeTransition(episode, transitionId) {
  if (!transitionId || !Array.isArray(episode?.transitions)) return false;
  const index = episode.transitions.findIndex(item => item?.transitionId === transitionId);
  if (index < 0) return false;
  episode.transitions.splice(index, 1);
  return true;
}
function labelWords(value) {
  return new Set((String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) || []));
}
function collapseSurfaceClickForBrowserAction(episode, tabId, operation) {
  const transitions = Array.isArray(episode?.transitions) ? episode.transitions : [];
  for (let index = transitions.length - 1; index >= 0; index -= 1) {
    const item = transitions[index];
    if (Number(item?.sourceContext?.runtimeTabId) !== Number(tabId)) continue;
    if (item?.action?.kind === 'focus') continue;
    if (item?.action?.kind !== 'click') break;
    const tokens = labelWords(transitionTargetLabel(item));
    const openSurface = operation === 'openNewTab' && (tokens.has('open') || tokens.has('mo'));
    const closeSurface = operation === 'closeTab' && (tokens.has('close') || tokens.has('done') || tokens.has('dong'));
    if (openSurface || closeSurface) transitions.splice(index, 1);
    return openSurface || closeSurface;
  }
  return false;
}
function cancelPendingBrowserTransition(episode, runtime, mapName, tabId) {
  const map = runtime?.[mapName];
  if (!map) return;
  const key = runtimeKey(tabId);
  const transitionId = map[key];
  if (transitionId) removeTransition(episode, transitionId);
  delete map[key];
}

async function readTaskReviewOutbox() {
  const data = await chrome.storage.local.get(TASK_REVIEW_OUTBOX_KEY);
  const value = data?.[TASK_REVIEW_OUTBOX_KEY];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
async function writeTaskReviewOutbox(value) { await chrome.storage.local.set({ [TASK_REVIEW_OUTBOX_KEY]: value || {} }); }
function mutateTaskReviewOutbox(job) { const next = taskReviewOutboxChain.then(job); taskReviewOutboxChain = next.catch(() => {}); return next; }
async function persistTaskReview(review) {
  const episodeId = String(review?.episodeId || '').trim();
  if (!episodeId) throw new Error('task_review_episode_id_required');
  await mutateTaskReviewOutbox(async () => {
    const rows = await readTaskReviewOutbox();
    rows[episodeId] = { review, queuedAt: rows[episodeId]?.queuedAt || nowIso(), lastQueuedAt: nowIso() };
    await writeTaskReviewOutbox(rows);
  });
  return review;
}
async function acknowledgeTaskReview(message) {
  const episodeId = String(message?.episodeId || '').trim();
  if (!episodeId || (message?.persisted !== true && message?.permanent !== true)) return;
  await mutateTaskReviewOutbox(async () => {
    const rows = await readTaskReviewOutbox();
    if (!rows[episodeId]) return;
    delete rows[episodeId];
    await writeTaskReviewOutbox(rows);
  });
}
async function registerTaskReviewBacklog() {
  await taskReviewOutboxChain;
  const rows = await readTaskReviewOutbox();
  for (const row of Object.values(rows)) if (row?.review?.episodeId) SocketMirror?.registerTaskReview?.(row.review);
  return Object.keys(rows).length;
}

async function replaySession(sessionId, afterSeq, emit) {
  const session = await ChunkStore.getSession(sessionId);
  if (!session) return;
  let cursor = Math.max(0, Number(afterSeq || 0));
  for (let i = 0; i < Number(session.chunkCount || 0); i += 1) {
    const record = await ChunkStore.getChunkRecord(sessionId, i);
    const fresh = (record?.events || []).filter(event => Number(event?.sessionSeq || 0) > cursor);
    for (let offset = 0; offset < fresh.length; offset += 250) {
      const batch = fresh.slice(offset, offset + 250);
      if (!batch.length) continue;
      await emit(batch);
      cursor = Number(batch[batch.length - 1]?.sessionSeq || cursor);
    }
  }
}
const SocketMirror = SocketMirrorFactory?.createSocketMirror?.({ endpoint: SOCKET_ENDPOINT, heartbeatMs: 20000, maxReconnectMs: 10000, replaySession, onTaskReviewAck: acknowledgeTaskReview }) || null;

async function closeDanglingSessions() {
  const sessions = await ChunkStore.listSessionsByStatus('active', 500), closed = [];
  for (const session of sessions) {
    const integrity = await ChunkStore.verifySession(session, { tailCount: 3 }).catch(error => ({ ok: false, problems: [{ code: 'verification_error', error: String(error?.message || error) }] }));
    session.status = 'closed-inferred'; session.endedAt = session.lastSeenAt || session.startedAt || nowIso(); session.endReason = 'previous_browser_session_no_longer_active'; session.integrity = { ...integrity, verifiedAt: nowIso(), scope: 'tail' };
    await ChunkStore.putSession(session); SocketMirror?.registerSession?.(session, { closeWhenSynced: true }); closed.push(session);
  }
  return closed;
}
async function registerClosedBacklog(limit = 500) {
  for (const status of ['closed-inferred', 'closed']) {
    const sessions = await ChunkStore.listSessionsByStatus(status, limit);
    for (const session of sessions) if (Number(session.eventCount || 0) > 0) SocketMirror?.registerSession?.(session, { closeWhenSynced: true });
  }
}
async function recentSessions() {
  return (await ChunkStore.listSessions(RECENT_SESSION_LIMIT)).map(session => ({ sessionId: session.sessionId, schemaVersion: session.schemaVersion, status: session.status, startedAt: session.startedAt, endedAt: session.endedAt, eventCount: Number(session.eventCount || 0), chunkCount: Number(session.chunkCount || 0), integrity: session.integrity || null }));
}
async function createBrowserSession() {
  await closeDanglingSessions();
  const session = RawStore.createSession(RawStore.makeSessionId(), nowIso());
  session.integrity = { ok: true, verifiedAt: null, scope: 'not-yet-verified' };
  await ChunkStore.putSession(session); await chrome.storage.session.set({ [RawStore.CURRENT_SESSION_KEY]: session.sessionId });
  SocketMirror?.registerSession?.(session); SocketMirror?.start?.(); return session;
}
async function ensureBrowserSessionUnlocked() {
  const current = await chrome.storage.session.get(RawStore.CURRENT_SESSION_KEY), sessionId = current[RawStore.CURRENT_SESSION_KEY];
  if (sessionId) {
    const session = await ChunkStore.getSession(sessionId);
    if (session?.status === 'active' && session.schemaVersion === RawStore.VERSION) { SocketMirror?.registerSession?.(session); SocketMirror?.start?.(); return session; }
    if (session?.status === 'active' && session.schemaVersion !== RawStore.VERSION) {
      session.status = 'closed'; session.endedAt = nowIso(); session.endReason = `schema_upgrade_to_${RawStore.VERSION}`; await ChunkStore.putSession(session); SocketMirror?.registerSession?.(session, { closeWhenSynced: true }); await chrome.storage.session.remove(RawStore.CURRENT_SESSION_KEY);
    }
  }
  return createBrowserSession();
}
async function ensureBrowserSession() {
  if (!browserSessionInitPromise) browserSessionInitPromise = ensureBrowserSessionUnlocked().finally(() => { browserSessionInitPromise = null; });
  return browserSessionInitPromise;
}
function eventLastSeenIso(events) {
  let max = 0; for (const event of events || []) { const ts = Number(event?.tsEpochMs || 0); if (Number.isFinite(ts)) max = Math.max(max, ts); }
  return max > 0 ? new Date(max).toISOString() : nowIso();
}
async function appendRawBatchUnlocked(sender, batch) {
  const session = await ensureBrowserSession(), incoming = Array.isArray(batch?.events) ? batch.events : [], batchId = typeof batch?.batchId === 'string' ? batch.batchId : null;
  if (!incoming.length) return { ok: true, ack: true, batchId, sessionId: session.sessionId, appended: 0 };
  const captureSource = typeof batch?.source === 'string' ? batch.source : 'unknown'; let seq = Number(session.eventCount || 0); const normalizedEvents = [];
  for (const raw of incoming) {
    const normalized = RawStore.normalizeEvent(raw); if (!normalized) continue; seq += 1;
    normalizedEvents.push({ ...normalized, captureSource, sessionSeq: seq, tabId: sender.tab?.id ?? null, windowId: sender.tab?.windowId ?? null, frameId: sender.frameId ?? 0, documentId: sender.documentId || null, documentLifecycle: sender.documentLifecycle || null });
  }
  if (!normalizedEvents.length) return { ok: true, ack: true, batchId, sessionId: session.sessionId, appended: 0 };
  const candidate = { ...session, eventCount: seq, lastSeenAt: eventLastSeenIso(incoming), integrity: { ok: true, verifiedAt: null, scope: 'pending-after-write' } };
  const result = await ChunkStore.append(candidate, normalizedEvents, batchId), persistedSession = result.session || candidate;
  SocketMirror?.registerSession?.(persistedSession); if (!result.duplicate) SocketMirror?.publish?.(persistedSession, normalizedEvents);
  return { ok: true, ack: true, batchId, sessionId: session.sessionId, duplicate: !!result.duplicate, appended: result.duplicate ? 0 : normalizedEvents.length, eventCount: Number(persistedSession.eventCount || session.eventCount || 0) };
}
function appendRawBatch(sender, batch) { const job = rawAppendChain.then(() => appendRawBatchUnlocked(sender, batch)); rawAppendChain = job.catch(() => {}); return job; }
async function rawPreview(sessionId, limit = 100) { await rawAppendChain; const session = await ChunkStore.getSession(sessionId); return session ? { session, events: await ChunkStore.getTail(session, Math.max(1, Math.min(500, Number(limit || 100)))) } : { session: null, events: [] }; }
async function exportMeta(sessionId) { await rawAppendChain; const session = await ChunkStore.getSession(sessionId); if (!session) throw new Error('raw_session_not_found'); return { exportVersion: session.schemaVersion || RawStore.VERSION, exportedAt: nowIso(), session }; }
async function exportChunk(sessionId, chunkIndex) {
  await rawAppendChain; const session = await ChunkStore.getSession(sessionId); if (!session) throw new Error('raw_session_not_found');
  const index = Number(chunkIndex); if (!Number.isInteger(index) || index < 0 || index >= Number(session.chunkCount || 0)) throw new Error('raw_chunk_out_of_range');
  const record = await ChunkStore.getChunkRecord(sessionId, index); if (!record) throw new Error('raw_chunk_missing');
  return { chunkIndex: index, checksum: record.checksum || null, firstSeq: record.firstSeq || null, lastSeq: record.lastSeq || null, events: Array.isArray(record.events) ? record.events : [] };
}
async function verifyRawSession(sessionId, full = false) { await rawAppendChain; const session = await ChunkStore.getSession(sessionId); if (!session) throw new Error('raw_session_not_found'); const integrity = await ChunkStore.verifySession(session, { full: !!full, tailCount: 3 }); session.integrity = { ...integrity, verifiedAt: nowIso(), scope: full ? 'full' : 'tail' }; await ChunkStore.putSession(session); return { session, integrity }; }

async function startEpisodeUnlocked(task) {
  const tab = await activeTab();
  if (!tab?.id || !/^https?:/i.test(tab.url || '')) throw new Error('Open a normal http/https page before starting an episode');
  const initial = await requestSnapshot(tab.id), initialObservation = EpisodeCaptureGate.assertSnapshotReady(initial);
  const episode = EpisodeBuilder.createEpisode({ task, tabId: tab.id, initialObservation, now: nowIso() });
  const runtime = ensureEpisodeRuntime(episode);
  const initialStrategy = strategyObservationFromRaw(initialObservation, 'episode-initial');
  rememberObservation(runtime, tab.id, initialStrategy); initHistory(runtime, tab.id, tab.url || ''); markReady(runtime, tab.id, true);
  const state = { active: true, episode };
  await saveEpisodeState(state);
  try {
    const capture = await chrome.tabs.sendMessage(tab.id, { scope: 'TRAINING_COLLECTOR_V03', type: 'START_EPISODE_CAPTURE' }, { frameId: 0 });
    EpisodeCaptureGate.assertCaptureArmed(capture);
  } catch (error) { await saveEpisodeState({ ...EMPTY }); throw new Error(`episode_capture_start_failed: ${String(error?.message || error)}`); }
  return state;
}
function startEpisode(task) { return queueEpisodeMutation(() => startEpisodeUnlocked(task)); }

async function stopEpisodeUnlocked(outcome) {
  const state = await loadEpisodeState(); if (!state.active || !state.episode) return state;
  EpisodeCaptureGate.assertStopAllowed(state.episode, outcome);
  const runtime = ensureEpisodeRuntime(state.episode);
  for (const tabId of runtime.trackedTabIds) {
    await chrome.tabs.sendMessage(tabId, { scope: 'TRAINING_COLLECTOR_V03', type: 'STOP_EPISODE_CAPTURE' }, { frameId: 0 }).catch(() => {});
  }
  state.active = false; state.episode.endedAt = nowIso(); state.episode.finalOutcome = outcome || { status: 'stopped' };
  let review = null;
  if (String(state.episode.finalOutcome?.status || '').toLowerCase() === 'success') {
    if (!TaskEpisodeReviewExport?.buildReviewExport) throw new Error('task_episode_review_export_unavailable');
    review = TaskEpisodeReviewExport.buildReviewExport(state.episode, { exportedAt: nowIso() }); await persistTaskReview(review);
  }
  await saveEpisodeState(state); if (review) SocketMirror?.registerTaskReview?.(review); return state;
}
function stopEpisode(outcome) { return queueEpisodeMutation(() => stopEpisodeUnlocked(outcome)); }

async function adoptEpisodeChildTabUnlocked(state, tab) {
  if (!state?.active || !state.episode || !tab?.id) return false;
  const runtime = ensureEpisodeRuntime(state.episode), tabId = Number(tab.id), opener = Number(tab.openerTabId);
  if (isTrackedEpisodeTab(state.episode, tabId)) return true;
  if (!Number.isFinite(opener) || !runtime.trackedTabIds.includes(opener)) return false;
  addTrackedTab(runtime, tabId); initHistory(runtime, tabId, tab.url || '');
  if (tab.active) { runtime.activeTabId = tabId; runtime.suppressActivationTabId = tabId; }
  collapseSurfaceClickForBrowserAction(state.episode, opener, 'openNewTab');
  const before = cachedObservation(runtime, opener) || await requestStrategyObservation(opener, 'open-tab-before', 2);
  const transitionId = beginBrowserTransition(state.episode, 'openNewTab', before, opener);
  if (transitionId) runtime.pendingOpenByTabId[runtimeKey(tabId)] = transitionId;
  await saveEpisodeState(state);
  return true;
}

async function transitionStartUnlocked(sender, transition) {
  const state = await loadEpisodeState(), tabId = Number(sender.tab?.id);
  if (sender.frameId !== 0 || !state.active || !state.episode || !isTrackedEpisodeTab(state.episode, tabId)) return { ok: true, ignored: true };
  const runtime = ensureEpisodeRuntime(state.episode);
  const enriched = { ...(transition || {}), sourceContext: { ...(transition?.sourceContext || {}), runtimeTabId: tabId } };
  EpisodeBuilder.beginTransition(state.episode, enriched); EpisodeBuilder.capTransitions(state.episode);
  if (enriched.strategyObservationBefore) rememberObservation(runtime, tabId, enriched.strategyObservationBefore);
  await saveEpisodeState(state); return { ok: true };
}
function transitionStart(sender, transition) { return queueEpisodeMutation(() => transitionStartUnlocked(sender, transition)); }

async function transitionEndUnlocked(sender, transition) {
  const state = await loadEpisodeState(), tabId = Number(sender.tab?.id);
  if (sender.frameId !== 0 || !state.active || !state.episode || !isTrackedEpisodeTab(state.episode, tabId)) return { ok: true, ignored: true };
  const existing = (state.episode.transitions || []).find(item => item?.transitionId === transition?.transitionId) || null;
  if (existing && Number(existing?.sourceContext?.runtimeTabId) !== tabId) return { ok: true, ignored: true, matched: false };
  const matched = EpisodeBuilder.finishTransition(state.episode, transition || {}), runtime = ensureEpisodeRuntime(state.episode);
  if (transition?.strategyObservationAfter) rememberObservation(runtime, tabId, transition.strategyObservationAfter);
  await saveEpisodeState(state); return { ok: true, matched };
}
function transitionEnd(sender, transition) { return queueEpisodeMutation(() => transitionEndUnlocked(sender, transition)); }

async function episodeDocumentReadyUnlocked(sender, payload = {}) {
  const state = await loadEpisodeState(), tabId = Number(sender.tab?.id);
  if (sender.frameId !== 0 || !state.active || !state.episode) return { ok: true, ignored: true, settled: 0 };
  if (!isTrackedEpisodeTab(state.episode, tabId)) {
    const adopted = await adoptEpisodeChildTabUnlocked(state, sender.tab);
    if (!adopted) return { ok: true, ignored: true, settled: 0 };
  }
  const pageInstanceId = String(payload.pageInstanceId || '').trim();
  const stateAfter = payload.observation && typeof payload.observation === 'object' ? payload.observation : null;
  const strategyObservationAfter = payload.strategyObservation && typeof payload.strategyObservation === 'object' ? payload.strategyObservation : null;
  if (!pageInstanceId || !stateAfter || !strategyObservationAfter) return { ok: false, error: 'episode_document_ready_snapshot_required', settled: 0 };
  const runtime = ensureEpisodeRuntime(state.episode); rememberObservation(runtime, tabId, strategyObservationAfter); markReady(runtime, tabId, true); initHistory(runtime, tabId, sender.tab?.url || '');
  let settled = 0;
  const openId = runtime.pendingOpenByTabId[runtimeKey(tabId)];
  if (openId) { if (finishBrowserTransition(state.episode, openId, strategyObservationAfter, { settlementReason: 'new_tab_document_ready' })) settled += 1; delete runtime.pendingOpenByTabId[runtimeKey(tabId)]; }
  const reloadId = runtime.pendingReloadByTabId[runtimeKey(tabId)];
  if (reloadId) { if (finishBrowserTransition(state.episode, reloadId, strategyObservationAfter, { settlementReason: 'reloaded_document_ready' })) settled += 1; delete runtime.pendingReloadByTabId[runtimeKey(tabId)]; }
  for (const item of state.episode.transitions || []) {
    if (item?.status !== 'pending' || item?.sourceContext?.browserLifecycle === true) continue;
    if (Number(item?.sourceContext?.runtimeTabId) !== tabId) continue;
    if (String(item.transitionId || '').startsWith(`${pageInstanceId}-`)) continue;
    const matched = EpisodeBuilder.finishTransition(state.episode, { transitionId: item.transitionId, endedAtMs: Number(payload.observedAtMs || 0), stateAfter, strategyObservationAfter, actionSucceeded: true, outcome: { documentChanged: true, settlementReason: 'next_document_ready' } });
    if (matched) settled += 1;
  }
  await saveEpisodeState(state); return { ok: true, ignored: false, settled };
}
function episodeDocumentReady(sender, payload) { return queueEpisodeMutation(() => episodeDocumentReadyUnlocked(sender, payload)); }

async function episodeHello(sender) {
  return queueEpisodeMutation(async () => {
    const state = await loadEpisodeState();
    if (sender.frameId !== 0 || !state.active || !state.episode || !sender.tab?.id) return false;
    if (!isTrackedEpisodeTab(state.episode, sender.tab.id)) await adoptEpisodeChildTabUnlocked(state, sender.tab);
    return isTrackedEpisodeTab(state.episode, sender.tab.id);
  });
}

async function handleTabCreated(tab) {
  return queueEpisodeMutation(async () => {
    const state = await loadEpisodeState();
    if (!state.active || !state.episode || !tab?.id) return;
    await adoptEpisodeChildTabUnlocked(state, tab);
  });
}
async function handleTabActivated(activeInfo) {
  return queueEpisodeMutation(async () => {
    const state = await loadEpisodeState(), tabId = Number(activeInfo?.tabId);
    if (!state.active || !state.episode || !isTrackedEpisodeTab(state.episode, tabId)) return;
    const runtime = ensureEpisodeRuntime(state.episode), previous = Number(runtime.activeTabId);
    if (previous === tabId) return;
    if (runtime.suppressActivationTabId === tabId) {
      runtime.suppressActivationTabId = null; runtime.activeTabId = tabId; await saveEpisodeState(state); return;
    }
    const before = isTrackedEpisodeTab(state.episode, previous) ? cachedObservation(runtime, previous) : null;
    const after = await requestStrategyObservation(tabId, 'switch-tab-after', 2);
    if (before && after) {
      const transitionId = beginBrowserTransition(state.episode, 'switchTab', before, previous);
      if (transitionId) finishBrowserTransition(state.episode, transitionId, after, { settlementReason: 'tracked_tab_activated' });
      rememberObservation(runtime, tabId, after);
    }
    runtime.activeTabId = tabId; await saveEpisodeState(state);
  });
}
async function handleTabRemoved(tabId) {
  return queueEpisodeMutation(async () => {
    const state = await loadEpisodeState(), id = Number(tabId);
    if (!state.active || !state.episode || !isTrackedEpisodeTab(state.episode, id)) return;
    const runtime = ensureEpisodeRuntime(state.episode);
    collapseSurfaceClickForBrowserAction(state.episode, id, 'closeTab');
    cancelPendingBrowserTransition(state.episode, runtime, 'pendingOpenByTabId', id);
    cancelPendingBrowserTransition(state.episode, runtime, 'pendingReloadByTabId', id);
    const before = cachedObservation(runtime, id);
    const fallback = runtime.trackedTabIds.find(candidate => candidate !== id && candidate === runtime.rootTabId) || runtime.trackedTabIds.find(candidate => candidate !== id) || null;
    let after = fallback != null ? cachedObservation(runtime, fallback) : null;
    if (fallback != null) {
      await sleep(80);
      after = await requestStrategyObservation(fallback, 'close-tab-after', BROWSER_OBSERVATION_RETRIES) || after;
    }
    if (before && after) {
      const transitionId = beginBrowserTransition(state.episode, 'closeTab', before, id);
      if (transitionId) finishBrowserTransition(state.episode, transitionId, after, { settlementReason: 'tracked_tab_removed' });
      if (fallback != null) rememberObservation(runtime, fallback, after);
    }
    removeTrackedTab(runtime, id);
    if (fallback != null) { runtime.activeTabId = fallback; runtime.suppressActivationTabId = fallback; }
    await saveEpisodeState(state);
  });
}
async function handleTabUpdated(tabId, changeInfo, tab) {
  return queueEpisodeMutation(async () => {
    const state = await loadEpisodeState(), id = Number(tabId);
    if (!state.active || !state.episode || !isTrackedEpisodeTab(state.episode, id)) return;
    const runtime = ensureEpisodeRuntime(state.episode), key = runtimeKey(id);
    if (typeof changeInfo?.url === 'string') {
      const pendingReloadId = runtime.pendingReloadByTabId[key];
      if (pendingReloadId) { cancelPendingBrowserTransition(state.episode, runtime, 'pendingReloadByTabId', id); }
      const before = cachedObservation(runtime, id), movement = updateHistory(runtime, id, changeInfo.url);
      if (movement.operation && before) {
        await sleep(25);
        const after = await requestStrategyObservation(id, `${movement.operation}-after`, 2) || before;
        const transitionId = beginBrowserTransition(state.episode, movement.operation, before, id);
        if (transitionId) finishBrowserTransition(state.episode, transitionId, after, { settlementReason: 'history_url_transition' });
        rememberObservation(runtime, id, after);
      }
    }
    if (changeInfo?.status === 'loading' && !changeInfo?.url && runtime.readyTabIds.includes(id) && !runtime.pendingReloadByTabId[key]) {
      const before = cachedObservation(runtime, id);
      const history = runtime.historyByTabId[key];
      const currentToken = history?.tokens?.[history.index] || null;
      if (before && currentToken && currentToken === urlToken(tab?.url || '')) {
        const transitionId = beginBrowserTransition(state.episode, 'reload', before, id);
        if (transitionId) runtime.pendingReloadByTabId[key] = transitionId;
        markReady(runtime, id, false);
      }
    }
    if (changeInfo?.status === 'complete') {
      markReady(runtime, id, true);
      const pendingReloadId = runtime.pendingReloadByTabId[key];
      if (pendingReloadId) {
        const after = await requestStrategyObservation(id, 'reload-complete-after', 2);
        if (after) { finishBrowserTransition(state.episode, pendingReloadId, after, { settlementReason: 'tab_update_complete' }); rememberObservation(runtime, id, after); delete runtime.pendingReloadByTabId[key]; }
      }
    }
    await saveEpisodeState(state);
  });
}

function bootstrap() {
  SocketMirror?.start?.();
  ensureBrowserSession().then(() => registerClosedBacklog()).catch(() => {});
  registerTaskReviewBacklog().catch(() => {});
  SocketMirror?.requestPipelineStatus?.();
}
chrome.runtime.onStartup.addListener(bootstrap);
chrome.runtime.onInstalled.addListener(bootstrap);
chrome.tabs.onCreated.addListener(tab => { handleTabCreated(tab).catch(() => {}); });
chrome.tabs.onActivated.addListener(info => { handleTabActivated(info).catch(() => {}); });
chrome.tabs.onRemoved.addListener(tabId => { handleTabRemoved(tabId).catch(() => {}); });
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => { handleTabUpdated(tabId, changeInfo, tab).catch(() => {}); });
bootstrap();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.scope !== 'TRAINING_COLLECTOR_V03') return false;
  (async () => {
    if (message.type === 'HELLO') {
      const session = await ensureBrowserSession(), active = await episodeHello(sender);
      return { ok: true, browserSessionId: session.sessionId, episodeActive: active, frameId: sender.frameId ?? 0, documentId: sender.documentId || null };
    }
    if (message.type === 'RAW_BATCH') return appendRawBatch(sender, message.batch || {});
    if (message.type === 'GET_RAW_STATUS') return { ok: true, session: await ensureBrowserSession() };
    if (message.type === 'GET_RAW_PREVIEW') { const current = await ensureBrowserSession(); return { ok: true, ...(await rawPreview(message.sessionId || current.sessionId, message.limit || 100)) }; }
    if (message.type === 'GET_RAW_EXPORT_META') { const current = await ensureBrowserSession(); return { ok: true, data: await exportMeta(message.sessionId || current.sessionId) }; }
    if (message.type === 'GET_RAW_EXPORT_CHUNK') { const current = await ensureBrowserSession(); return { ok: true, data: await exportChunk(message.sessionId || current.sessionId, message.chunkIndex) }; }
    if (message.type === 'VERIFY_RAW_SESSION') { const current = await ensureBrowserSession(); return { ok: true, data: await verifyRawSession(message.sessionId || current.sessionId, !!message.full) }; }
    if (message.type === 'GET_RECENT_RAW_SESSIONS') return { ok: true, sessions: await recentSessions() };
    if (message.type === 'GET_SOCKET_STATUS') { SocketMirror?.requestPipelineStatus?.(); return { ok: true, socket: SocketMirror?.status?.() || { state: 'unavailable' } }; }
    if (message.type === 'GET_STATE') { SocketMirror?.requestPipelineStatus?.(); return { ok: true, state: await consistentEpisodeState(), rawSession: await ensureBrowserSession(), socket: SocketMirror?.status?.() || null }; }
    if (message.type === 'GET_EPISODE_DIAGNOSTIC') { const state = await consistentEpisodeState(); return { ok: true, diagnostic: episodeDiagnostic(state) }; }
    if (message.type === 'START_EPISODE') return { ok: true, state: await startEpisode(message.task || {}) };
    if (message.type === 'STOP_EPISODE') return { ok: true, state: await stopEpisode(message.outcome) };
    if (message.type === 'TRANSITION_START') return transitionStart(sender, message.transition);
    if (message.type === 'TRANSITION_END') return transitionEnd(sender, message.transition);
    if (message.type === 'EPISODE_DOCUMENT_READY') return episodeDocumentReady(sender, message);
    return { ok: false, error: 'unknown_message' };
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});
