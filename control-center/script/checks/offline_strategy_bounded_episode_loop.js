'use strict';

const assert = require('assert');
const { executeBoundedEpisodeLoop } = require('../../manager/agent/bounded_episode_loop.js');

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
  let observeCount = 0;
  let executeCount = 0;
  let title = 'PAGE_CDP Batch Lab';
  const runtime = {
    async observe() {
      observeCount += 1;
      return observation(`obs-${observeCount}`, title);
    },
    async executePlan(payload) {
      assert.ok(payload && payload.plan && Array.isArray(payload.plan.steps));
      executeCount += 1;
      if (payload.plan.actionType === 'play') title = 'PLAY PASS';
      return { ok: true };
    }
  };

  let strategyCalls = 0;
  const strategy = {
    async decide({ history }) {
      strategyCalls += 1;
      assert.equal(history.length, strategyCalls - 1);
      if (strategyCalls === 1) {
        return {
          status: 'act',
          action: { type: 'moveTo', targetRef: 'e7', args: {} },
          reasonCode: 'contract_primer'
        };
      }
      return {
        status: 'act',
        action: { type: 'play', targetRef: 'e7', args: {} },
        reasonCode: 'contract_goal_action'
      };
    }
  };

  const result = await executeBoundedEpisodeLoop({
    runtime,
    strategy,
    task: {
      taskId: 'bounded-episode-contract',
      type: 'controlled-test',
      instruction: 'Start media playback',
      successCriteria: [
        { type: 'page', field: 'title', operator: 'equals', value: 'PLAY PASS' }
      ]
    },
    budgets: {
      maxSteps: 4,
      maxDurationMs: 120000,
      maxConsecutiveFailures: 2,
      maxReplans: 3,
      maxStalledSteps: 3
    }
  });

  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[0].action.type, 'moveTo');
  assert.equal(result.steps[0].control.status, 'continue');
  assert.equal(result.steps[1].action.type, 'play');
  assert.equal(result.steps[1].after.title, 'PLAY PASS');
  assert.equal(result.finalOutcome.taskSucceeded, true);
  assert.equal(result.finalControl.status, 'done');
  assert.equal(result.finalBudget.terminal, true);
  assert.equal(result.finalBudget.reasonCode, 'goal_satisfied');
  assert.equal(result.invariant.actionExecutionCount, 2);
  assert.equal(result.invariant.strategyCallCount, 2);
  assert.equal(result.invariant.oneStrategyCallPerLoop, true);
  assert.equal(result.invariant.strategyCallsMatchExecutedActions, true);
  assert.equal(result.invariant.noActionAfterTerminalBudget, true);
  assert.equal(executeCount, 2);
  assert.equal(strategyCalls, 2);

  console.log('Offline Strategy bounded episode loop contract: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
