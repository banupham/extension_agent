'use strict';

const assert = require('assert');
const { mapAgentAction } = require('../../control-center/manager/strategy/agent_action_contract.js');
const { sampledBehavior } = require('../../control-center/manager/behavior/empirical_policy.js');
const {
  SUBMIT_PLAN_VERSION,
  buildSubmitCdpPlan
} = require('../../control-center/manager/execution/submit_plan.js');

function behaviorFor(action, target) {
  return sampledBehavior({ mappedAction: action, target, rng: () => 0.5 });
}

function main() {
  assert.equal(SUBMIT_PLAN_VERSION, '0.2.0');

  const editable = {
    ref: 'editable-submit-target',
    tag: 'input',
    role: 'textbox',
    label: 'Cargo Instruction',
    editable: true,
    rect: { x: 80, y: 120, width: 320, height: 44 }
  };
  const editableAction = mapAgentAction({ type: 'submit', targetRef: editable.ref, args: {} });
  const editablePlan = buildSubmitCdpPlan({
    mappedAction: editableAction,
    behavior: behaviorFor(editableAction, editable),
    target: editable,
    context: { pointerStart: { x: 0, y: 0 }, rng: () => 0.5 }
  });

  const enterEvents = editablePlan.steps.filter(step =>
    step.method === 'Input.dispatchKeyEvent' && step.params?.key === 'Enter'
  );
  assert.deepStrictEqual(enterEvents.map(step => step.params.type), ['keyDown', 'keyUp']);
  assert.equal(enterEvents[0].params.code, 'Enter');
  assert.equal(enterEvents[0].params.windowsVirtualKeyCode, 13);
  assert.equal(enterEvents.some(step => step.params.type === 'rawKeyDown'), false);
  assert.ok(editablePlan.steps.some(step =>
    step.method === 'Input.dispatchMouseEvent' && step.params?.type === 'mousePressed'
  ));

  const button = {
    ref: 'button-submit-target',
    tag: 'button',
    role: 'button',
    label: 'Route Cargo',
    editable: false,
    rect: { x: 80, y: 200, width: 160, height: 44 }
  };
  const buttonAction = mapAgentAction({ type: 'submit', targetRef: button.ref, args: {} });
  const buttonPlan = buildSubmitCdpPlan({
    mappedAction: buttonAction,
    behavior: behaviorFor(buttonAction, button),
    target: button,
    context: { pointerStart: { x: 0, y: 0 }, rng: () => 0.5 }
  });
  assert.equal(buttonPlan.steps.some(step => step.method === 'Input.dispatchKeyEvent'), false);
  assert.ok(buttonPlan.steps.some(step =>
    step.method === 'Input.dispatchMouseEvent' && step.params?.type === 'mousePressed'
  ));

  console.log('Submit native key semantics contract: PASS');
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error('Submit native key semantics contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { main };
