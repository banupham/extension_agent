'use strict';

const assert = require('assert');
const { mapAgentAction } = require('../../manager/strategy/agent_action_contract.js');
const {
  FORM_PLAN_VERSION,
  desiredChecked,
  resolveOption,
  buildFormCdpPlan
} = require('../../manager/execution/form_plan.js');

const rect = { x: 10, y: 20, width: 20, height: 20 };
const context = { pointerStart: { x: 100, y: 100 }, rng: () => 0.5 };
const behavior = {
  profile: 'test',
  pointer: { dwellBeforeDownMs: 0, holdMs: 20, constraints: { approachDurationMs: 64, straightness: 0.9, endToCenterNormalized: 0.1 } },
  keyboard: { constraints: { holdMedianMs: 40 } }
};

assert.strictEqual(desiredChecked(1), true);
assert.strictEqual(desiredChecked(0), false);
assert.strictEqual(desiredChecked('true'), true);
assert.throws(() => desiredChecked('maybe'), /requires_boolean_value/);

const setChecked = buildFormCdpPlan({
  mappedAction: mapAgentAction({ type: 'setChecked', targetRef: 'e0', args: { value: 1 } }),
  behavior,
  target: { ref: 'e0', tag: 'input', inputType: 'checkbox', checked: false, rect },
  context
});
assert.strictEqual(setChecked.cdpPlanVersion, FORM_PLAN_VERSION);
assert.strictEqual(setChecked.actionType, 'setChecked');
assert.ok(setChecked.steps.some(step => step.params?.type === 'mousePressed'));
assert.ok(setChecked.steps.some(step => step.params?.type === 'mouseReleased'));

const setCheckedNoop = buildFormCdpPlan({
  mappedAction: mapAgentAction({ type: 'setChecked', targetRef: 'e0', args: { value: 0 } }),
  behavior,
  target: { ref: 'e0', tag: 'input', inputType: 'checkbox', checked: false, rect },
  context
});
assert.ok(setCheckedNoop.steps.length > 0);
assert.ok(setCheckedNoop.steps.every(step => step.params?.type === 'mouseMoved'));

const selectTarget = {
  ref: 'e2', tag: 'select', selectedValue: '0', selectedIndex: 0, rect: { x: 30, y: 30, width: 100, height: 24 },
  options: [
    { index: 0, value: '0', label: 'Alpha', disabled: false },
    { index: 1, value: '1', label: 'Beta', disabled: false },
    { index: 2, value: '2', label: 'Gamma', disabled: false }
  ]
};
assert.strictEqual(resolveOption(selectTarget, 2).label, 'Gamma');

const selectPlan = buildFormCdpPlan({
  mappedAction: mapAgentAction({ type: 'selectOption', targetRef: 'e2', args: { value: 2 } }),
  behavior,
  target: selectTarget,
  context
});
assert.strictEqual(selectPlan.cdpPlanVersion, FORM_PLAN_VERSION);
assert.strictEqual(selectPlan.actionType, 'selectOption');
assert.ok(selectPlan.steps.some(step => step.params?.type === 'mousePressed'));
const keys = selectPlan.steps.filter(step => step.method === 'Input.dispatchKeyEvent' && step.params?.type === 'rawKeyDown').map(step => step.params.key);
assert.deepStrictEqual(keys, ['Home', 'ArrowDown', 'ArrowDown', 'Enter']);
assert.ok(selectPlan.steps.every(step => ['Input.dispatchMouseEvent', 'Input.dispatchKeyEvent'].includes(step.method)));

const alreadySelected = buildFormCdpPlan({
  mappedAction: mapAgentAction({ type: 'selectOption', targetRef: 'e2', args: { value: 2 } }),
  behavior,
  target: { ...selectTarget, selectedValue: '2', selectedIndex: 2 },
  context
});
assert.ok(alreadySelected.steps.every(step => step.params?.type === 'mouseMoved'));

assert.throws(() => buildFormCdpPlan({
  mappedAction: mapAgentAction({ type: 'selectOption', targetRef: 'e2', args: { value: 9 } }),
  behavior,
  target: selectTarget,
  context
}), /value_not_found/);

console.log('form_control_plan: PASS');
