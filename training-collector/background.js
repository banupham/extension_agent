'use strict';

importScripts('core/episode_builder.js', 'core/raw_session_store.js');

const EPISODE_STATE_KEY = 'trainingCollectorStateV03';
const EpisodeBuilder = globalThis.TrainingCollectorV02.EpisodeBuilder;
const RawStore = globalThis.TrainingCollectorV03.RawSessionStore;
const EMPTY = { active: false, episode: null };
let browserSessionInitPromise = null;

function nowIso() { return new Date().toISOString(); }

async function loadEpisodeState() {
  const data = await chrome.storage.local.get(EPISODE_STATE_KEY);
  return data[EPISODE_STATE_KEY] || { ...EMPTY };
}

async function saveEpisodeState(state) {
  await chrome.storage.local.set({ [EPISODE_STATE_KEY]: state });
  return state;
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function requestSnapshot(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { scope: 'TRAINING_COLLECTOR_V03', type: 'SNAPSHOT' });
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

async function getRawIndex() {
  const data = await chrome.storage.local.get(RawStore.INDEX_KEY);
  return Array.isArray(data[RawStore.INDEX_KEY]) ? data[RawStore.INDEX_KEY] : [];
}

async function closeDanglingSessions() {
  const index = await getRawIndex();
  if (!index.length) return;
  const updates = {};
  for (const sessionId of index.slice(0, RawStore.MAX_SESSION_INDEX)) {
    const key = RawStore.sessionKey(sessionId);
    const data = await chrome.storage.local.get(key);
    const session = data[key];
    if (!session || session.status !== 'active') continue;
    updates[key] = {
      ...session,
      status: 'closed-inferred',
      endedAt: session.lastSeenAt || session.startedAt || nowIso(),
      endReason: 'previous_browser_session_no_longer_active'
    };
  }
  if (Object.keys(updates).length) await chrome.storage.local.set(updates);
}

async function createBrowserSession() {
  await closeDanglingSessions();
  const startedAt = nowIso();
  const sessionId = RawStore.makeSessionId();
  const session = RawStore.createSession(sessionId, startedAt);
  const index = await getRawIndex();
  const nextIndex = [sessionId, ...index.filter(id => id !== sessionId)].slice(0, RawStore.MAX_SESSION_INDEX);
  await chrome.storage.local.set({
    [RawStore.sessionKey(sessionId)]: session,
    [RawStore.INDEX_KEY]: nextIndex
  });
  await chrome.storage.session.set({ [RawStore.CURRENT_SESSION_KEY]: sessionId });
  return session;
}

async function ensureBrowserSessionUnlocked() {
  const current = await chrome.storage.session.get(RawStore.CURRENT_SESSION_KEY);
  const sessionId = current[RawStore.CURRENT_SESSION_KEY];
  if (sessionId) {
    const key = RawStore.sessionKey(sessionId);
    const data = await chrome.storage.local.get(key);
    if (data[key]) return data[key];
  }
  return createBrowserSession();
}

async function ensureBrowserSession() {
  if (!browserSessionInitPromise) {
    browserSessionInitPromise = ensureBrowserSessionUnlocked().finally(() => {
      browserSessionInitPromise = null;
    });
  }
  return browserSessionInitPromise;
}

async function loadRawSession(sessionId) {
  if (!sessionId) return null;
  const key = RawStore.sessionKey(sessionId);
  const data = await chrome.storage.local.get(key);
  return data[key] || null;
}

function eventLastSeenIso(events) {
  let max = 0;
  for (const event of events || []) {
    const ts = Number(event?.tsEpochMs || 0);
    if (Number.isFinite(ts)) max = Math.max(max, ts);
  }
  return max > 0 ? new Date(max).toISOString() : nowIso();
}

async function appendRawBatch(sender, batch) {
  const session = await ensureBrowserSession();
  const incoming = Array.isArray(batch?.events) ? batch.events : [];
  if (!incoming.length) return { ok: true, sessionId: session.sessionId, appended: 0 };

  let chunkIndex = Math.max(0, Number(session.chunkCount || 0) - 1);
  let chunk = [];
  if (session.chunkCount > 0 && Number(session.lastChunkSize || 0) < RawStore.CHUNK_SIZE) {
    const key = RawStore.chunkKey(session.sessionId, chunkIndex);
    const data = await chrome.storage.local.get(key);
    chunk = Array.isArray(data[key]) ? data[key] : [];
  } else if (session.chunkCount > 0) {
    chunkIndex = session.chunkCount;
  }

  const writes = {};
  let seq = Number(session.eventCount || 0);
  for (const raw of incoming) {
    const normalized = RawStore.normalizeEvent(raw);
    if (!normalized) continue;
    seq += 1;
    chunk.push({
      ...normalized,
      sessionSeq: seq,
      tabId: sender.tab?.id ?? null,
      windowId: sender.tab?.windowId ?? null,
      frameId: sender.frameId ?? 0
    });
    if (chunk.length >= RawStore.CHUNK_SIZE) {
      writes[RawStore.chunkKey(session.sessionId, chunkIndex)] = chunk;
      chunkIndex += 1;
      chunk = [];
    }
  }

  if (chunk.length) writes[RawStore.chunkKey(session.sessionId, chunkIndex)] = chunk;
  const writtenChunkCount = chunk.length ? chunkIndex + 1 : chunkIndex;
  session.eventCount = seq;
  session.chunkCount = Math.max(Number(session.chunkCount || 0), writtenChunkCount);
  session.lastChunkSize = chunk.length || RawStore.CHUNK_SIZE;
  session.lastSeenAt = eventLastSeenIso(incoming);
  writes[RawStore.sessionKey(session.sessionId)] = session;
  await chrome.storage.local.set(writes);

  return { ok: true, sessionId: session.sessionId, appended: incoming.length, eventCount: session.eventCount };
}

async function rawPreview(sessionId, limit = 100) {
  const session = await loadRawSession(sessionId);
  if (!session) return { session: null, events: [] };
  const count = Math.max(1, Math.min(500, Number(limit || 100)));
  const events = [];
  for (let i = Math.max(0, session.chunkCount - 3); i < session.chunkCount; i += 1) {
    const key = RawStore.chunkKey(session.sessionId, i);
    const data = await chrome.storage.local.get(key);
    if (Array.isArray(data[key])) events.push(...data[key]);
  }
  return { session, events: events.slice(-count) };
}

async function exportRawSession(sessionId) {
  const session = await loadRawSession(sessionId);
  if (!session) throw new Error('raw_session_not_found');
  const events = [];
  for (let i = 0; i < session.chunkCount; i += 1) {
    const key = RawStore.chunkKey(session.sessionId, i);
    const data = await chrome.storage.local.get(key);
    if (Array.isArray(data[key])) events.push(...data[key]);
  }
  return {
    exportVersion: '0.3.0',
    exportedAt: nowIso(),
    session,
    events
  };
}

async function startEpisode(task) {
  const tab = await activeTab();
  if (!tab?.id || !/^https?:/i.test(tab.url || '')) throw new Error('Open a normal http/https page before starting an episode');
  const initial = await requestSnapshot(tab.id);
  const state = {
    active: true,
    episode: EpisodeBuilder.createEpisode({
      task,
      tabId: tab.id,
      initialObservation: initial?.observation || null,
      now: nowIso()
    })
  };
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
  if (!state.active || !state.episode || sender.tab?.id !== state.episode.tabId) return { ok: true, ignored: true };
  EpisodeBuilder.beginTransition(state.episode, transition || {});
  EpisodeBuilder.capTransitions(state.episode);
  await saveEpisodeState(state);
  return { ok: true };
}

async function transitionEnd(sender, transition) {
  const state = await loadEpisodeState();
  if (!state.active || !state.episode || sender.tab?.id !== state.episode.tabId) return { ok: true, ignored: true };
  const matched = EpisodeBuilder.finishTransition(state.episode, transition || {});
  await saveEpisodeState(state);
  return { ok: true, matched };
}

chrome.runtime.onStartup.addListener(() => { ensureBrowserSession().catch(() => {}); });
chrome.runtime.onInstalled.addListener(() => { ensureBrowserSession().catch(() => {}); });
ensureBrowserSession().catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.scope !== 'TRAINING_COLLECTOR_V03') return false;
  (async () => {
    if (message.type === 'HELLO') {
      const session = await ensureBrowserSession();
      const episodeState = await loadEpisodeState();
      return {
        ok: true,
        browserSessionId: session.sessionId,
        episodeActive: !!episodeState.active && episodeState.episode?.tabId === sender.tab?.id
      };
    }
    if (message.type === 'RAW_BATCH') return appendRawBatch(sender, message.batch || {});
    if (message.type === 'GET_RAW_STATUS') {
      const session = await ensureBrowserSession();
      return { ok: true, session };
    }
    if (message.type === 'GET_RAW_PREVIEW') {
      const current = await ensureBrowserSession();
      return { ok: true, ...(await rawPreview(message.sessionId || current.sessionId, message.limit || 100)) };
    }
    if (message.type === 'EXPORT_RAW_SESSION') {
      const current = await ensureBrowserSession();
      return { ok: true, data: await exportRawSession(message.sessionId || current.sessionId) };
    }
    if (message.type === 'GET_STATE') return { ok: true, state: await loadEpisodeState(), rawSession: await ensureBrowserSession() };
    if (message.type === 'START_EPISODE') return { ok: true, state: await startEpisode(message.task || {}) };
    if (message.type === 'STOP_EPISODE') return { ok: true, state: await stopEpisode(message.outcome) };
    if (message.type === 'TRANSITION_START') return transitionStart(sender, message.transition);
    if (message.type === 'TRANSITION_END') return transitionEnd(sender, message.transition);
    return { ok: false, error: 'unknown_message' };
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});
