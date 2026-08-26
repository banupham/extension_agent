'use strict';

const assert = require('assert');
const { runGate } = require('../offline_strategy_bounded_two_step_gate.js');

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
  let phase = 'ready';
  const runtime = {
    async observe() {
      observeCount += 1;
      return observation(`obs-${observeCount}`, phase === 'done' ? 'PLAY PASS' : 'PAGE_CDP Batch Lab');
    },
    async executePlan(payload) {
      assert.ok(payload && payload.plan && Array.isArray(payload.plan.steps));
      executeCount += 1;
      if (payload.plan.actionType === 'play') phase = 'done';
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
  assert.equal(result.firstControl.outcome.taskSucceeded, false);
  assert.equal(result.firstControl.control.status, 'continue');
  assert.equal(result.firstControl.budget.shouldReplan, true);
  assert.equal(result.firstControl.replan.strategyCallCount, 1);
  assert.equal(result.secondAction.type, 'play');
  assert.equal(result.afterSecond.title, 'PLAY PASS');
  assert.equal(result.finalOutcome.taskSucceeded, true);
  assert.equal(result.finalControl.status, 'done');
  assert.equal(result.finalBudget.terminal, true);
  assert.equal(result.finalBudget.reasonCode, 'goal_satisfied');
  assert.equal(result.invariant.actionExecutionCount, 2);
  assert.equal(result.invariant.atMostTwoActions, true);
  assert.equal(result.invariant.boundedStrategyCalls, true);
  assert.equal(result.invariant.secondActionExecutedOnlyFromReplan, true);
  assert.equal(result.invariant.secondActionMatchesReplanDecision, true);
  assert.equal(result.invariant.noThirdActionExecuted, true);
  assert.equal(result.invariant.selectorUsedByStrategy, false);
  assert.equal(result.invariant.literalTrajectoryReplay, false);
  assert.equal(executeCount, 2);

  console.log('Offline Strategy bounded two-step contract: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
