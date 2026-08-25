'use strict';

const STRATEGY_CONTRACT_VERSION = '0.1.0';

const TERMINAL_STATUSES = new Set(['done', 'blocked', 'failed']);
const DECISION_STATUSES = new Set(['act', ...TERMINAL_STATUSES]);

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function validateTask(task) {
  if (!isPlainObject(task)) throw new Error('task must be an object');
  return {
    taskId: requireString(task.taskId || `task-${Date.now()}`, 'task.taskId'),
    type: requireString(task.type || 'generic', 'task.type'),
    instruction: requireString(task.instruction, 'task.instruction'),
    args: isPlainObject(task.args) ? task.args : {},
    successCriteria: Array.isArray(task.successCriteria) ? task.successCriteria : [],
    constraints: isPlainObject(task.constraints) ? task.constraints : {},
    metadata: isPlainObject(task.metadata) ? task.metadata : {}
  };
}

function validateObservation(observation) {
  if (!isPlainObject(observation)) throw new Error('observation must be an object');
  return {
    observationId: typeof observation.observationId === 'string' ? observation.observationId : null,
    capturedAt: observation.capturedAt || new Date().toISOString(),
    url: typeof observation.url === 'string' ? observation.url : '',
    title: typeof observation.title === 'string' ? observation.title : '',
    viewport: isPlainObject(observation.viewport) ? observation.viewport : {},
    scroll: isPlainObject(observation.scroll) ? observation.scroll : {},
    focusedElement: isPlainObject(observation.focusedElement) ? observation.focusedElement : null,
    interactiveElements: Array.isArray(observation.interactiveElements) ? observation.interactiveElements : [],
    pageSignals: isPlainObject(observation.pageSignals) ? observation.pageSignals : {},
    privacy: isPlainObject(observation.privacy) ? observation.privacy : { redacted: true }
  };
}

function validateDecision(decision) {
  if (!isPlainObject(decision)) throw new Error('decision must be an object');
  const status = requireString(decision.status, 'decision.status');
  if (!DECISION_STATUSES.has(status)) throw new Error(`unsupported decision.status: ${status}`);
  if (status === 'act' && !isPlainObject(decision.action)) throw new Error('decision.action is required when status=act');
  return {
    contractVersion: STRATEGY_CONTRACT_VERSION,
    status,
    action: status === 'act' ? decision.action : null,
    targetRef: typeof decision.targetRef === 'string' ? decision.targetRef : null,
    confidence: clamp01(decision.confidence, 0),
    reasonCode: typeof decision.reasonCode === 'string' ? decision.reasonCode : 'unspecified',
    expectedOutcome: isPlainObject(decision.expectedOutcome) ? decision.expectedOutcome : {},
    recovery: isPlainObject(decision.recovery) ? decision.recovery : {},
    metadata: isPlainObject(decision.metadata) ? decision.metadata : {}
  };
}

function validateOutcome(outcome) {
  if (!isPlainObject(outcome)) throw new Error('outcome must be an object');
  return {
    actionSucceeded: !!outcome.actionSucceeded,
    taskSucceeded: !!outcome.taskSucceeded,
    progress: clamp01(outcome.progress, 0),
    evidence: Array.isArray(outcome.evidence) ? outcome.evidence : [],
    errorCode: outcome.errorCode == null ? null : String(outcome.errorCode),
    metadata: isPlainObject(outcome.metadata) ? outcome.metadata : {}
  };
}

function makeEpisode({ episodeId, task, environment = {}, steps = [], finalOutcome = null, recorderMeta = {} }) {
  return {
    contractVersion: STRATEGY_CONTRACT_VERSION,
    episodeId: requireString(episodeId, 'episodeId'),
    task: validateTask(task),
    environment: isPlainObject(environment) ? environment : {},
    steps: Array.isArray(steps) ? steps : [],
    finalOutcome: finalOutcome ? validateOutcome(finalOutcome) : null,
    recorderMeta: isPlainObject(recorderMeta) ? recorderMeta : {}
  };
}

module.exports = {
  STRATEGY_CONTRACT_VERSION,
  DECISION_STATUSES,
  TERMINAL_STATUSES,
  validateTask,
  validateObservation,
  validateDecision,
  validateOutcome,
  makeEpisode
};
