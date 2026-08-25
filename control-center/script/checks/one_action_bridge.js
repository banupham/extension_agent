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
const runtime = {
  async observe() {
    observeCount += 1;
    return {
      observationId: `obs-${observeCount}`,
      viewport: { width: 1000, height: 700 },
      interactiveElements: [
        { ref: 'e17', tag: 'button', role: 'button', label: 'Like', rect: { x: 700, y: 300, width: 80, height: 32 } }
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
    rng: () => 0.5
  });
  assert.strictEqual(result.bridgeVersion, '0.2.0');
  assert.strictEqual(brainSawObservationId, 'obs-1');
  assert.strictEqual(result.beforeObservationId, 'obs-1');
  assert.strictEqual(result.afterObservationId, 'obs-2');
  assert.strictEqual(result.decision.status, 'act');
  assert.strictEqual(result.mappedAction.type, 'click');
  assert.strictEqual(result.behavior.metadata.behaviorFamily, 'pointer-click');
  assert.strictEqual(result.cdpPlan.actionType, 'click');
  assert.ok(result.cdpPlan.steps.length > 2);
  assert.strictEqual(executed.observationId, 'obs-1');
  assert.strictEqual(result.invariant.oneActionOnly, true);
  assert.strictEqual(result.invariant.actionExecuted, true);
  assert.strictEqual(result.invariant.reObservedAfterExecution, true);
  assert.strictEqual(result.invariant.selectorUsedByStrategy, false);
  assert.strictEqual(observeCount, 2);

  const beforeTerminalCount = observeCount;
  const terminal = await runOneAction({
    runtime,
    baseline,
    decide: async () => ({ status: 'blocked', reasonCode: 'human_verification_required' })
  });
  assert.strictEqual(terminal.decision.status, 'blocked');
  assert.strictEqual(terminal.execution, null);
  assert.strictEqual(terminal.invariant.actionExecuted, false);
  assert.strictEqual(observeCount, beforeTerminalCount + 1);

  await assert.rejects(() => runOneAction({
    runtime,
    baseline,
    decide: async () => ({ status: 'act', action: { type: 'click', targetRef: 'missing' } }),
    rng: () => 0.5
  }), /target_ref_not_in_observation/);

  console.log('One-action Agent bridge contract: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
