'use strict';

importScripts('core/episode_builder.js', 'core/raw_session_store.js', 'core/indexeddb_chunk_store.js');

const EPISODE_STATE_KEY = 'trainingCollectorStateV03';
const EpisodeBuilder = globalThis.TrainingCollectorV02.EpisodeBuilder;
const RawStore = globalThis.TrainingCollectorV03.RawSessionStore;
const ChunkStore = globalThis.TrainingCollectorV06.IndexedDbChunkStore.createChunkStore({ chunkSize: RawStore.CHUNK_SIZE });
const EMPTY = { active: false, episode: null };
let browserSessionInitPromise = null;
let rawAppendChain = Promise.resolve();

function nowIso() { return new Date().toISOString(); }

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
  const sessions = await ChunkStore.listSessions(RawStore.MAX_SESSION_INDEX);
  for (const session of sessions) {
    if (session.status !== 'active') continue;
    const integrity = await ChunkStore.verifySession(session, { tailCount: 3 }).catch(error => ({ ok: false, problems: [{ code: 'verification_error', error: String(error?.message || error) }] }));
    session.status = 'closed-inferred';
    session.endedAt = session.lastSeenAt || session.startedAt || nowIso();
    session.endReason = 'previous_browser_session_no_longer_active';
    session.integrity = { ...integrity, verifiedAt: nowIso(), scope: 'tail' };
    await ChunkStore.putSession(session);
  }
}

async function createBrowserSession() {
  await closeDanglingSessions();
  const startedAt = nowIso();
  const session = RawStore.createSession(RawStore.makeSessionId(), startedAt);
  session.integrity = { ok: true, verifiedAt: null, scope: 'not-yet-verified' };
  await ChunkStore.putSession(session);
  await chrome.storage.session.set({ [RawStore.CURRENT_SESSION_KEY]: session.sessionId });
  return session;
}

async function ensureBrowserSessionUnlocked() {
  const current = await chrome.storage.session.get(RawStore.CURRENT_SESSION_KEY);
  const sessionId = current[RawStore.CURRENT_SESSION_KEY];
  if (sessionId) {
    const session = await ChunkStore.getSession(sessionId);
    if (session?.status === 'active') return session;
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
      frameId: sender.frameId ?? 0
    });
  }
  if (!normalizedEvents.length) return { ok: true, ack: true, batchId, sessionId: session.sessionId, appended: 0 };
  const candidate = {
    ...session,
    eventCount: seq,
    lastSeenAt: eventLastSeenIso(incoming),
    integrity: { ok: true, verifiedAt: null, scope: 'pending-after-write' }
  };
  const result = await ChunkStore.append(candidate, normalizedEvents, batchId);
  return {
    ok: true,
    ack: true,
    batchId,
    sessionId: session.sessionId,
    duplicate: !!result.duplicate,
    appended: result.duplicate ? 0 : normalizedEvents.length,
    eventCount: Number(result.session?.eventCount || session.eventCount || 0)
  };
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
  return { exportVersion: '0.6.0', exportedAt: nowIso(), session };
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
  state.active = false; state.episode.endedAt = nowIso(); state.episode.finalOutcome = outcome || { status: 'stopped' };
  return saveEpisodeState(state);
}
async function transitionStart(sender, transition) {
  const state = await loadEpisodeState();
  if (!state.active || !state.episode || sender.tab?.id !== state.episode.tabId) return { ok: true, ignored: true };
  EpisodeBuilder.beginTransition(state.episode, transition || {}); EpisodeBuilder.capTransitions(state.episode); await saveEpisodeState(state); return { ok: true };
}
async function transitionEnd(sender, transition) {
  const state = await loadEpisodeState();
  if (!state.active || !state.episode || sender.tab?.id !== state.episode.tabId) return { ok: true, ignored: true };
  const matched = EpisodeBuilder.finishTransition(state.episode, transition || {}); await saveEpisodeState(state); return { ok: true, matched };
}

chrome.runtime.onStartup.addListener(() => { ensureBrowserSession().catch(() => {}); });
chrome.runtime.onInstalled.addListener(() => { ensureBrowserSession().catch(() => {}); });
ensureBrowserSession().catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.scope !== 'TRAINING_COLLECTOR_V03') return false;
  (async () => {
    if (message.type === 'HELLO') {
      const session = await ensureBrowserSession(); const episodeState = await loadEpisodeState();
      return { ok: true, browserSessionId: session.sessionId, episodeActive: !!episodeState.active && episodeState.episode?.tabId === sender.tab?.id };
    }
    if (message.type === 'RAW_BATCH') return appendRawBatch(sender, message.batch || {});
    if (message.type === 'GET_RAW_STATUS') return { ok: true, session: await ensureBrowserSession() };
    if (message.type === 'GET_RAW_PREVIEW') { const current = await ensureBrowserSession(); return { ok: true, ...(await rawPreview(message.sessionId || current.sessionId, message.limit || 100)) }; }
    if (message.type === 'GET_RAW_EXPORT_META') { const current = await ensureBrowserSession(); return { ok: true, data: await exportMeta(message.sessionId || current.sessionId) }; }
    if (message.type === 'GET_RAW_EXPORT_CHUNK') { const current = await ensureBrowserSession(); return { ok: true, data: await exportChunk(message.sessionId || current.sessionId, message.chunkIndex) }; }
    if (message.type === 'VERIFY_RAW_SESSION') { const current = await ensureBrowserSession(); return { ok: true, data: await verifyRawSession(message.sessionId || current.sessionId, !!message.full) }; }
    if (message.type === 'GET_STATE') return { ok: true, state: await loadEpisodeState(), rawSession: await ensureBrowserSession() };
    if (message.type === 'START_EPISODE') return { ok: true, state: await startEpisode(message.task || {}) };
    if (message.type === 'STOP_EPISODE') return { ok: true, state: await stopEpisode(message.outcome) };
    if (message.type === 'TRANSITION_START') return transitionStart(sender, message.transition);
    if (message.type === 'TRANSITION_END') return transitionEnd(sender, message.transition);
    return { ok: false, error: 'unknown_message' };
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});
