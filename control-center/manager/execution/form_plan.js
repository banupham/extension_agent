'use strict';

const { clickPlan, hoverPlan, keyDescription } = require('./cdp_plan.js');

const FORM_PLAN_VERSION = '0.1.2';

function finite(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function desiredChecked(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const raw = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'checked'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off', 'unchecked'].includes(raw)) return false;
  throw new Error('set_checked_requires_boolean_value');
}

function keyStroke(key, holdMs = 55, delayMs = 0) {
  const desc = keyDescription(key);
  return [
    { delayMs, method: 'Input.dispatchKeyEvent', params: { type: 'rawKeyDown', ...desc, modifiers: 0, isSystemKey: false } },
    { delayMs: holdMs, method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', ...desc, modifiers: 0, isSystemKey: false } }
  ];
}

function noMutationTargetPlan(mappedAction, behavior, target, context) {
  const steps = hoverPlan(mappedAction, behavior, target, context);
  if (!steps.length) throw new Error('form_control_noop_plan_empty');
  return steps;
}

function buildSetCheckedPlan({ mappedAction, behavior, target, context = {} }) {
  if (!target?.rect) throw new Error('set_checked_requires_target_rect');
  if (target.tag !== 'input' || !['checkbox', 'radio'].includes(String(target.inputType || '').toLowerCase())) {
    throw new Error('set_checked_requires_checkable_input');
  }
  if (typeof target.checked !== 'boolean') throw new Error('set_checked_requires_observed_state');
  const desired = desiredChecked(mappedAction.args?.value);
  const steps = target.checked === desired
    ? noMutationTargetPlan(mappedAction, behavior, target, context)
    : clickPlan(mappedAction, behavior, target, context);
  return {
    cdpPlanVersion: FORM_PLAN_VERSION,
    actionType: 'setChecked',
    targetRef: mappedAction.targetRef || null,
    behaviorProfile: behavior?.profile || null,
    steps
  };
}

function resolveOption(target, requested) {
  if (target?.tag !== 'select' || !Array.isArray(target.options)) throw new Error('select_option_requires_observed_options');
  const wanted = String(requested ?? '');
  const exactValue = target.options.filter(option => String(option?.value ?? '') === wanted);
  const candidates = exactValue.length ? exactValue : target.options.filter(option => String(option?.label ?? '') === wanted);
  if (candidates.length !== 1) throw new Error(candidates.length ? 'select_option_ambiguous' : 'select_option_value_not_found');
  const option = candidates[0];
  if (option.disabled) throw new Error('select_option_disabled');
  if (!Number.isInteger(Number(option.index)) || Number(option.index) < 0) throw new Error('select_option_index_invalid');
  return { ...option, index: Number(option.index) };
}

function buildSelectOptionPlan({ mappedAction, behavior, target, context = {} }) {
  if (!target?.rect) throw new Error('select_option_requires_target_rect');
  const option = resolveOption(target, mappedAction.args?.value);
  if (String(target.selectedValue ?? '') === String(option.value)) {
    return {
      cdpPlanVersion: FORM_PLAN_VERSION,
      actionType: 'selectOption',
      targetRef: mappedAction.targetRef || null,
      behaviorProfile: behavior?.profile || null,
      steps: noMutationTargetPlan(mappedAction, behavior, target, context)
    };
  }

  const hold = Math.max(20, Math.min(250, finite(behavior?.keyboard?.constraints?.holdMedianMs, 55)));
  const steps = clickPlan(mappedAction, behavior, target, context);
  steps.push(...keyStroke('Home', hold, 35));
  for (let i = 0; i < option.index; i += 1) steps.push(...keyStroke('ArrowDown', hold, 25));
  steps.push(...keyStroke('Enter', hold, 35));

  return {
    cdpPlanVersion: FORM_PLAN_VERSION,
    actionType: 'selectOption',
    targetRef: mappedAction.targetRef || null,
    behaviorProfile: behavior?.profile || null,
    steps
  };
}

function buildFormCdpPlan(options) {
  const type = options?.mappedAction?.type;
  if (type === 'setChecked') return buildSetCheckedPlan(options);
  if (type === 'selectOption') return buildSelectOptionPlan(options);
  throw new Error(`form_plan_unsupported:${type || '<empty>'}`);
}

module.exports = {
  FORM_PLAN_VERSION,
  desiredChecked,
  keyStroke,
  resolveOption,
  buildSetCheckedPlan,
  buildSelectOptionPlan,
  buildFormCdpPlan
};
