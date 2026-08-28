'use strict';

(function initEpisodeStopSettlement(root) {
  const NS = root.TrainingCollectorV10 = root.TrainingCollectorV10 || {};
  const VERSION = '0.1.0';

  function pendingCount(state) {
    const transitions = Array.isArray(state?.episode?.transitions) ? state.episode.transitions : [];
    return transitions.filter(item => item?.status === 'pending').length;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0))));
  }

  async function waitForSettlement(loadState, options = {}) {
    if (typeof loadState !== 'function') throw new Error('episode_settlement_load_state_required');
    const timeoutMs = Math.max(0, Number(options.timeoutMs ?? 1800));
    const pollMs = Math.max(1, Number(options.pollMs ?? 60));
    const sleepFn = typeof options.sleep === 'function' ? options.sleep : sleep;
    const nowFn = typeof options.now === 'function' ? options.now : Date.now;
    const startedAt = nowFn();
    const deadline = startedAt + timeoutMs;
    let state = await loadState();
    let pending = pendingCount(state);

    while (state?.active === true && pending > 0 && nowFn() < deadline) {
      await sleepFn(pollMs);
      state = await loadState();
      pending = pendingCount(state);
    }

    return {
      version: VERSION,
      state,
      pending,
      settled: state?.active !== true || pending === 0,
      waitedMs: Math.max(0, nowFn() - startedAt)
    };
  }

  NS.EpisodeStopSettlement = {
    VERSION,
    pendingCount,
    sleep,
    waitForSettlement
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS.EpisodeStopSettlement;
})(typeof globalThis !== 'undefined' ? globalThis : this);
