'use strict';

importScripts(
  'background.js',
  'core/frame_episode_background_bridge.js'
);

const LIGHT_EPISODE_SCOPE = 'TRAINING_COLLECTOR_EPISODE_STATE_V1';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.scope !== LIGHT_EPISODE_SCOPE) return false;
  (async () => {
    if (message.type === 'GET_STATE') {
      return {
        ok: true,
        state: await loadEpisodeState(),
        queue: EpisodeStateQueue?.status?.() || null
      };
    }
    return { ok: false, error: 'unknown_light_episode_message' };
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});
