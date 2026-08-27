'use strict';

const { clickPlan, keyDescription } = require('./cdp_plan.js');

const SUBMIT_PLAN_VERSION = '0.2.2';
const CDP_PLAN_VERSION = '0.1.2';
const ENTER_TEXT = '\r';
const BUTTON_ROLES = new Set(['button']);
const BUTTON_INPUT_TYPES = new Set(['submit', 'button', 'image']);

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function buttonLikeTarget(target) {
  const tag = normalized(target?.tag);
  const role = normalized(target?.role);
  const inputType = normalized(target?.inputType);
  return tag === 'button' || BUTTON_ROLES.has(role) || (tag === 'input' && BUTTON_INPUT_TYPES.has(inputType));
}

function semanticSubmitKeyStroke(behavior, delayMs = 35) {
  const hold = Math.max(20, Math.min(250, Number(behavior?.keyboard?.constraints?.holdMedianMs) || 55));
  const desc = keyDescription('Enter');
  return [
    {
      delayMs,
      method: 'Input.dispatchKeyEvent',
      params: {
        type: 'keyDown',
        ...desc,
        text: ENTER_TEXT,
        unmodifiedText: ENTER_TEXT,
        modifiers: 0,
        isSystemKey: false
      }
    },
    {
      delayMs: hold,
      method: 'Input.dispatchKeyEvent',
      params: { type: 'keyUp', ...desc, modifiers: 0, isSystemKey: false }
    }
  ];
}

function buildSubmitCdpPlan({ mappedAction, behavior, target, context = {} }) {
  if (!target?.rect) throw new Error('submit_requires_target_rect');
  const steps = clickPlan(mappedAction, behavior, target, context);
  if (!buttonLikeTarget(target)) {
    steps.push(...semanticSubmitKeyStroke(behavior, 35));
  }
  return {
    cdpPlanVersion: CDP_PLAN_VERSION,
    actionType: 'submit',
    targetRef: mappedAction.targetRef || null,
    behaviorProfile: behavior?.profile || null,
    steps
  };
}

module.exports = {
  SUBMIT_PLAN_VERSION,
  CDP_PLAN_VERSION,
  ENTER_TEXT,
  BUTTON_ROLES,
  BUTTON_INPUT_TYPES,
  buttonLikeTarget,
  semanticSubmitKeyStroke,
  buildSubmitCdpPlan
};
