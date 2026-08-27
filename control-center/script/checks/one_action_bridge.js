'use strict';

const assert = require('assert');
const { runOneAction } = require('../../manager/agent/one_action_bridge.js');

const baseline = {
  behaviorBaselineVersion: '0.1.0',
  families: {
    'pointer-click': {
      global: {
        sampleCount: 20,
        approachDurationMs: { count: 20, p10: 120, p25: 150, p50: 180, p75: 220, p90: 280 },
        straightness: { count: 20, p10: 0.75, p25: 0.82, p50: 0.9, p75: 0.94, p90: 0.97 },
        meanSpeedPxS: { count: 20, p10: 300, p25: 400, p50: 520, p75: 650, p90: 800 },
        meanAbsTurnDeg: { count: 20, p10: 4, p25: 7, p50: 11, p75: 16, p90: 24 },
        correctionCount45Deg: { count: 20, p10: 0, p25: 0, p50: 1, p75: 1, p90: 2 },
        acquisitionPauseMs: { count: 20, p10: 10, p25: 20, p50: 35, p75: 55, p90: 80 },
        holdMs: { count: 20, p10: 70, p25: 80, p50: 95, p75: 120, p90: 160 },
        endToCenterNormalized: { count: 20, p10: 0.04, p25: 0.08, p50: 0.12, p75: 0.17, p90: 0.22 }
      },
      contexts: {}
    }
  }
};

let observeCount = 0;
let executed = null;
let postExecuteObserveCount = 0;
const runtime = {
  async observe() {
    observeCount += 1;
    if (!executed) {
      return {
        observationId: `obs-${observeCount}`,
        url: 'https://example.test/a',
        title: 'Before',
        viewport: { width: 1000, height: 700 },
        scroll: { x: 0, y: 0 },
        interactiveElements: [
          { ref: 'e17', tag: 'button', role: 'button', label: 'Like', rect: { x: 700, y: 300, width: 80, height: 32 } }
        ]
      };
    }

    postExecuteObserveCount += 1;
    const dynamicReady = postExecuteObserveCount >= 4;
    return {
      observationId: `obs-${observeCount}`,
      url: 'https://example.test/a',
      title: dynamicReady ? 'DYNAMIC READY' : 'CLICK ACK',
      viewport: { width: 1000, height: 700 },
      scroll: { x: 0, y: 0 },
      focusedRef: 'e17',
      interactiveElements: [
        { ref: 'e17', tag: 'button', role: 'button', label: 'Like', rect: { x: 700, y: 300, width: 80, height: 32 } },
        ...(dynamicReady ? [{ ref: 'e18', tag: 'button', role: 'button', label: 'Dynamic Child', rect: { x: 700, y: 350, width: 120, height: 32 } }] : [])
      ]
    };
  },
  async executePlan(payload) {
    executed = payload;
    return { ok: true, stepCount: payload.plan.steps.length };
  }
};

(async () => {
  let brainSawObservationId = null;
  const result = await runOneAction({
    runtime,
    baseline,
    decide: async observation => {
      brainSawObservationId = observation.observationId;
      const target = observation.interactiveElements.find(x => x.label === 'Like');
      return { status: 'act', reason: 'semantic target found', action: { type: 'click', targetRef: target.ref } };
    },
    rng: () => 0.5,
    settleSleep: async () => {}
  });
  assert.strictEqual(result.bridgeVersion, '0.3.0');
  assert.strictEqual(brainSawObservationId, 'obs-1');
  assert.strictEqual(result.beforeObservationId, 'obs-1');
  assert.strictEqual(result.afterObservationId, 'obs-7');
  assert.strictEqual(result.decision.status, 'act');
  assert.strictEqual(result.mappedAction.type, 'click');
  assert.strictEqual(result.behavior.metadata.behaviorFamily, 'pointer-click');
  assert.strictEqual(result.cdpPlan.actionType, 'click');
  assert.ok(result.cdpPlan.steps.length > 2);
  assert.strictEqual(executed.observationId, 'obs-1');
  assert.strictEqual(result.after.title, 'DYNAMIC READY');
  assert.ok(result.after.interactiveElements.some(x => x.label === 'Dynamic Child'));
  assert.strictEqual(result.postActionObservation.mode, 'settled');
  assert.strictEqual(result.postActionObservation.waitedMs, 400);
  assert.strictEqual(result.postActionObservation.samples, 6);
  assert.strictEqual(result.postActionObservation.semanticChanged, true);
  assert.strictEqual(result.postActionObservation.deadlineReached, false);
  assert.strictEqual(result.invariant.oneActionOnly, true);
  assert.strictEqual(result.invariant.actionExecuted, true);
  assert.strictEqual(result.invariant.reObservedAfterExecution, true);
  assert.strictEqual(result.invariant.selectorUsedByStrategy, false);
  assert.strictEqual(result.invariant.transientPayloadRedacted, true);
  assert.strictEqual(observeCount, 7);

  executed = null;
  const beforeTerminalCount = observeCount;
  const terminal = await runOneAction({
    runtime,
    baseline,
    decide: async () => ({ status: 'blocked', reasonCode: 'human_verification_required' })
  });
  assert.strictEqual(terminal.decision.status, 'blocked');
  assert.strictEqual(terminal.execution, null);
  assert.strictEqual(terminal.postActionObservation, null);
  assert.strictEqual(terminal.invariant.actionExecuted, false);
  assert.strictEqual(terminal.invariant.transientPayloadRedacted, true);
  assert.strictEqual(observeCount, beforeTerminalCount + 1);

  await assert.rejects(() => runOneAction({
    runtime,
    baseline,
    decide: async () => ({ status: 'act', action: { type: 'click', targetRef: 'missing' } }),
    rng: () => 0.5
  }), /target_ref_not_in_observation/);

  let dragObserveCount = 0;
  let dragExecuted = null;
  const dragRuntime = {
    async observe() {
      dragObserveCount += 1;
      return {
        observationId: `drag-obs-${dragObserveCount}`,
        url: 'https://example.test/drag',
        title: dragExecuted ? 'DRAG PASS' : 'Drag Test',
        viewport: { width: 800, height: 600 },
        scroll: { x: 0, y: 0 },
        interactiveElements: [
          { ref: 'e10', tag: 'button', label: 'Drag Source', visible: true, enabled: true, rect: { x: 70, y: 190, width: 140, height: 70 } },
          { ref: 'e11', tag: 'button', label: 'Drop Zone', visible: true, enabled: true, rect: { x: 440, y: 170, width: 180, height: 120 } }
        ]
      };
    },
    async executePlan(payload) {
      dragExecuted = payload;
      return { ok: true, stepCount: payload.plan.steps.length };
    }
  };

  const drag = await runOneAction({
    runtime: dragRuntime,
    decide: async observation => {
      const source = observation.interactiveElements.find(x => x.label === 'Drag Source');
      const destination = observation.interactiveElements.find(x => x.label === 'Drop Zone');
      return {
        status: 'act',
        action: { type: 'drag', targetRef: source.ref, args: { destinationRef: destination.ref } }
      };
    },
    rng: () => 0.5,
    postActionSettle: false
  });
  assert.strictEqual(drag.mappedAction.type, 'drag');
  assert.strictEqual(drag.mappedAction.targetRef, 'e10');
  assert.strictEqual(drag.mappedAction.args.destinationRef, 'e11');
  assert.strictEqual(drag.behavior.metadata.behaviorFamily, 'pointer-drag');
  assert.strictEqual(drag.cdpPlan.cdpPlanVersion, '0.1.3');
  assert.strictEqual(drag.cdpPlan.targetRef, 'e10');
  assert.strictEqual(drag.cdpPlan.destinationRef, 'e11');
  assert.strictEqual(dragExecuted.observationId, 'drag-obs-1');
  assert.ok(drag.cdpPlan.steps.some(step => step.params?.type === 'mousePressed'));
  assert.ok(drag.cdpPlan.steps.some(step => step.params?.type === 'mouseReleased'));
  const heldMoves = drag.cdpPlan.steps.filter(step => step.params?.type === 'mouseMoved' && step.params?.buttons === 1);
  assert.ok(heldMoves.length >= 2);
  assert.ok(heldMoves.every(step => step.params.button === 'left'));
  const release = drag.cdpPlan.steps.find(step => step.params?.type === 'mouseReleased');
  assert.ok(release.params.x >= 440 && release.params.x <= 620);
  assert.ok(release.params.y >= 170 && release.params.y <= 290);
  assert.strictEqual(drag.after.title, 'DRAG PASS');
  assert.strictEqual(drag.postActionObservation.mode, 'immediate');

  await assert.rejects(() => runOneAction({
    runtime: dragRuntime,
    decide: async () => ({
      status: 'act',
      action: { type: 'drag', targetRef: 'e10', args: { destinationRef: 'missing' } }
    }),
    rng: () => 0.5,
    postActionSettle: false
  }), /destination_ref_not_in_observation/);

  let waitObserveCount = 0;
  let waitExecuted = null;
  const waitRuntime = {
    async observe() {
      waitObserveCount += 1;
      // First observation is the decision snapshot. The semantic change occurs only
      // after 63 subsequent 80ms polls (~5.04s), proving waitAndObserve is not
      // constrained by the ordinary 800ms post-action settle deadline.
      const ready = waitObserveCount >= 65;
      return {
        observationId: `wait-obs-${waitObserveCount}`,
        url: 'https://example.test/wait',
        title: ready ? 'WAITANDOBSERVE PASS' : 'WAITANDOBSERVE ARMED',
        viewport: { width: 800, height: 600 },
        scroll: { x: 0, y: 0 },
        interactiveElements: ready
          ? [{ ref: 'e1', tag: 'button', label: 'Wait Ready', visible: true, enabled: true, rect: { x: 20, y: 20, width: 100, height: 30 } }]
          : []
      };
    },
    async executePlan(payload) {
      waitExecuted = payload;
      assert.strictEqual(payload.plan.actionType, 'waitAndObserve');
      assert.deepStrictEqual(payload.plan.steps, []);
      return { ok: true, actionType: 'waitAndObserve', stepCount: 0, resultCount: 0 };
    }
  };

  const waited = await runOneAction({
    runtime: waitRuntime,
    decide: async () => ({ status: 'act', action: { type: 'waitAndObserve' } }),
    settleSleep: async () => {}
  });
  assert.strictEqual(waited.mappedAction.type, 'waitAndObserve');
  assert.strictEqual(waited.behavior.metadata.behaviorFamily, 'observation-wait');
  assert.strictEqual(waited.cdpPlan.actionType, 'waitAndObserve');
  assert.deepStrictEqual(waited.cdpPlan.steps, []);
  assert.strictEqual(waitExecuted.observationId, 'wait-obs-1');
  assert.strictEqual(waited.execution.ok, true);
  assert.strictEqual(waited.execution.stepCount, 0);
  assert.strictEqual(waited.after.title, 'WAITANDOBSERVE PASS');
  assert.ok(waited.after.interactiveElements.some(x => x.label === 'Wait Ready'));
  assert.strictEqual(waited.postActionObservation.mode, 'settled');
  assert.strictEqual(waited.postActionObservation.waitedMs, 5120);
  assert.strictEqual(waited.postActionObservation.semanticChanged, true);
  assert.strictEqual(waited.postActionObservation.deadlineReached, false);
  assert.strictEqual(waited.postActionObservation.policy.requireSemanticChange, true);
  assert.strictEqual(waited.postActionObservation.policy.maxWindowMs, 6000);

  console.log('One-action Agent bridge contract: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
