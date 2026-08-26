'use strict';

const { validateOutcome } = require('../strategy/contracts.js');

const OUTCOME_CONTROL_VERSION = '0.1.0';
const CONTROL_STATUSES = new Set(['done', 'continue', 'failed', 'blocked']);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeBlocker(blocker) {
  if (blocker == null || blocker === false) return null;
  if (!isPlainObject(blocker)) throw new Error('outcome_blocker_object_required');
  if (blocker.active !== true) return null;
  const reasonCode = String(blocker.reasonCode || '').trim();
  if (!reasonCode) throw new Error('outcome_blocker_reason_required');
  return { active: true, reasonCode };
}

function progressDeltaFor(outcome) {
  const n = Number(outcome?.metadata?.progressDelta);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

function reduceOutcomeToControl(input = {}) {
  const outcome = validateOutcome(input.outcome || {});
  const blocker = normalizeBlocker(input.blocker);
  const progress = clamp01(outcome.progress);
  const progressDelta = progressDeltaFor(outcome);

  let status;
  let terminal;
  let shouldReplan;
  let reasonCode;

  if (outcome.taskSucceeded) {
    status = 'done';
    terminal = true;
    shouldReplan = false;
    reasonCode = 'goal_satisfied';
  } else if (blocker) {
    status = 'blocked';
    terminal = true;
    shouldReplan = false;
    reasonCode = blocker.reasonCode;
  } else if (!outcome.actionSucceeded || outcome.errorCode) {
    status = 'failed';
    terminal = false;
    shouldReplan = true;
    reasonCode = outcome.errorCode || 'action_execution_failed';
  } else {
    status = 'continue';
    terminal = false;
    shouldReplan = true;
    reasonCode = progressDelta > 0 ? 'goal_progressed' : 'goal_not_yet_satisfied';
  }

  return {
    outcomeControlVersion: OUTCOME_CONTROL_VERSION,
    status,
    terminal,
    shouldReplan,
    reasonCode,
    actionSucceeded: outcome.actionSucceeded,
    taskSucceeded: outcome.taskSucceeded,
    progress,
    progressDelta,
    errorCode: outcome.errorCode,
    blockerReasonCode: blocker?.reasonCode || null
  };
}

module.exports = {
  OUTCOME_CONTROL_VERSION,
  CONTROL_STATUSES,
  normalizeBlocker,
  reduceOutcomeToControl
};
