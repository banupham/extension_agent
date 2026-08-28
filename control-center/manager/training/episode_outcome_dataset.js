'use strict';

const CONTRACT = require('../../EPISODE_OUTCOME_DATASET_CONTRACT.json');
const {
  validateTask,
  validateObservation,
  validateDecision,
  validateOutcome
} = require('../strategy/contracts.js');
const { validateAgentAction } = require('../strategy/agent_action_contract.js');

const DATASET_CONTRACT_VERSION = CONTRACT.contractVersion;
const SOURCE_KINDS = new Set(CONTRACT.sourceKinds || []);
const SPLITS = new Set(CONTRACT.splits || []);
const TERMINAL_STATUSES = new Set(CONTRACT.terminalStatuses || []);
const CONTROL_STATUSES = new Set(['done', 'continue', 'failed', 'blocked']);
const TRAINING_LABEL_SOURCES = new Set(CONTRACT.trainingPolicy?.eligibleLabelSources || []);
const FORBIDDEN_ANYWHERE = new Set((CONTRACT.privacy?.forbiddenKeysAnywhere || []).map(x => String(x).toLowerCase()));
const FORBIDDEN_DECISION_ACTION = new Set((CONTRACT.privacy?.forbiddenDecisionOrActionKeys || []).map(x => String(x).toLowerCase()));
const EPSILON = 1e-9;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function number01(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`${name} must be between 0 and 1`);
  return n;
}

function finiteNumber(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number`);
  return n;
}

function scanForbiddenKeys(value, forbidden, path = '$', hits = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenKeys(item, forbidden, `${path}[${index}]`, hits));
    return hits;
  }
  if (!isPlainObject(value)) return hits;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (forbidden.has(String(key).toLowerCase())) hits.push(nextPath);
    scanForbiddenKeys(child, forbidden, nextPath, hits);
  }
  return hits;
}

function assertNoForbiddenFields(value, forbidden, name) {
  const hits = scanForbiddenKeys(value, forbidden);
  if (hits.length) throw new Error(`${name} contains forbidden fields: ${hits.join(', ')}`);
}

function sanitizeUrl(rawUrl) {
  const value = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!value) return { url: '', urlQueryKeys: [] };
  try {
    const parsed = new URL(value);
    return {
      url: `${parsed.origin}${parsed.pathname}`,
      urlQueryKeys: Array.from(new Set(Array.from(parsed.searchParams.keys()))).sort()
    };
  } catch (_) {
    const noFragment = value.split('#')[0];
    const queryIndex = noFragment.indexOf('?');
    return {
      url: queryIndex >= 0 ? noFragment.slice(0, queryIndex) : noFragment,
      urlQueryKeys: []
    };
  }
}

function normalizeTask(task) {
  const normalized = validateTask(task);
  assertNoForbiddenFields(normalized, FORBIDDEN_ANYWHERE, 'task');
  return normalized;
}

function normalizeObservation(observation) {
  const normalized = validateObservation(observation);
  if (normalized.privacy?.redacted !== true) throw new Error('observation.privacy.redacted must be true');
  assertNoForbiddenFields(normalized, FORBIDDEN_ANYWHERE, 'observation');
  const safeUrl = sanitizeUrl(normalized.url);
  return {
    ...normalized,
    url: safeUrl.url,
    urlQueryKeys: safeUrl.urlQueryKeys
  };
}

function normalizeSemanticAction(action, name = 'action') {
  assertNoForbiddenFields(action, FORBIDDEN_ANYWHERE, name);
  assertNoForbiddenFields(action, FORBIDDEN_DECISION_ACTION, name);
  return validateAgentAction(action);
}

function semanticActionComparable(action) {
  return JSON.stringify({
    type: action.type,
    targetRef: action.targetRef,
    args: action.args,
    intent: action.intent,
    expectedOutcome: action.expectedOutcome
  });
}

function normalizeDecision(decision) {
  assertNoForbiddenFields(decision, FORBIDDEN_ANYWHERE, 'decision');
  assertNoForbiddenFields(decision, FORBIDDEN_DECISION_ACTION, 'decision');
  const normalized = validateDecision(decision);
  if (normalized.status !== 'act') throw new Error('executed step decision.status must be act');
  return {
    ...normalized,
    action: normalizeSemanticAction(normalized.action, 'decision.action')
  };
}

function normalizeControl(control) {
  if (!isPlainObject(control)) throw new Error('control must be an object');
  const status = requireString(control.status, 'control.status');
  if (!CONTROL_STATUSES.has(status)) throw new Error(`unsupported control.status: ${status}`);
  return {
    status,
    terminal: control.terminal === true,
    shouldReplan: control.shouldReplan === true,
    reasonCode: typeof control.reasonCode === 'string' ? control.reasonCode : 'unspecified',
    errorCode: control.errorCode == null ? null : String(control.errorCode),
    blockerReasonCode: control.blockerReasonCode == null ? null : String(control.blockerReasonCode)
  };
}

function normalizeBudget(budget) {
  if (!isPlainObject(budget)) throw new Error('budget must be an object');
  const status = requireString(budget.status, 'budget.status');
  if (!CONTROL_STATUSES.has(status)) throw new Error(`unsupported budget.status: ${status}`);
  const usage = isPlainObject(budget.usage) ? budget.usage : {};
  return {
    status,
    terminal: budget.terminal === true,
    shouldReplan: budget.shouldReplan === true,
    reasonCode: typeof budget.reasonCode === 'string' ? budget.reasonCode : 'unspecified',
    usage: {
      steps: Math.max(0, Number(usage.steps || 0)),
      replansRequested: Math.max(0, Number(usage.replansRequested || 0)),
      consecutiveFailures: Math.max(0, Number(usage.consecutiveFailures || 0)),
      stalledSteps: Math.max(0, Number(usage.stalledSteps || 0)),
      elapsedMs: Math.max(0, Number(usage.elapsedMs || 0))
    }
  };
}

function normalizeProgress(progress, outcome) {
  if (!isPlainObject(progress)) throw new Error('progress must be an object');
  const before = number01(progress.before, 'progress.before');
  const after = number01(progress.after, 'progress.after');
  const delta = finiteNumber(progress.delta, 'progress.delta');
  if (Math.abs((after - before) - delta) > EPSILON) throw new Error('progress.delta must equal progress.after - progress.before');
  if (Math.abs(after - outcome.progress) > EPSILON) throw new Error('progress.after must equal outcome.progress');
  if (Number.isFinite(Number(outcome.metadata?.progressBefore)) && Math.abs(before - Number(outcome.metadata.progressBefore)) > EPSILON) {
    throw new Error('progress.before must equal outcome.metadata.progressBefore');
  }
  if (Number.isFinite(Number(outcome.metadata?.progressDelta)) && Math.abs(delta - Number(outcome.metadata.progressDelta)) > EPSILON) {
    throw new Error('progress.delta must equal outcome.metadata.progressDelta');
  }
  return { before, after, delta };
}

function assertStepLabelConsistency(step) {
  if (step.control.status === 'done' && step.outcome.taskSucceeded !== true) {
    throw new Error('control.status=done requires outcome.taskSucceeded=true');
  }
  if (step.outcome.taskSucceeded === true && (step.control.status !== 'done' || step.control.terminal !== true)) {
    throw new Error('outcome.taskSucceeded=true requires terminal done control');
  }
  if (step.control.status === 'blocked' && step.control.terminal !== true) {
    throw new Error('control.status=blocked requires control.terminal=true');
  }
  if (semanticActionComparable(step.decision.action) !== semanticActionComparable(step.action)) {
    throw new Error('decision.action must equal executed semantic action label');
  }
}

function normalizeStep(step, expectedIndex) {
  if (!isPlainObject(step)) throw new Error(`steps[${expectedIndex}] must be an object`);
  const stepIndex = Number(step.stepIndex);
  if (!Number.isInteger(stepIndex) || stepIndex !== expectedIndex) throw new Error(`steps[${expectedIndex}].stepIndex must equal ${expectedIndex}`);
  const observation = normalizeObservation(step.observation);
  const decision = normalizeDecision(step.decision);
  const action = normalizeSemanticAction(step.action);
  const outcome = validateOutcome(step.outcome);
  assertNoForbiddenFields(outcome, FORBIDDEN_ANYWHERE, `steps[${expectedIndex}].outcome`);
  const control = normalizeControl(step.control);
  const budget = normalizeBudget(step.budget);
  const progress = normalizeProgress(step.progress, outcome);
  const normalized = {
    stepIndex,
    observation,
    decision,
    action,
    outcome,
    control,
    budget,
    progress
  };
  assertStepLabelConsistency(normalized);
  return normalized;
}

function normalizeSource(source) {
  if (!isPlainObject(source)) throw new Error('source must be an object');
  const kind = requireString(source.kind, 'source.kind');
  if (!SOURCE_KINDS.has(kind)) throw new Error(`unsupported source.kind: ${kind}`);
  return {
    kind,
    labelVerified: source.labelVerified === true,
    outcomeVerified: source.outcomeVerified === true,
    provenanceId: typeof source.provenanceId === 'string' ? source.provenanceId : null,
    collectedAt: source.collectedAt || null
  };
}

function normalizeTerminalResult(terminalResult) {
  if (!isPlainObject(terminalResult)) throw new Error('terminalResult must be an object');
  const status = requireString(terminalResult.status, 'terminalResult.status');
  if (!TERMINAL_STATUSES.has(status)) throw new Error(`unsupported terminalResult.status: ${status}`);
  return {
    status,
    reasonCode: typeof terminalResult.reasonCode === 'string' ? terminalResult.reasonCode : 'unspecified',
    taskSucceeded: terminalResult.taskSucceeded === true,
    finalProgress: number01(terminalResult.finalProgress, 'terminalResult.finalProgress'),
    verified: terminalResult.verified === true
  };
}

function normalizePrivacy(privacy) {
  if (!isPlainObject(privacy)) throw new Error('privacy must be an object');
  return {
    redacted: privacy.redacted === true,
    credentialsExcluded: privacy.credentialsExcluded === true,
    secretsExcluded: privacy.secretsExcluded === true,
    policyVersion: typeof privacy.policyVersion === 'string' ? privacy.policyVersion : null
  };
}

function assertEpisodeConsistency(steps, terminalResult) {
  if (!steps.length) throw new Error('terminal episode must contain at least one executed step');
  for (let i = 0; i < steps.length - 1; i += 1) {
    if (steps[i].control.terminal || steps[i].budget.terminal) throw new Error('only the final step may be terminal');
  }
  const last = steps[steps.length - 1];
  if (Math.abs(last.progress.after - terminalResult.finalProgress) > EPSILON) {
    throw new Error('terminalResult.finalProgress must equal final step progress.after');
  }
  if (terminalResult.status === 'done') {
    if (!last.outcome.taskSucceeded || last.control.status !== 'done' || !last.control.terminal || !terminalResult.taskSucceeded) {
      throw new Error('terminal done result must match final done/taskSucceeded step');
    }
  } else if (terminalResult.status === 'blocked') {
    if (last.control.status !== 'blocked' || !last.control.terminal || terminalResult.taskSucceeded) {
      throw new Error('terminal blocked result must match final blocked step');
    }
  } else if (terminalResult.status === 'failed') {
    const terminalFailure = last.control.status === 'failed' || last.budget.status === 'failed' || last.budget.terminal === true;
    if (!terminalFailure || last.outcome.taskSucceeded || terminalResult.taskSucceeded) {
      throw new Error('terminal failed result must match final failed/budget-terminal unsuccessful step');
    }
  }
}

function trainingEligibilityFor({ source, steps, terminalResult, split, privacy }) {
  const reasons = [];
  if (!TRAINING_LABEL_SOURCES.has(source.kind)) reasons.push('source_kind_not_training_eligible');
  if (!source.labelVerified) reasons.push('decision_label_not_verified');
  if (!source.outcomeVerified || !terminalResult.verified) reasons.push('outcome_not_verified');
  if (!steps.length) reasons.push('no_executed_steps');
  if (split !== 'train') reasons.push('split_not_train');
  if (!privacy.redacted) reasons.push('privacy_not_redacted');
  if (!privacy.credentialsExcluded) reasons.push('credentials_not_explicitly_excluded');
  if (!privacy.secretsExcluded) reasons.push('secrets_not_explicitly_excluded');
  return {
    eligible: reasons.length === 0,
    reasons
  };
}

function buildEpisodeRecord(input = {}) {
  if (!isPlainObject(input)) throw new Error('episode record input must be an object');
  const episodeId = requireString(input.episodeId, 'episodeId');
  const source = normalizeSource(input.source);
  const task = normalizeTask(input.task);
  const split = requireString(input.split || 'unassigned', 'split');
  if (!SPLITS.has(split)) throw new Error(`unsupported split: ${split}`);
  const splitGroup = requireString(input.splitGroup, 'splitGroup');
  const privacy = normalizePrivacy(input.privacy);
  if (!privacy.redacted) throw new Error('privacy.redacted must be true');
  if (!privacy.credentialsExcluded) throw new Error('privacy.credentialsExcluded must be true');
  if (!privacy.secretsExcluded) throw new Error('privacy.secretsExcluded must be true');
  const steps = Array.isArray(input.steps) ? input.steps.map((step, index) => normalizeStep(step, index)) : [];
  const terminalResult = normalizeTerminalResult(input.terminalResult);
  assertEpisodeConsistency(steps, terminalResult);
  const record = {
    contractVersion: DATASET_CONTRACT_VERSION,
    episodeId,
    source,
    task,
    steps,
    terminalResult,
    split,
    splitGroup,
    privacy,
    trainingEligibility: null
  };
  assertNoForbiddenFields(record, FORBIDDEN_ANYWHERE, 'episode record');
  record.trainingEligibility = trainingEligibilityFor(record);
  return record;
}

function validateDataset(records = []) {
  if (!Array.isArray(records)) throw new Error('dataset records must be an array');
  const normalized = [];
  const errors = [];
  const seenEpisodeIds = new Set();
  const splitByGroup = new Map();

  records.forEach((record, index) => {
    try {
      const item = buildEpisodeRecord(record);
      if (seenEpisodeIds.has(item.episodeId)) throw new Error(`duplicate episodeId: ${item.episodeId}`);
      seenEpisodeIds.add(item.episodeId);
      if (item.split !== 'unassigned') {
        const previous = splitByGroup.get(item.splitGroup);
        if (previous && previous !== item.split) throw new Error(`split leakage for splitGroup ${item.splitGroup}: ${previous} vs ${item.split}`);
        splitByGroup.set(item.splitGroup, item.split);
      }
      normalized.push(item);
    } catch (error) {
      errors.push({ index, error: String(error?.message || error) });
    }
  });

  const splitCounts = { unassigned: 0, train: 0, validation: 0, test: 0 };
  const sourceCounts = {};
  let trainingEligible = 0;
  for (const item of normalized) {
    splitCounts[item.split] = (splitCounts[item.split] || 0) + 1;
    sourceCounts[item.source.kind] = (sourceCounts[item.source.kind] || 0) + 1;
    if (item.trainingEligibility.eligible) trainingEligible += 1;
  }

  return {
    ok: errors.length === 0,
    records: normalized,
    errors,
    summary: {
      total: records.length,
      valid: normalized.length,
      invalid: errors.length,
      trainingEligible,
      splitCounts,
      sourceCounts
    }
  };
}

function exportTrainRecords(datasetResult) {
  if (!datasetResult || datasetResult.ok !== true || !Array.isArray(datasetResult.records)) {
    throw new Error('validated dataset result required');
  }
  return datasetResult.records.filter(record => record.split === 'train' && record.trainingEligibility?.eligible === true);
}

module.exports = {
  DATASET_CONTRACT_VERSION,
  sanitizeUrl,
  scanForbiddenKeys,
  normalizeObservation,
  normalizeSemanticAction,
  buildEpisodeRecord,
  validateDataset,
  exportTrainRecords
};
