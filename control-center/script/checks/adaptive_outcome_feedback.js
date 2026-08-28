'use strict';

const assert = require('assert');
const { executeBoundedEpisodeLoop } = require('../../manager/agent/bounded_episode_loop.js');

function observation(id, title) {
  return {
    observationId: id,
    capturedAt: new Date().toISOString(),
    url: 'https://example.test/task',
    title,
    viewport: { width: 900, height: 700 },
    scroll: { x: 0, y: 0 },
    focusedRef: null,
    interactiveElements: [
      {
        ref: 'e0',
        tag: 'button',
        role: 'button',
        label: 'No Op',
        visible: true,
        enabled: true,
        rect: { x: 100, y: 100, width: 120, height: 40 }
      },
      {
        ref: 'e1',
        tag: 'button',
        role: 'button',
        label: 'Finish',
        visible: true,
        enabled: true,
        rect: { x: 100, y: 180, width: 120, height: 40 }
      }
    ],
    pageSignals: {},
    privacy: { redacted: true }
  };
}

async function main() {
  let observeCount = 0;
  let title = 'READY';
  const executedTargets = [];
  const runtime = {
    async observe() {
      observeCount += 1;
      return observation(`obs-${observeCount}`, title);
    },
    async executePlan(payload) {
      executedTargets.push(payload?.plan?.targetRef || null);
      if (payload?.plan?.targetRef === 'e1') title = 'DONE';
      return { ok: true };
    }
  };

  let strategyCalls = 0;
  const strategy = {
    async decide({ history }) {
      strategyCalls += 1;
      if (!history.length) {
        return {
          status: 'act',
          action: { type: 'click', targetRef: 'e0', args: {}, intent: 'try-first-option' },
          reasonCode: 'explore_first'
        };
      }

      const last = history[history.length - 1];
      assert.equal(last.actionType, 'click');
      assert.equal(last.effectStatus, 'no_effect');
      assert.equal(last.observableEffectExpected, true);
      assert.deepEqual(last.effectCodes, []);
      assert.equal(last.controlStatus, 'failed');
      assert.equal(last.reasonCode, 'action_no_observable_effect');

      return {
        status: 'act',
        action: { type: 'click', targetRef: 'e1', args: {}, intent: 'recover-after-no-effect' },
        reasonCode: 'replan_from_semantic_feedback'
      };
    }
  };

  const result = await executeBoundedEpisodeLoop({
    runtime,
    strategy,
    task: {
      taskId: 'adaptive-feedback-contract',
      type: 'controlled-test',
      instruction: 'Reach DONE',
      successCriteria: [{ type: 'page', field: 'title', operator: 'equals', value: 'DONE' }]
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
  assert.equal(result.steps[0].effect.status, 'no_effect');
  assert.equal(result.steps[0].effect.observableEffectExpected, true);
  assert.equal(result.steps[0].control.status, 'failed');
  assert.equal(result.steps[0].control.reasonCode, 'action_no_observable_effect');
  assert.equal(result.steps[0].budget.terminal, false);
  assert.equal(result.steps[0].budget.shouldReplan, true);

  assert.equal(result.steps[1].effect.status, 'effect_observed');
  assert.ok(result.steps[1].effect.codes.includes('page_title_changed'));
  assert.equal(result.steps[1].outcome.taskSucceeded, true);
  assert.equal(result.finalControl.status, 'done');
  assert.equal(result.finalBudget.reasonCode, 'goal_satisfied');
  assert.deepEqual(executedTargets, ['e0', 'e1']);
  assert.equal(strategyCalls, 2);
  assert.equal(result.invariant.actionExecutionCount, 2);
  assert.equal(result.invariant.strategyCallCount, 2);
  assert.equal(result.invariant.selectorUsedByStrategy, false);
  assert.equal(result.invariant.literalTrajectoryReplay, false);

  console.log('Adaptive outcome feedback contract: PASS');
}

main().catch(error => {
  console.error('Adaptive outcome feedback contract: FAIL');
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
