'use strict';

const assert = require('assert');
const { runGate } = require('../offline_strategy_replan_gate.js');

function observation(id, title) {
  return {
    observationId: id,
    capturedAt: new Date().toISOString(),
    url: 'http://127.0.0.1:8091/',
    title,
    viewport: { width: 1200, height: 800 },
    scroll: { x: 0, y: 0 },
    focusedElement: null,
    interactiveElements: [
      {
        ref: 'e7',
        tag: 'button',
        role: 'button',
        label: 'Media Play',
        visible: true,
        enabled: true,
        rect: { x: 100, y: 100, width: 120, height: 40 }
      }
    ],
    pageSignals: {},
    privacy: { redacted: true }
  };
}

async function main() {
  let executeCount = 0;
  let observeCount = 0;
  const runtime = {
    async observe() {
      observeCount += 1;
      return observation(`obs-${observeCount}`, 'PAGE_CDP Batch Lab');
    },
    async executePlan(payload) {
      assert.ok(payload && payload.plan && Array.isArray(payload.plan.steps));
      executeCount += 1;
      return { ok: true };
    }
  };

  const model = {
    modelVersion: '0.1.0',
    kind: 'offline-semantic-prototype-baseline',
    actionPrototypes: [
      {
        type: 'play',
        examples: 1,
        instructions: ['Start media playback'],
        targetLabels: ['Media Play']
      }
    ]
  };

  const result = await runGate({
    runtime,
    model,
    instruction: 'Start media playback',
    expectedAction: 'play',
    expectedTitle: 'PLAY PASS',
    firstTargetLabel: 'Media Play'
  });

  assert.equal(result.ok, true);
  assert.equal(result.result, 'PASS');
  assert.equal(result.primerAction.type, 'moveTo');
  assert.equal(result.outcome.taskSucceeded, false);
  assert.equal(result.control.status, 'continue');
  assert.equal(result.budget.shouldReplan, true);
  assert.equal(result.replan.strategyCallCount, 1);
  assert.equal(result.replan.decision.status, 'act');
  assert.equal(result.replan.decision.action.type, 'play');
  assert.equal(result.invariant.nextActionExecuted, false);
  assert.equal(result.invariant.boundedStrategyCalls, true);
  assert.equal(result.invariant.returnedActDecisionUsesSemanticAgentAction, true);
  assert.equal(executeCount, 1);

  console.log('Offline Strategy one-step replan contract: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
