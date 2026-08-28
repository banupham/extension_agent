'use strict';

const { validateOutcome } = require('../strategy/contracts.js');

const OUTCOME_CONTROL_VERSION = '0.2.0';
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

function actionEffectFor(outcome) {
  const status = String(outcome?.metadata?.actionEffectStatus || '').trim();
  const codes = Array.isArray(outcome?.metadata?.actionEffectCodes)
    ? outcome.metadata.actionEffectCodes.map(value => String(value))
    : [];
  const expected = outcome?.metadata?.actionEffectExpected === true;
  return { status: status || null, codes, expected };
}

function reduceOutcomeToControl(input = {}) {
  const outcome = validateOutcome(input.outcome || {});
  const blocker = normalizeBlocker(input.blocker);
  const progress = clamp01(outcome.progress);
  const progressDelta = progressDeltaFor(outcome);
  const effect = actionEffectFor(outcome);

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
  } else if (effect.expected && effect.status === 'no_effect' && progressDelta <= 0) {
    status = 'failed';
    terminal = false;
    shouldReplan = true;
    reasonCode = 'action_no_observable_effect';
  } else {
    status = 'continue';
    terminal = false;
    shouldReplan = true;
    reasonCode = progressDelta > 0 ? 'goal_progressed' : (effect.status === 'effect_observed' ? 'action_effect_observed' : 'goal_not_yet_satisfied');
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
    effectStatus: effect.status,
    effectCodes: effect.codes,
    effectExpected: effect.expected,
    errorCode: outcome.errorCode,
    blockerReasonCode: blocker?.reasonCode || null
  };
}

module.exports = {
  OUTCOME_CONTROL_VERSION,
  CONTROL_STATUSES,
  normalizeBlocker,
  progressDeltaFor,
  actionEffectFor,
  reduceOutcomeToControl
};
