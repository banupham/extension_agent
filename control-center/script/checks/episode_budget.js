'use strict';

const assert = require('assert');
const {
  DEFAULT_BUDGETS,
  normalizeBudgets,
  evaluateEpisodeBudget
} = require('../../manager/goal/episode_budget.js');

function control(status, overrides = {}) {
  const defaults = {
    done: {
      terminal: true,
      shouldReplan: false,
      reasonCode: 'goal_satisfied',
      actionSucceeded: true,
      taskSucceeded: true,
      progress: 1,
      progressDelta: 1,
      errorCode: null
    },
    continue: {
      terminal: false,
      shouldReplan: true,
      reasonCode: 'goal_not_yet_satisfied',
      actionSucceeded: true,
      taskSucceeded: false,
      progress: 0,
      progressDelta: 0,
      errorCode: null
    },
    failed: {
      terminal: false,
      shouldReplan: true,
      reasonCode: 'target_geometry_changed',
      actionSucceeded: false,
      taskSucceeded: false,
      progress: 0,
      progressDelta: 0,
      errorCode: 'target_geometry_changed'
    },
    blocked: {
      terminal: true,
      shouldReplan: false,
      reasonCode: 'human_verification_required',
      actionSucceeded: true,
      taskSucceeded: false,
      progress: 0,
      progressDelta: 0,
      errorCode: null
    }
  };
  return { status, ...defaults[status], ...overrides };
}

function append(state, stepControl, options = {}) {
  return evaluateEpisodeBudget({
    history: state?.history || [],
    control: stepControl,
    actionType: options.actionType || 'click',
    budgets: options.budgets || state?.budgets || DEFAULT_BUDGETS,
    startedAtMs: options.startedAtMs ?? state?.startedAtMs ?? 1000,
    nowMs: options.nowMs ?? 1100
  });
}

function main() {
  assert.deepEqual(normalizeBudgets({}), DEFAULT_BUDGETS);
  assert.throws(() => normalizeBudgets({ maxSteps: 0 }), /budget_max_steps_positive_integer_required/);
  assert.throws(() => normalizeBudgets({ maxDurationMs: -1 }), /budget_max_duration_positive_required/);

  const ordinary = append(null, control('continue'), {
    budgets: { maxSteps: 5, maxDurationMs: 10000, maxConsecutiveFailures: 2, maxReplans: 4, maxStalledSteps: 3 },
    nowMs: 1200
  });
  assert.equal(ordinary.status, 'continue');
  assert.equal(ordinary.terminal, false);
  assert.equal(ordinary.shouldReplan, true);
  assert.equal(ordinary.exhausted, false);
  assert.equal(ordinary.usage.steps, 1);
  assert.equal(ordinary.usage.replansRequested, 1);
  assert.equal(ordinary.usage.stalledSteps, 1);
  assert.equal(ordinary.history.length, 1);
  assert.deepEqual(Object.keys(ordinary.step), [
    'stepIndex', 'recordedAtMs', 'actionType', 'controlStatus',
    'actionSucceeded', 'taskSucceeded', 'progress', 'progressDelta',
    'reasonCode', 'errorCode', 'shouldReplan'
  ]);

  const doneAtStepLimit = append({
    history: [ordinary.step, { ...ordinary.step, stepIndex: 2 }],
    budgets: { maxSteps: 3, maxDurationMs: 10000, maxConsecutiveFailures: 2, maxReplans: 4, maxStalledSteps: 3 },
    startedAtMs: 1000
  }, control('done'), { nowMs: 1300 });
  assert.equal(doneAtStepLimit.usage.steps, 3);
  assert.equal(doneAtStepLimit.status, 'done');
  assert.equal(doneAtStepLimit.terminal, true);
  assert.equal(doneAtStepLimit.exhausted, false);

  const blocked = append(null, control('blocked'), {
    budgets: { maxSteps: 1, maxDurationMs: 1, maxConsecutiveFailures: 1, maxReplans: 1, maxStalledSteps: 1 },
    startedAtMs: 1000,
    nowMs: 5000
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.terminal, true);
  assert.equal(blocked.reasonCode, 'human_verification_required');
  assert.equal(blocked.exhausted, false);

  const maxSteps = append({
    history: [ordinary.step],
    budgets: { maxSteps: 2, maxDurationMs: 10000, maxConsecutiveFailures: 3, maxReplans: 5, maxStalledSteps: 5 },
    startedAtMs: 1000
  }, control('continue', { progressDelta: 0.2, progress: 0.2 }), { nowMs: 1300 });
  assert.equal(maxSteps.status, 'failed');
  assert.equal(maxSteps.terminal, true);
  assert.equal(maxSteps.reasonCode, 'budget_max_steps_reached');

  const maxDuration = append(null, control('continue', { progressDelta: 0.2 }), {
    budgets: { maxSteps: 10, maxDurationMs: 500, maxConsecutiveFailures: 3, maxReplans: 5, maxStalledSteps: 5 },
    startedAtMs: 1000,
    nowMs: 1500
  });
  assert.equal(maxDuration.reasonCode, 'budget_max_duration_reached');
  assert.equal(maxDuration.exhausted, true);

  const failure1 = append(null, control('failed'), {
    budgets: { maxSteps: 10, maxDurationMs: 10000, maxConsecutiveFailures: 2, maxReplans: 8, maxStalledSteps: 5 },
    nowMs: 1100
  });
  assert.equal(failure1.status, 'continue');
  assert.equal(failure1.reasonCode, 'replan_after_step_failure');
  assert.equal(failure1.usage.consecutiveFailures, 1);

  const failure2 = append(failure1, control('failed'), { nowMs: 1200 });
  assert.equal(failure2.status, 'failed');
  assert.equal(failure2.terminal, true);
  assert.equal(failure2.reasonCode, 'budget_consecutive_failures_reached');
  assert.equal(failure2.usage.consecutiveFailures, 2);

  const stall1 = append(null, control('continue'), {
    budgets: { maxSteps: 10, maxDurationMs: 10000, maxConsecutiveFailures: 3, maxReplans: 8, maxStalledSteps: 2 },
    nowMs: 1100
  });
  assert.equal(stall1.status, 'continue');
  assert.equal(stall1.usage.stalledSteps, 1);

  const stall2 = append(stall1, control('continue'), { nowMs: 1200 });
  assert.equal(stall2.status, 'failed');
  assert.equal(stall2.reasonCode, 'budget_stalled_progress_reached');
  assert.equal(stall2.usage.stalledSteps, 2);

  const stallReset1 = append(null, control('continue'), {
    budgets: { maxSteps: 10, maxDurationMs: 10000, maxConsecutiveFailures: 3, maxReplans: 8, maxStalledSteps: 3 },
    nowMs: 1100
  });
  const progressed = append(stallReset1, control('continue', { progress: 0.5, progressDelta: 0.5, reasonCode: 'goal_progressed' }), { nowMs: 1200 });
  assert.equal(progressed.status, 'continue');
  assert.equal(progressed.usage.stalledSteps, 0);
  const afterProgressStall = append(progressed, control('continue', { progress: 0.5, progressDelta: 0 }), { nowMs: 1300 });
  assert.equal(afterProgressStall.usage.stalledSteps, 1);
  assert.equal(afterProgressStall.status, 'continue');

  const replan1 = append(null, control('continue', { progressDelta: 0.2 }), {
    budgets: { maxSteps: 10, maxDurationMs: 10000, maxConsecutiveFailures: 3, maxReplans: 1, maxStalledSteps: 5 },
    nowMs: 1100
  });
  assert.equal(replan1.status, 'continue');
  assert.equal(replan1.usage.replansRequested, 1);
  const replan2 = append(replan1, control('continue', { progressDelta: 0.2 }), { nowMs: 1200 });
  assert.equal(replan2.status, 'failed');
  assert.equal(replan2.reasonCode, 'budget_max_replans_reached');
  assert.equal(replan2.usage.replansRequested, 2);

  const failureReset = append(failure1, control('continue', { progress: 0.25, progressDelta: 0.25, reasonCode: 'goal_progressed' }), { nowMs: 1200 });
  assert.equal(failureReset.usage.consecutiveFailures, 0);
  assert.equal(failureReset.status, 'continue');

  console.log('A5.3 Episode Budget + compact step history contract: PASS');
}

main();
