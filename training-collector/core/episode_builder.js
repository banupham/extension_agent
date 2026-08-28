'use strict';

(function initEpisodeBuilder(root) {
  const NS = root.TrainingCollectorV02 = root.TrainingCollectorV02 || {};

  function createEpisode({ task = {}, tabId = null, initialObservation = null, now = new Date().toISOString() } = {}) {
    return {
      schemaVersion: '0.6.0',
      stateEncoding: 'initial-full-then-diff',
      strategyObservationEncoding: 'full-per-transition-v1',
      episodeId: `ep-${Date.now()}`,
      task: {
        instruction: String(task.instruction || '').trim(),
        type: String(task.type || 'unspecified'),
        args: task.args && typeof task.args === 'object' ? task.args : {}
      },
      startedAt: now,
      endedAt: null,
      tabId,
      initialObservation,
      transitions: [],
      finalOutcome: null,
      privacy: {
        policyVersion: '0.3.0',
        rawTextValuesStored: false,
        passwordValuesStored: false,
        cookiesStored: false,
        storageSecretsStored: false,
        authorizationDataStored: false,
        strategyObservationSelectorsStored: false,
        strategyObservationTabIdStored: false
      }
    };
  }

  function beginTransition(episode, payload = {}) {
    const transitionId = String(payload.transitionId || '');
    if (!transitionId) throw new Error('transitionId required');
    if (episode.transitions.some(x => x.transitionId === transitionId)) return episode;
    episode.transitions.push({
      transitionId,
      status: 'pending',
      startedAtMs: Number(payload.startedAtMs || 0),
      endedAtMs: null,
      sourceContext: payload.sourceContext && typeof payload.sourceContext === 'object' ? payload.sourceContext : null,
      stateBefore: payload.stateBefore || null,
      stateBeforeDiff: payload.stateBeforeDiff || null,
      strategyObservationBefore: payload.strategyObservationBefore || null,
      action: payload.action || null,
      stateAfter: null,
      stateAfterDiff: null,
      strategyObservationAfter: null,
      outcome: { actionSucceeded: null, partial: true }
    });
    return episode;
  }

  function finishTransition(episode, payload = {}) {
    const item = episode.transitions.find(x => x.transitionId === payload.transitionId);
    if (!item) return false;
    item.status = 'complete';
    item.endedAtMs = Number(payload.endedAtMs || item.startedAtMs || 0);
    item.stateAfter = payload.stateAfter || null;
    item.stateAfterDiff = payload.stateAfterDiff || null;
    item.strategyObservationAfter = payload.strategyObservationAfter || null;
    item.outcome = {
      actionSucceeded: payload.actionSucceeded !== false,
      partial: false,
      ...(payload.outcome && typeof payload.outcome === 'object' ? payload.outcome : {})
    };
    return true;
  }

  function capTransitions(episode, max = 2000) {
    if (episode.transitions.length > max) episode.transitions.splice(0, episode.transitions.length - max);
    return episode;
  }

  NS.EpisodeBuilder = { createEpisode, beginTransition, finishTransition, capTransitions };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.EpisodeBuilder;
})(typeof globalThis !== 'undefined' ? globalThis : this);
