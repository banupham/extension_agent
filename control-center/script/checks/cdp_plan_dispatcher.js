'use strict';

const assert = require('assert');
const Dispatcher = require('../../extension/agent-runtime-extension/cdp_plan_dispatcher.js');

assert.strictEqual(Dispatcher.LATEST_PLAN_VERSION, '0.1.2');
assert(Dispatcher.SUPPORTED_PLAN_VERSIONS.has('0.1.0'));
assert(Dispatcher.SUPPORTED_PLAN_VERSIONS.has('0.1.1'));
assert(Dispatcher.SUPPORTED_PLAN_VERSIONS.has('0.1.2'));

const valid = Dispatcher.validatePlan({
  cdpPlanVersion: '0.1.2',
  actionType: 'click',
  targetRef: 'e17',
  steps: [
    { delayMs: 10, method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 10, y: 20 } },
    { delayMs: 20, method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: 10, y: 20, button: 'left' } },
    { delayMs: 80, method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x: 10, y: 20, button: 'left' } }
  ]
});
assert.strictEqual(valid.cdpPlanVersion, '0.1.2');
assert.strictEqual(valid.steps.length, 3);

const legacy = Dispatcher.validatePlan({
  cdpPlanVersion: '0.1.0',
  actionType: 'click',
  targetRef: 'e17',
  steps: [{ delayMs: 0, method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 10, y: 20 } }]
});
assert.strictEqual(legacy.cdpPlanVersion, '0.1.0');

const compatible011 = Dispatcher.validatePlan({
  cdpPlanVersion: '0.1.1',
  actionType: 'click',
  targetRef: 'e17',
  steps: [{ delayMs: 0, method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 10, y: 20 } }]
});
assert.strictEqual(compatible011.cdpPlanVersion, '0.1.1');

const backPlan = Dispatcher.validatePlan({
  cdpPlanVersion: '0.1.2',
  actionType: 'back',
  steps: [
    { delayMs: 0, method: 'Page.getNavigationHistory', params: {} },
    { delayMs: 0, postDelayMs: 120, method: 'Page.navigateToHistoryEntry', params: {}, historyOffset: -1 }
  ]
});
assert.strictEqual(backPlan.steps[1].historyOffset, -1);

const forwardPlan = Dispatcher.validatePlan({
  cdpPlanVersion: '0.1.2',
  actionType: 'forward',
  steps: [
    { delayMs: 0, method: 'Page.getNavigationHistory', params: {} },
    { delayMs: 0, postDelayMs: 120, method: 'Page.navigateToHistoryEntry', params: {}, historyOffset: 1 }
  ]
});
assert.strictEqual(forwardPlan.steps[1].historyOffset, 1);

assert.throws(() => Dispatcher.validatePlan({
  cdpPlanVersion: '9.9.9',
  actionType: 'click',
  steps: [{ method: 'Input.dispatchMouseEvent', params: {} }]
}), /unsupported_cdp_plan_version/);
assert.throws(() => Dispatcher.validatePlan({
  cdpPlanVersion: '0.1.2',
  actionType: 'click',
  steps: [{ method: 'Runtime.evaluate', params: { expression: 'document.cookie' } }]
}), /cdp_method_not_allowed/);
assert.throws(() => Dispatcher.validatePlan({
  cdpPlanVersion: '0.1.2',
  actionType: 'click',
  steps: [{ delayMs: 999999, method: 'Input.dispatchMouseEvent', params: {} }]
}), /invalid_plan_delay/);
assert.throws(() => Dispatcher.validatePlan({
  cdpPlanVersion: '0.1.1',
  actionType: 'back',
  steps: [
    { method: 'Page.getNavigationHistory', params: {} },
    { method: 'Page.navigateToHistoryEntry', params: {}, historyOffset: -1 }
  ]
}), /history_binding_requires_plan_0\.1\.2/);
assert.throws(() => Dispatcher.validatePlan({
  cdpPlanVersion: '0.1.2',
  actionType: 'back',
  steps: [{ method: 'Page.navigateToHistoryEntry', params: {}, historyOffset: -1 }]
}), /history_binding_source_invalid/);
assert.throws(() => Dispatcher.validatePlan({
  cdpPlanVersion: '0.1.2',
  actionType: 'back',
  steps: [
    { method: 'Page.getNavigationHistory', params: {} },
    { method: 'Page.navigateToHistoryEntry', params: { entryId: 7 }, historyOffset: -1 }
  ]
}), /history_binding_entry_id_conflict/);

(async () => {
  const calls = [];
  const sleeps = [];
  const result = await Dispatcher.dispatchPlan(valid, async (method, params) => {
    calls.push({ method, params });
    return { ok: true };
  }, async ms => { sleeps.push(ms); });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.cdpPlanVersion, '0.1.2');
  assert.strictEqual(result.stepCount, 3);
  assert.strictEqual(calls.length, 3);
  assert.deepStrictEqual(sleeps, [10, 20, 80]);

  const backCalls = [];
  const backSleeps = [];
  const backResult = await Dispatcher.dispatchPlan(backPlan, async (method, params) => {
    backCalls.push({ method, params });
    if (method === 'Page.getNavigationHistory') {
      return { currentIndex: 1, entries: [{ id: 10 }, { id: 11 }, { id: 12 }] };
    }
    return { ok: true };
  }, async ms => { backSleeps.push(ms); });
  assert.strictEqual(backResult.ok, true);
  assert.deepStrictEqual(backCalls.map(call => call.method), ['Page.getNavigationHistory', 'Page.navigateToHistoryEntry']);
  assert.deepStrictEqual(backCalls[1].params, { entryId: 10 });
  assert.deepStrictEqual(backSleeps, [120]);

  const forwardCalls = [];
  await Dispatcher.dispatchPlan(forwardPlan, async (method, params) => {
    forwardCalls.push({ method, params });
    if (method === 'Page.getNavigationHistory') {
      return { currentIndex: 1, entries: [{ id: 20 }, { id: 21 }, { id: 22 }] };
    }
    return { ok: true };
  }, async () => {});
  assert.deepStrictEqual(forwardCalls[1].params, { entryId: 22 });

  await assert.rejects(
    () => Dispatcher.dispatchPlan(backPlan, async method => {
      if (method === 'Page.getNavigationHistory') return { currentIndex: 0, entries: [{ id: 30 }] };
      return { ok: true };
    }, async () => {}),
    /history_back_unavailable/
  );

  console.log('CDP plan dispatcher contract: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
