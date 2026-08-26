'use strict';

(function initEpisodeCaptureGate(root) {
  const NS = root.TrainingCollectorV09 = root.TrainingCollectorV09 || {};

  function assertSnapshotReady(result) {
    if (!result || result.ok !== true || !result.observation || typeof result.observation !== 'object') {
      throw new Error('episode_snapshot_unavailable');
    }
    return result.observation;
  }

  function assertCaptureArmed(result) {
    if (!result || result.ok !== true || result.ignoredSubframe === true) {
      throw new Error('episode_capture_not_armed');
    }
    return result;
  }

  function transitionCounts(episode) {
    const transitions = Array.isArray(episode?.transitions) ? episode.transitions : [];
    let complete = 0;
    let pending = 0;
    for (const transition of transitions) {
      if (transition?.status === 'complete') complete += 1;
      else if (transition?.status === 'pending') pending += 1;
    }
    return { total: transitions.length, complete, pending };
  }

  function assertStopAllowed(episode, outcome = {}) {
    const status = String(outcome?.status || 'stopped').trim().toLowerCase();
    const counts = transitionCounts(episode);
    if (status === 'success') {
      if (counts.complete < 1) throw new Error('episode_success_requires_complete_transition');
      if (counts.pending > 0) throw new Error('episode_success_has_pending_transition');
    }
    return counts;
  }

  NS.EpisodeCaptureGate = {
    assertSnapshotReady,
    assertCaptureArmed,
    transitionCounts,
    assertStopAllowed
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS.EpisodeCaptureGate;
})(typeof globalThis !== 'undefined' ? globalThis : this);
