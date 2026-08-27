'use strict';

const assert = require('assert');
const {
  AGENT_ACTION_CONTRACT_VERSION,
  validateAgentAction,
  behaviorFamilyFor,
  cdpPrimitiveFor,
  mapAgentAction
} = require('../../manager/strategy/agent_action_contract');
const {
  BEHAVIOR_CONTRACT_VERSION,
  validateExecutionBehavior,
  defaultBehaviorFor
} = require('../../manager/strategy/execution_behavior_contract');

function throws(fn, pattern) {
  assert.throws(fn, pattern);
}

assert.strictEqual(AGENT_ACTION_CONTRACT_VERSION, '0.1.0');
assert.strictEqual(BEHAVIOR_CONTRACT_VERSION, '0.1.0');

const click = validateAgentAction({ type: 'click', targetRef: 'e271', intent: 'like_post' });
assert.strictEqual(click.type, 'click');
assert.strictEqual(click.targetRef, 'e271');
assert.strictEqual(behaviorFamilyFor('click'), 'pointer-click');
assert.ok(cdpPrimitiveFor('click').includes('Input.dispatchMouseEvent'));

const drag = mapAgentAction({ type: 'drag', targetRef: 'e10', args: { destinationRef: 'e11' } });
assert.strictEqual(drag.behaviorFamily, 'pointer-drag');
assert.strictEqual(drag.targetRef, 'e10');
assert.strictEqual(drag.args.destinationRef, 'e11');
assert.ok(drag.cdpPrimitives.includes('Input.dispatchMouseEvent'));

const horizontal = mapAgentAction({ type: 'scrollHorizontal', args: { direction: 'right' } });
assert.strictEqual(horizontal.behaviorFamily, 'scroll-horizontal');
assert.ok(horizontal.cdpPrimitives.some(item => item.includes('mouseWheel')));

const hover = mapAgentAction({ type: 'hoverAndObserve', targetRef: 'e88' });
assert.strictEqual(hover.behaviorFamily, 'pointer-hover');
assert.ok(hover.cdpPrimitives.includes('Runtime.evaluate'));

const volume = mapAgentAction({ type: 'setVolume', targetRef: 'e12', args: { value: 0.6 } });
assert.strictEqual(volume.behaviorFamily, 'pointer-drag');

const typing = mapAgentAction({ type: 'typeText', targetRef: 'text-field-1', args: { text: 'task-provided text' } });
const typingBehavior = defaultBehaviorFor(typing);
assert.strictEqual(typing.targetRef, 'text-field-1');
assert.strictEqual(typingBehavior.keyboard.profile, 'empirical');
assert.strictEqual(typingBehavior.keyboard.burstProfile, 'context-conditioned');

const clickBehavior = defaultBehaviorFor(mapAgentAction({ type: 'click', targetRef: 'e1' }));
assert.strictEqual(clickBehavior.pointer.targetAcquisition, 'adaptive');
assert.strictEqual(clickBehavior.profile, 'empirical-v0');

const submit = mapAgentAction({ type: 'submit', targetRef: 'form-1' });
assert.strictEqual(submit.behaviorFamily, 'form-control');
assert.strictEqual(defaultBehaviorFor(submit).pointer.targetAcquisition, 'adaptive');
const select = mapAgentAction({ type: 'selectOption', targetRef: 'select-1', args: { value: 'x' } });
assert.strictEqual(select.behaviorFamily, 'form-control');
assert.strictEqual(defaultBehaviorFor(select).pointer.targetAcquisition, 'adaptive');

const explicit = validateExecutionBehavior({
  actionType: 'click',
  targetRef: 'e1',
  pointer: { dwellBeforeDownMs: 90, holdMs: 65, constraints: { insideTarget: true } }
});
assert.strictEqual(explicit.pointer.dwellBeforeDownMs, 90);
assert.strictEqual(explicit.pointer.holdMs, 65);

throws(() => validateAgentAction({ type: 'click' }), /requires targetRef/);
throws(() => validateAgentAction({ type: 'typeText', args: { text: 'x' } }), /typeText requires targetRef/);
throws(() => validateAgentAction({ type: 'drag', targetRef: 'e1' }), /drag requires args\.destinationRef/);
throws(() => validateAgentAction({ type: 'drag', targetRef: 'e1', args: { destinationRef: 'e1' } }), /source and destination must differ/);
throws(() => validateAgentAction({ type: 'click', targetRef: 'e1', selector: '#bad' }), /must not use selector/);
throws(() => validateAgentAction({ type: 'click', targetRef: 'e1', x: 10, y: 20 }), /must not emit raw coordinates/);
throws(() => validateAgentAction({ type: 'click', targetRef: 'e1', cdpMethod: 'Input.dispatchMouseEvent' }), /must not emit raw CDP/);
throws(() => validateAgentAction({ type: 'solveCaptcha', targetRef: 'e1' }), /unsupported agent action/);

console.log('agent_action_contract: PASS');
