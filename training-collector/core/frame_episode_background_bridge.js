'use strict';

(function initFrameEpisodeBackgroundBridge(root) {
  const SCOPE = 'TRAINING_COLLECTOR_FRAME_EPISODE_V1';
  const EpisodeBuilder = root.TrainingCollectorV02?.EpisodeBuilder;

  function sameEpisode(state, sender) {
    return !!state?.active && !!state?.episode && sender?.tab?.id === state.episode.tabId;
  }

  function sourceContext(sender, message = {}) {
    return {
      frameId: sender?.frameId ?? 0,
      documentId: sender?.documentId || null,
      documentLifecycle: sender?.documentLifecycle || null,
      pageInstanceId: String(message?.pageInstanceId || '').trim() || null,
      isTopFrame: (sender?.frameId ?? 0) === 0
    };
  }

  async function status(sender) {
    const state = await consistentEpisodeState();
    return {
      ok: true,
      active: sameEpisode(state, sender),
      episodeId: sameEpisode(state, sender) ? state.episode.episodeId : null,
      frameId: sender?.frameId ?? 0,
      documentId: sender?.documentId || null
    };
  }

  function transitionStart(sender, message = {}) {
    return queueEpisodeMutation(async () => {
      const state = await loadEpisodeState();
      if (!sameEpisode(state, sender)) return { ok: true, ignored: true };
      const transition = {
        ...(message.transition || {}),
        sourceContext: sourceContext(sender, message)
      };
      EpisodeBuilder.beginTransition(state.episode, transition);
      EpisodeBuilder.capTransitions(state.episode);
      await saveEpisodeState(state);
      return { ok: true, ignored: false };
    });
  }

  function transitionEnd(sender, message = {}) {
    return queueEpisodeMutation(async () => {
      const state = await loadEpisodeState();
      if (!sameEpisode(state, sender)) return { ok: true, ignored: true, matched: false };
      const matched = EpisodeBuilder.finishTransition(state.episode, message.transition || {});
      if (matched) await saveEpisodeState(state);
      return { ok: true, ignored: false, matched };
    });
  }

  function documentReady(sender, message = {}) {
    return queueEpisodeMutation(async () => {
      const state = await loadEpisodeState();
      if (!sameEpisode(state, sender)) return { ok: true, ignored: true, settled: 0 };

      const frameId = sender?.frameId ?? 0;
      const currentPageInstanceId = String(message.pageInstanceId || '').trim();
      const stateAfter = message.observation && typeof message.observation === 'object' ? message.observation : null;
      const strategyObservationAfter = message.strategyObservation && typeof message.strategyObservation === 'object'
        ? message.strategyObservation
        : null;
      if (!currentPageInstanceId || !stateAfter || !strategyObservationAfter) {
        return { ok: false, error: 'frame_episode_document_ready_snapshot_required', settled: 0 };
      }

      let settled = 0;
      for (const transition of state.episode.transitions || []) {
        if (transition?.status !== 'pending') continue;
        if ((transition?.sourceContext?.frameId ?? 0) !== frameId) continue;
        if (transition?.sourceContext?.pageInstanceId === currentPageInstanceId) continue;
        const matched = EpisodeBuilder.finishTransition(state.episode, {
          transitionId: transition.transitionId,
          endedAtMs: Number(message.observedAtMs || 0),
          stateAfter,
          strategyObservationAfter,
          actionSucceeded: true,
          outcome: {
            documentChanged: true,
            settlementReason: 'next_subframe_document_ready'
          }
        });
        if (matched) settled += 1;
      }
      if (settled > 0) await saveEpisodeState(state);
      return { ok: true, ignored: false, settled };
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.scope !== SCOPE) return false;
    (async () => {
      if (message.type === 'STATUS') return status(sender);
      if (message.type === 'TRANSITION_START') return transitionStart(sender, message);
      if (message.type === 'TRANSITION_END') return transitionEnd(sender, message);
      if (message.type === 'DOCUMENT_READY') return documentReady(sender, message);
      return { ok: false, error: 'unknown_frame_episode_message' };
    })().then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
