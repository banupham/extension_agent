'use strict';

importScripts('core/episode_builder.js');

const STATE_KEY = 'trainingCollectorStateV02';
const EpisodeBuilder = globalThis.TrainingCollectorV02.EpisodeBuilder;
const EMPTY = { active: false, episode: null };

async function loadState() {
  const data = await chrome.storage.local.get(STATE_KEY);
  return data[STATE_KEY] || { ...EMPTY };
}

async function saveState(state) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
  return state;
}

function nowIso() { return new Date().toISOString(); }

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function requestSnapshot(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { scope: 'TRAINING_COLLECTOR_V02', type: 'SNAPSHOT' });
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
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
  await saveState(state);
  await chrome.tabs.sendMessage(tab.id, { scope: 'TRAINING_COLLECTOR_V02', type: 'START' }).catch(() => {});
  return state;
}

async function stopEpisode(outcome) {
  const state = await loadState();
  if (!state.active || !state.episode) return state;
  const tabId = state.episode.tabId;
  if (tabId) await chrome.tabs.sendMessage(tabId, { scope: 'TRAINING_COLLECTOR_V02', type: 'STOP' }).catch(() => {});
  state.active = false;
  state.episode.endedAt = nowIso();
  state.episode.finalOutcome = outcome || { status: 'stopped' };
  return saveState(state);
}

async function transitionStart(sender, transition) {
  const state = await loadState();
  if (!state.active || !state.episode || sender.tab?.id !== state.episode.tabId) return { ok: true, ignored: true };
  EpisodeBuilder.beginTransition(state.episode, transition || {});
  EpisodeBuilder.capTransitions(state.episode);
  await saveState(state);
  return { ok: true };
}

async function transitionEnd(sender, transition) {
  const state = await loadState();
  if (!state.active || !state.episode || sender.tab?.id !== state.episode.tabId) return { ok: true, ignored: true };
  const matched = EpisodeBuilder.finishTransition(state.episode, transition || {});
  await saveState(state);
  return { ok: true, matched };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.scope !== 'TRAINING_COLLECTOR_V02') return false;
  (async () => {
    if (message.type === 'GET_STATE') return { ok: true, state: await loadState() };
    if (message.type === 'START_EPISODE') return { ok: true, state: await startEpisode(message.task || {}) };
    if (message.type === 'STOP_EPISODE') return { ok: true, state: await stopEpisode(message.outcome) };
    if (message.type === 'TRANSITION_START') return transitionStart(sender, message.transition);
    if (message.type === 'TRANSITION_END') return transitionEnd(sender, message.transition);
    return { ok: false, error: 'unknown_message' };
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});
