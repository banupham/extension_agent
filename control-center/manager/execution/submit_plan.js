'use strict';

const { clickPlan } = require('./cdp_plan.js');
const { keyStroke } = require('./form_plan.js');

const SUBMIT_PLAN_VERSION = '0.1.0';
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

function buildSubmitCdpPlan({ mappedAction, behavior, target, context = {} }) {
  if (!target?.rect) throw new Error('submit_requires_target_rect');
  const steps = clickPlan(mappedAction, behavior, target, context);
  if (!buttonLikeTarget(target)) {
    const hold = Math.max(20, Math.min(250, Number(behavior?.keyboard?.constraints?.holdMedianMs) || 55));
    steps.push(...keyStroke('Enter', hold, 35));
  }
  return {
    cdpPlanVersion: SUBMIT_PLAN_VERSION,
    actionType: 'submit',
    targetRef: mappedAction.targetRef || null,
    behaviorProfile: behavior?.profile || null,
    steps
  };
}

module.exports = {
  SUBMIT_PLAN_VERSION,
  BUTTON_ROLES,
  BUTTON_INPUT_TYPES,
  buttonLikeTarget,
  buildSubmitCdpPlan
};
