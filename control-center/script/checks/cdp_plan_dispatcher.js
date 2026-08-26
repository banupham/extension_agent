'use strict';

const assert = require('assert');
const Dispatcher = require('../../extension/agent-runtime-extension/cdp_plan_dispatcher.js');

assert.strictEqual(Dispatcher.LATEST_PLAN_VERSION, '0.1.1');
assert(Dispatcher.SUPPORTED_PLAN_VERSIONS.has('0.1.0'));
assert(Dispatcher.SUPPORTED_PLAN_VERSIONS.has('0.1.1'));

const valid = Dispatcher.validatePlan({
  cdpPlanVersion: '0.1.1',
  actionType: 'click',
  targetRef: 'e17',
  steps: [
    { delayMs: 10, method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 10, y: 20 } },
    { delayMs: 20, method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: 10, y: 20, button: 'left' } },
    { delayMs: 80, method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x: 10, y: 20, button: 'left' } }
  ]
});
assert.strictEqual(valid.cdpPlanVersion, '0.1.1');
assert.strictEqual(valid.steps.length, 3);

const legacy = Dispatcher.validatePlan({
  cdpPlanVersion: '0.1.0',
  actionType: 'click',
  targetRef: 'e17',
  steps: [{ delayMs: 0, method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 10, y: 20 } }]
});
assert.strictEqual(legacy.cdpPlanVersion, '0.1.0');

assert.throws(() => Dispatcher.validatePlan({
  cdpPlanVersion: '9.9.9',
  actionType: 'click',
  steps: [{ method: 'Input.dispatchMouseEvent', params: {} }]
}), /unsupported_cdp_plan_version/);
assert.throws(() => Dispatcher.validatePlan({
  cdpPlanVersion: '0.1.1',
  actionType: 'click',
  steps: [{ method: 'Runtime.evaluate', params: { expression: 'document.cookie' } }]
}), /cdp_method_not_allowed/);
assert.throws(() => Dispatcher.validatePlan({
  cdpPlanVersion: '0.1.1',
  actionType: 'click',
  steps: [{ delayMs: 999999, method: 'Input.dispatchMouseEvent', params: {} }]
}), /invalid_plan_delay/);

const calls = [];
const sleeps = [];
(async () => {
  const result = await Dispatcher.dispatchPlan(valid, async (method, params) => {
    calls.push({ method, params });
    return { ok: true };
  }, async ms => { sleeps.push(ms); });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.cdpPlanVersion, '0.1.1');
  assert.strictEqual(result.stepCount, 3);
  assert.strictEqual(calls.length, 3);
  assert.deepStrictEqual(sleeps, [10, 20, 80]);
  console.log('CDP plan dispatcher contract: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});