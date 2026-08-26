'use strict';

const REVIEW_CONTRACT = require('../../HUMAN_STRATEGY_REVIEW_CONTRACT.json');
const { validateAgentAction } = require('../strategy/agent_action_contract.js');
const { reduceOutcomeToControl } = require('../goal/outcome_controller.js');
const { evaluateEpisodeBudget } = require('../goal/episode_budget.js');
const { buildEpisodeRecord } = require('./episode_outcome_dataset.js');

const HUMAN_REVIEW_CONTRACT_VERSION = REVIEW_CONTRACT.contractVersion;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function finite01(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`${name} must be between 0 and 1`);
  return n;
}

function assertReviewExport(reviewExport) {
  if (!isPlainObject(reviewExport)) throw new Error('review export object required');
  if (reviewExport.reviewExportVersion !== REVIEW_CONTRACT.input.reviewExportVersion) {
    throw new Error(`unsupported reviewExportVersion: ${reviewExport.reviewExportVersion || '<missing>'}`);
  }
  if (reviewExport.strategyReady !== true) throw new Error('review export must be strategyReady=true');
  const episodeId = requireString(reviewExport.episodeId, 'reviewExport.episodeId');
  const transitions = Array.isArray(reviewExport.transitions) ? reviewExport.transitions : [];
  if (!transitions.length) throw new Error('review export must contain transitions');
  for (const [index, transition] of transitions.entries()) {
    if (!isPlainObject(transition)) throw new Error(`reviewExport.transitions[${index}] must be an object`);
    requireString(transition.transitionId, `reviewExport.transitions[${index}].transitionId`);
    if (transition.status !== 'complete') throw new Error(`reviewExport.transitions[${index}] must be complete`);
    if (!isPlainObject(transition.strategyObservationBefore) || !isPlainObject(transition.strategyObservationAfter)) {
      throw new Error(`reviewExport.transitions[${index}] requires Strategy observations before/after`);
    }
    if (transition.outcome?.partial === true) throw new Error(`reviewExport.transitions[${index}] outcome must not be partial`);
  }

  const privacy = isPlainObject(reviewExport.privacy) ? reviewExport.privacy : {};
  const unsafe = [
    ['rawTextValuesStored', privacy.rawTextValuesStored === true],
    ['passwordValuesStored', privacy.passwordValuesStored === true],
    ['cookiesStored', privacy.cookiesStored === true],
    ['storageSecretsStored', privacy.storageSecretsStored === true],
    ['authorizationDataStored', privacy.authorizationDataStored === true],
    ['selectorsExported', privacy.selectorsExported !== false],
    ['tabIdExported', privacy.tabIdExported !== false],
    ['rawActionCoordinatesExported', privacy.rawActionCoordinatesExported !== false]
  ].filter(([, bad]) => bad).map(([name]) => name);
  if (unsafe.length) throw new Error(`review export privacy boundary failed: ${unsafe.join(', ')}`);

  return { episodeId, transitions };
}

function normalizeReviewConfirmations(annotation) {
  if (!isPlainObject(annotation)) throw new Error('annotation object required');
  if (annotation.contractVersion !== HUMAN_REVIEW_CONTRACT_VERSION) {
    throw new Error(`annotation.contractVersion must equal ${HUMAN_REVIEW_CONTRACT_VERSION}`);
  }
  const review = isPlainObject(annotation.review) ? annotation.review : {};
  const required = [
    'taskPrivacyReviewed',
    'semanticLabelsVerified',
    'outcomeVerified',
    'credentialsExcluded',
    'secretsExcluded'
  ];
  for (const key of required) {
    if (review[key] !== true) throw new Error(`annotation.review.${key} must be true`);
  }
  return review;
}

function normalizeReviewedOutcome(input, previousProgress, index) {
  if (!isPlainObject(input)) throw new Error(`annotations.steps[${index}].outcome must be an object`);
  const progress = finite01(input.progress, `annotations.steps[${index}].outcome.progress`);
  const progressDelta = progress - previousProgress;
  const metadata = isPlainObject(input.metadata) ? { ...input.metadata } : {};
  metadata.progressBefore = previousProgress;
  metadata.progressDelta = progressDelta;
  metadata.labelSource = 'verified-human-review';
  return {
    actionSucceeded: input.actionSucceeded === true,
    taskSucceeded: input.taskSucceeded === true,
    progress,
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    errorCode: input.errorCode == null ? null : String(input.errorCode),
    metadata
  };
}

function monotonicTimes(transitions) {
  let startedAtMs = Number(transitions[0]?.startedAtMs);
  if (!Number.isFinite(startedAtMs)) startedAtMs = 0;
  let previousNow = startedAtMs;
  return transitions.map((transition, index) => {
    let nowMs = Number(transition?.endedAtMs);
    if (!Number.isFinite(nowMs) || nowMs < previousNow) nowMs = previousNow + 100;
    if (index === 0 && nowMs < startedAtMs) nowMs = startedAtMs + 100;
    previousNow = nowMs;
    return { startedAtMs, nowMs };
  });
}

function terminalResultFromStep(step) {
  if (!step) throw new Error('final reviewed step required');
  if (step.budget.status === 'done' || step.control.status === 'done') {
    return {
      status: 'done',
      reasonCode: step.budget.reasonCode || step.control.reasonCode || 'goal_satisfied',
      taskSucceeded: true,
      finalProgress: step.progress.after,
      verified: true
    };
  }
  if (step.budget.status === 'blocked' || step.control.status === 'blocked') {
    return {
      status: 'blocked',
      reasonCode: step.budget.reasonCode || step.control.reasonCode || 'blocked',
      taskSucceeded: false,
      finalProgress: step.progress.after,
      verified: true
    };
  }
  if (step.budget.status === 'failed' && step.budget.terminal === true) {
    return {
      status: 'failed',
      reasonCode: step.budget.reasonCode || 'episode_budget_failed',
      taskSucceeded: false,
      finalProgress: step.progress.after,
      verified: true
    };
  }
  throw new Error('reviewed episode is not terminal under A5.2/A5.3 controls');
}

function assertReviewFinalOutcome(reviewExport, terminalResult) {
  const status = String(reviewExport?.finalOutcome?.status || '').trim().toLowerCase();
  if (!status) throw new Error('reviewExport.finalOutcome.status required');
  if (status === 'success' && terminalResult.status !== 'done') {
    throw new Error('human finalOutcome success requires terminal done Strategy record');
  }
  if (status === 'failed' && terminalResult.status === 'done') {
    throw new Error('human finalOutcome failed cannot produce terminal done Strategy record');
  }
  if (status === 'stopped') throw new Error('stopped human episode is not training-review terminal evidence');
}

function adaptHumanReviewToStrategyEpisode(reviewExport, annotation, options = {}) {
  const { episodeId, transitions } = assertReviewExport(reviewExport);
  normalizeReviewConfirmations(annotation);
  if (requireString(annotation.episodeId, 'annotation.episodeId') !== episodeId) {
    throw new Error('annotation.episodeId must match review export episodeId');
  }
  const splitGroup = requireString(annotation.splitGroup, 'annotation.splitGroup');
  const annotations = Array.isArray(annotation.steps) ? annotation.steps : [];
  if (annotations.length !== transitions.length) {
    throw new Error('annotation.steps length must equal review export transitions length');
  }

  const byTransitionId = new Map();
  for (const [index, item] of annotations.entries()) {
    if (!isPlainObject(item)) throw new Error(`annotation.steps[${index}] must be an object`);
    const transitionId = requireString(item.transitionId, `annotation.steps[${index}].transitionId`);
    if (byTransitionId.has(transitionId)) throw new Error(`duplicate annotation transitionId: ${transitionId}`);
    byTransitionId.set(transitionId, item);
  }

  const times = monotonicTimes(transitions);
  let previousProgress = 0;
  let history = [];
  const steps = transitions.map((transition, index) => {
    const reviewed = byTransitionId.get(transition.transitionId);
    if (!reviewed) throw new Error(`missing annotation for transitionId ${transition.transitionId}`);
    const action = validateAgentAction(reviewed.action);
    const outcome = normalizeReviewedOutcome(reviewed.outcome, previousProgress, index);
    const blocker = reviewed.blocker == null ? null : reviewed.blocker;
    const control = reduceOutcomeToControl({ outcome, blocker });
    const budget = evaluateEpisodeBudget({
      history,
      control,
      actionType: action.type,
      startedAtMs: times[index].startedAtMs,
      nowMs: times[index].nowMs,
      budgets: options.budgets || {}
    });
    history = budget.history;
    const progress = {
      before: previousProgress,
      after: outcome.progress,
      delta: outcome.progress - previousProgress
    };
    previousProgress = outcome.progress;

    return {
      stepIndex: index,
      observation: transition.strategyObservationBefore,
      decision: {
        contractVersion: '0.1.0',
        status: 'act',
        action,
        targetRef: action.targetRef,
        confidence: 1,
        reasonCode: typeof reviewed.decisionReasonCode === 'string' && reviewed.decisionReasonCode.trim()
          ? reviewed.decisionReasonCode.trim()
          : 'verified_human_demonstration',
        expectedOutcome: action.expectedOutcome || {},
        recovery: {},
        metadata: {
          labelSource: 'verified-human-review',
          transitionId: transition.transitionId
        }
      },
      action,
      outcome,
      control,
      budget,
      progress
    };
  });

  const terminalResult = terminalResultFromStep(steps.at(-1));
  assertReviewFinalOutcome(reviewExport, terminalResult);

  const task = isPlainObject(annotation.taskOverride) ? annotation.taskOverride : reviewExport.task;
  const record = buildEpisodeRecord({
    episodeId: `human-${episodeId}`,
    source: {
      kind: 'human-demonstration',
      labelVerified: true,
      outcomeVerified: true,
      provenanceId: episodeId,
      collectedAt: reviewExport.exportedAt || reviewExport.endedAt || null
    },
    task,
    steps,
    terminalResult,
    split: 'unassigned',
    splitGroup,
    privacy: {
      redacted: true,
      credentialsExcluded: true,
      secretsExcluded: true,
      policyVersion: 'human-strategy-review-0.1.0'
    }
  });

  return {
    adapterVersion: HUMAN_REVIEW_CONTRACT_VERSION,
    provenance: {
      reviewExportVersion: reviewExport.reviewExportVersion,
      sourceEpisodeId: episodeId,
      rawTelemetryPreservedExternally: true
    },
    record
  };
}

module.exports = {
  HUMAN_REVIEW_CONTRACT_VERSION,
  assertReviewExport,
  normalizeReviewedOutcome,
  monotonicTimes,
  terminalResultFromStep,
  adaptHumanReviewToStrategyEpisode
};
