'use strict';

const assert = require('assert');
const {
  targetCenterInViewport,
  targetNeedsAcquisition,
  runOneAction
} = require('../../manager/agent/one_action_bridge.js');

function observation({ id, y, title = 'READY' }) {
  return {
    observationId: id,
    url: 'http://127.0.0.1:8091/',
    title,
    viewport: { width: 800, height: 600 },
    scroll: { x: 0, y: y > 600 ? 0 : 700 },
    interactiveElements: [
      {
        ref: 'e1',
        tag: 'button',
        role: null,
        label: 'Discovery Alpha',
        editable: false,
        enabled: true,
        visible: true,
        rect: { x: 120, y, width: 140, height: 36 }
      }
    ],
    privacy: { redacted: true }
  };
}

(async () => {
  const offscreen = observation({ id: 'obs-before', y: 900 });
  assert.equal(targetCenterInViewport(offscreen.interactiveElements[0], offscreen), false);
  assert.equal(targetNeedsAcquisition({ type: 'click' }, offscreen.interactiveElements[0], offscreen), true);

  let acquired = false;
  let clicked = false;
  const executeCalls = [];
  const runtime = {
    async observe() {
      if (!acquired) return observation({ id: 'obs-before', y: 900 });
      if (!clicked) return observation({ id: 'obs-acquired', y: 250 });
      return observation({ id: 'obs-after', y: 250, title: 'CLICK PASS' });
    },
    async executePlan(payload) {
      executeCalls.push(payload);
      if (!acquired) {
        assert.equal(payload.observationId, 'obs-before');
        assert.equal(payload.plan.actionType, 'scrollIntoView');
        acquired = true;
        return { ok: true, actionType: 'scrollIntoView' };
      }
      assert.equal(payload.observationId, 'obs-acquired');
      assert.equal(payload.plan.actionType, 'click');
      clicked = true;
      return { ok: true, actionType: 'click' };
    }
  };

  const result = await runOneAction({
    runtime,
    rng: () => 0.5,
    settleSleep: async () => {},
    postActionSettle: { pollMs: 1, minWindowMs: 1, maxWindowMs: 3, stableSamples: 2 },
    agentAction: {
      contractVersion: '0.1.0',
      type: 'click',
      targetRef: 'e1',
      args: {},
      intent: 'test offscreen acquisition',
      expectedOutcome: {}
    }
  });

  assert.equal(result.execution.ok, true);
  assert.equal(result.before.observationId, 'obs-before');
  assert.equal(result.after.observationId, 'obs-after');
  assert.equal(result.after.title, 'CLICK PASS');
  assert.equal(result.targetAcquisition.used, true);
  assert.equal(result.targetAcquisition.observationIdBefore, 'obs-before');
  assert.equal(result.targetAcquisition.observationIdAfter, 'obs-acquired');
  assert.equal(result.targetAcquisition.originalTargetRef, 'e1');
  assert.equal(result.targetAcquisition.resolvedTargetRef, 'e1');
  assert.equal(result.invariant.oneActionOnly, true);
  assert.equal(result.invariant.targetAcquisitionUsed, true);
  assert.equal(result.invariant.targetAcquisitionPlanCount, 1);
  assert.equal(result.invariant.targetAcquisitionStayedWithinOneSemanticAction, true);
  assert.equal(result.invariant.selectorUsedByStrategy, false);
  assert.equal(executeCalls.length, 2);

  console.log('One-action target acquisition contract: PASS');
})().catch(error => {
  console.error(`One-action target acquisition contract: FAIL\n${error.stack || error}`);
  process.exitCode = 1;
});
