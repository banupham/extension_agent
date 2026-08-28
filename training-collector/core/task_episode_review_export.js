'use strict';

(function initTaskEpisodeReviewExport(root) {
  const NS = root.TrainingCollectorV09 = root.TrainingCollectorV09 || {};
  const REVIEW_EXPORT_VERSION = '0.1.0';

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function rawActionSummary(action = {}) {
    if (!isObject(action)) return null;
    const out = {
      actionVersion: typeof action.actionVersion === 'string' ? action.actionVersion : null,
      kind: typeof action.kind === 'string' ? action.kind : 'unknown',
      targetRef: typeof action.targetRef === 'string' ? action.targetRef : null,
      t: Number.isFinite(Number(action.t)) ? Number(action.t) : null
    };
    for (const key of ['operation', 'keyClass', 'code', 'inputType']) {
      if (typeof action[key] === 'string') out[key] = action[key];
    }
    if (typeof action.repeat === 'boolean') out.repeat = action.repeat;
    if (typeof action.focused === 'boolean') out.focused = action.focused;
    if (Number.isFinite(Number(action.length))) out.length = Math.max(0, Number(action.length));
    return out;
  }

  function safeOutcome(outcome = {}) {
    return {
      actionSucceeded: outcome?.actionSucceeded !== false,
      partial: outcome?.partial === true
    };
  }

  function safeTransition(transition = {}) {
    return {
      transitionId: typeof transition.transitionId === 'string' ? transition.transitionId : null,
      status: typeof transition.status === 'string' ? transition.status : 'unknown',
      startedAtMs: Number.isFinite(Number(transition.startedAtMs)) ? Number(transition.startedAtMs) : null,
      endedAtMs: Number.isFinite(Number(transition.endedAtMs)) ? Number(transition.endedAtMs) : null,
      rawAction: rawActionSummary(transition.action),
      strategyObservationBefore: isObject(transition.strategyObservationBefore) ? transition.strategyObservationBefore : null,
      strategyObservationAfter: isObject(transition.strategyObservationAfter) ? transition.strategyObservationAfter : null,
      outcome: safeOutcome(transition.outcome)
    };
  }

  function buildReviewExport(episode, options = {}) {
    if (!isObject(episode)) throw new Error('task episode object required');
    const transitions = (Array.isArray(episode.transitions) ? episode.transitions : []).map(safeTransition);
    const strategyReady = transitions.length > 0 && transitions.every(transition => (
      transition.status === 'complete' &&
      !!transition.transitionId &&
      isObject(transition.strategyObservationBefore) &&
      isObject(transition.strategyObservationAfter) &&
      transition.outcome.partial === false
    ));
    return {
      reviewExportVersion: REVIEW_EXPORT_VERSION,
      exportedAt: options.exportedAt || new Date().toISOString(),
      episodeSchemaVersion: typeof episode.schemaVersion === 'string' ? episode.schemaVersion : null,
      episodeId: typeof episode.episodeId === 'string' ? episode.episodeId : null,
      task: isObject(episode.task) ? episode.task : {},
      startedAt: episode.startedAt || null,
      endedAt: episode.endedAt || null,
      transitions,
      finalOutcome: isObject(episode.finalOutcome) ? episode.finalOutcome : null,
      strategyReady,
      privacy: {
        sourcePolicyVersion: episode.privacy?.policyVersion || null,
        rawTextValuesStored: episode.privacy?.rawTextValuesStored === true,
        passwordValuesStored: episode.privacy?.passwordValuesStored === true,
        cookiesStored: episode.privacy?.cookiesStored === true,
        storageSecretsStored: episode.privacy?.storageSecretsStored === true,
        authorizationDataStored: episode.privacy?.authorizationDataStored === true,
        selectorsExported: false,
        tabIdExported: false,
        rawActionCoordinatesExported: false
      },
      trainingEligibility: {
        eligible: false,
        reasons: [
          'human_review_required',
          'semantic_agent_action_labels_required',
          'outcome_progress_review_required',
          'split_assignment_required'
        ]
      },
      reviewRequirements: {
        taskPrivacyReviewed: false,
        semanticLabelsVerified: false,
        outcomeVerified: false,
        splitGroupAssigned: false
      }
    };
  }

  NS.TaskEpisodeReviewExport = {
    REVIEW_EXPORT_VERSION,
    rawActionSummary,
    safeTransition,
    buildReviewExport
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.TaskEpisodeReviewExport;
})(typeof globalThis !== 'undefined' ? globalThis : this);
