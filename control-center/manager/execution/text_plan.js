'use strict';

const { clickPlan, textInsertPlan } = require('./cdp_plan.js');

const TEXT_PLAN_VERSION = '0.1.0';
const TEXT_EDITABLE_ROLES = new Set(['textbox', 'searchbox', 'combobox']);

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function textEditableTarget(target) {
  if (!target || typeof target !== 'object') return false;
  if (target.editable === true) return true;
  if (TEXT_EDITABLE_ROLES.has(normalized(target.role))) return true;
  return ['input', 'textarea'].includes(normalized(target.tag));
}

function buildTypeTextCdpPlan({ mappedAction, behavior, target, context = {} }) {
  if (!target?.rect) throw new Error('type_text_requires_target_rect');
  if (!textEditableTarget(target)) throw new Error('type_text_requires_editable_target');
  if (typeof mappedAction?.args?.text !== 'string') throw new Error('type_text_requires_transient_text_payload');
  const steps = [
    ...clickPlan(mappedAction, behavior, target, context),
    ...textInsertPlan(mappedAction.args.text, behavior)
  ];
  return {
    cdpPlanVersion: TEXT_PLAN_VERSION,
    actionType: 'typeText',
    targetRef: mappedAction.targetRef || null,
    behaviorProfile: behavior?.profile || null,
    steps
  };
}

module.exports = {
  TEXT_PLAN_VERSION,
  TEXT_EDITABLE_ROLES,
  textEditableTarget,
  buildTypeTextCdpPlan
};
