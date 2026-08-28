'use strict';

const REVIEW_CONTRACT = require('../../HUMAN_STRATEGY_REVIEW_CONTRACT.json');
const { validateAgentAction } = require('../strategy/agent_action_contract.js');
const { reduceOutcomeToControl } = require('../goal/outcome_controller.js');
const { evaluateEpisodeBudget } = require('../goal/episode_budget.js');
const { buildEpisodeRecord } = require('./episode_outcome_dataset.js');

const HUMAN_REVIEW_CONTRACT_VERSION = REVIEW_CONTRACT.contractVersion;
const MACHINE_VERIFICATION_KIND = 'machine-verified';

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
  for (const key of ['taskPrivacyReviewed', 'semanticLabelsVerified', 'outcomeVerified', 'credentialsExcluded', 'secretsExcluded']) {
    if (review[key] !== true) throw new Error(`annotation.review.${key} must be true`);
  }
  return review;
}

function normalizeMachineVerification(annotation) {
  if (!isPlainObject(annotation)) throw new Error('annotation object required');
  if (annotation.contractVersion !== HUMAN_REVIEW_CONTRACT_VERSION) {
    throw new Error(`annotation.contractVersion must equal ${HUMAN_REVIEW_CONTRACT_VERSION}`);
  }
  const proof = isPlainObject(annotation.machineVerification) ? annotation.machineVerification : {};
  if (proof.method !== 'machine-eligibility-gate') throw new Error('annotation.machineVerification.method must be machine-eligibility-gate');
  if (proof.status !== 'accept') throw new Error('annotation.machineVerification.status must be accept');
  for (const key of ['taskPrivacyVerified', 'semanticLabelsVerified', 'outcomeVerified', 'credentialsExcluded', 'secretsExcluded']) {
    if (proof[key] !== true) throw new Error(`annotation.machineVerification.${key} must be true`);
  }
  requireString(proof.eligibilityVersion, 'annotation.machineVerification.eligibilityVersion');
  requireString(proof.eligibilityDigest, 'annotation.machineVerification.eligibilityDigest');
  requireString(proof.sourceCandidateDigest, 'annotation.machineVerification.sourceCandidateDigest');
  const outcome = isPlainObject(proof.outcomeVerification) ? proof.outcomeVerification : {};
  if (outcome.status !== 'verified') throw new Error('annotation.machineVerification.outcomeVerification.status must be verified');
  return proof;
}

function normalizeReviewedOutcome(input, previousProgress, index, options = {}) {
  if (!isPlainObject(input)) throw new Error(`annotations.steps[${index}].outcome must be an object`);
  const progress = finite01(input.progress, `annotations.steps[${index}].outcome.progress`);
  const progressDelta = progress - previousProgress;
  const metadata = isPlainObject(input.metadata) ? { ...input.metadata } : {};
  metadata.progressBefore = previousProgress;
  metadata.progressDelta = progressDelta;
  metadata.labelSource = options.labelSource || 'verified-human-review';
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
  if (!step) throw new Error('final verified step required');
  if (step.budget.status === 'done' || step.control.status === 'done') {
    return { status: 'done', reasonCode: step.budget.reasonCode || step.control.reasonCode || 'goal_satisfied', taskSucceeded: true, finalProgress: step.progress.after, verified: true };
  }
  if (step.budget.status === 'blocked' || step.control.status === 'blocked') {
    return { status: 'blocked', reasonCode: step.budget.reasonCode || step.control.reasonCode || 'blocked', taskSucceeded: false, finalProgress: step.progress.after, verified: true };
  }
  if (step.budget.status === 'failed' && step.budget.terminal === true) {
    return { status: 'failed', reasonCode: step.budget.reasonCode || 'episode_budget_failed', taskSucceeded: false, finalProgress: step.progress.after, verified: true };
  }
  throw new Error('verified episode is not terminal under A5.2/A5.3 controls');
}

function assertReviewFinalOutcome(reviewExport, terminalResult) {
  const status = String(reviewExport?.finalOutcome?.status || '').trim().toLowerCase();
  if (!status) throw new Error('reviewExport.finalOutcome.status required');
  if (status === 'success' && terminalResult.status !== 'done') throw new Error('finalOutcome success requires terminal done Strategy record');
  if (status === 'failed' && terminalResult.status === 'done') throw new Error('finalOutcome failed cannot produce terminal done Strategy record');
  if (status === 'stopped') throw new Error('stopped episode is not training terminal evidence');
}

function normalizeTransitionReviews(transitions, annotation) {
  const annotations = Array.isArray(annotation.steps) ? annotation.steps : [];
  if (annotations.length !== transitions.length) throw new Error('annotation.steps length must equal review export transitions length');
  const byTransitionId = new Map();
  for (const [index, item] of annotations.entries()) {
    if (!isPlainObject(item)) throw new Error(`annotation.steps[${index}] must be an object`);
    const transitionId = requireString(item.transitionId, `annotation.steps[${index}].transitionId`);
    if (byTransitionId.has(transitionId)) throw new Error(`duplicate annotation transitionId: ${transitionId}`);
    if (typeof item.include !== 'boolean') throw new Error(`annotation.steps[${index}].include must be boolean`);
    if (item.include === false) requireString(item.exclusionReason, `annotation.steps[${index}].exclusionReason`);
    byTransitionId.set(transitionId, item);
  }
  for (const transition of transitions) {
    if (!byTransitionId.has(transition.transitionId)) throw new Error(`missing annotation for transitionId ${transition.transitionId}`);
  }
  return byTransitionId;
}

function verificationProfile(annotation, options = {}) {
  const kind = options.verificationKind === MACHINE_VERIFICATION_KIND ? MACHINE_VERIFICATION_KIND : 'human';
  if (kind === MACHINE_VERIFICATION_KIND) {
    const proof = normalizeMachineVerification(annotation);
    return {
      kind,
      proof,
      sourceKind: 'approved-controller',
      labelSource: 'verified-machine-evidence',
      decisionReasonCode: 'verified_machine_demonstration',
      episodeIdPrefix: 'machine-',
      privacyPolicyVersion: `machine-eligibility-${proof.eligibilityVersion}`
    };
  }
  const proof = normalizeReviewConfirmations(annotation);
  return {
    kind: 'human',
    proof,
    sourceKind: 'human-demonstration',
    labelSource: 'verified-human-review',
    decisionReasonCode: 'verified_human_demonstration',
    episodeIdPrefix: 'human-',
    privacyPolicyVersion: `human-strategy-review-${HUMAN_REVIEW_CONTRACT_VERSION}`
  };
}

function adaptVerifiedReviewToStrategyEpisode(reviewExport, annotation, options = {}) {
  const { episodeId, transitions } = assertReviewExport(reviewExport);
  const profile = verificationProfile(annotation, options);
  if (requireString(annotation.episodeId, 'annotation.episodeId') !== episodeId) throw new Error('annotation.episodeId must match review export episodeId');
  const splitGroup = requireString(annotation.splitGroup, 'annotation.splitGroup');
  const byTransitionId = normalizeTransitionReviews(transitions, annotation);
  const times = monotonicTimes(transitions);

  let previousProgress = 0;
  let history = [];
  const steps = [];
  const excludedTransitions = [];

  transitions.forEach((transition, sourceIndex) => {
    const reviewed = byTransitionId.get(transition.transitionId);
    if (reviewed.include === false) {
      excludedTransitions.push({ transitionId: transition.transitionId, reason: String(reviewed.exclusionReason).trim() });
      return;
    }

    const action = validateAgentAction(reviewed.action);
    const outcome = normalizeReviewedOutcome(reviewed.outcome, previousProgress, sourceIndex, { labelSource: profile.labelSource });
    const blocker = reviewed.blocker == null ? null : reviewed.blocker;
    const control = reduceOutcomeToControl({ outcome, blocker });
    const budget = evaluateEpisodeBudget({
      history,
      control,
      actionType: action.type,
      startedAtMs: times[sourceIndex].startedAtMs,
      nowMs: times[sourceIndex].nowMs,
      budgets: options.budgets || {}
    });
    history = budget.history;
    const progress = { before: previousProgress, after: outcome.progress, delta: outcome.progress - previousProgress };
    previousProgress = outcome.progress;

    steps.push({
      stepIndex: steps.length,
      observation: transition.strategyObservationBefore,
      decision: {
        contractVersion: '0.1.0',
        status: 'act',
        action,
        targetRef: action.targetRef,
        confidence: 1,
        reasonCode: typeof reviewed.decisionReasonCode === 'string' && reviewed.decisionReasonCode.trim()
          ? reviewed.decisionReasonCode.trim()
          : profile.decisionReasonCode,
        expectedOutcome: action.expectedOutcome || {},
        recovery: {},
        metadata: { labelSource: profile.labelSource, transitionId: transition.transitionId }
      },
      action,
      outcome,
      control,
      budget,
      progress
    });
  });

  if (!steps.length) throw new Error('at least one verified transition must be included as a Strategy step');

  const terminalResult = terminalResultFromStep(steps.at(-1));
  assertReviewFinalOutcome(reviewExport, terminalResult);
  const task = isPlainObject(annotation.taskOverride) ? annotation.taskOverride : reviewExport.task;
  const record = buildEpisodeRecord({
    episodeId: `${profile.episodeIdPrefix}${episodeId}`,
    source: {
      kind: profile.sourceKind,
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
      policyVersion: profile.privacyPolicyVersion
    }
  });

  return {
    adapterVersion: HUMAN_REVIEW_CONTRACT_VERSION,
    verificationKind: profile.kind,
    provenance: {
      reviewExportVersion: reviewExport.reviewExportVersion,
      sourceEpisodeId: episodeId,
      rawTelemetryPreservedExternally: true,
      verifiedTransitionCount: transitions.length,
      includedTransitionCount: steps.length,
      excludedTransitions
    },
    record
  };
}

function adaptHumanReviewToStrategyEpisode(reviewExport, annotation, options = {}) {
  return adaptVerifiedReviewToStrategyEpisode(reviewExport, annotation, { ...options, verificationKind: 'human' });
}

module.exports = {
  HUMAN_REVIEW_CONTRACT_VERSION,
  MACHINE_VERIFICATION_KIND,
  assertReviewExport,
  normalizeReviewConfirmations,
  normalizeMachineVerification,
  normalizeReviewedOutcome,
  monotonicTimes,
  terminalResultFromStep,
  normalizeTransitionReviews,
  verificationProfile,
  adaptVerifiedReviewToStrategyEpisode,
  adaptHumanReviewToStrategyEpisode
};
