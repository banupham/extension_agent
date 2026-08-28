'use strict';

const { validateTask } = require('../strategy/contracts.js');
const { runOneAction } = require('./one_action_bridge.js');
const { orchestrateOneStepReplan, actionTypeFor, goalInputFor } = require('./one_step_replan.js');
const { evaluateGoal } = require('../goal/goal_checker.js');
const { reduceOutcomeToControl } = require('../goal/outcome_controller.js');
const { evaluateEpisodeBudget } = require('../goal/episode_budget.js');

const BOUNDED_TWO_STEP_VERSION = '0.1.0';

async function executeBoundedTwoStep(input = {}) {
  const task = validateTask(input.task);
  const runtime = input.runtime;
  if (!runtime) throw new Error('bounded_two_step_runtime_required');
  if (typeof input.firstDecide !== 'function' && !input.firstAction) {
    throw new Error('bounded_two_step_first_decide_or_action_required');
  }
  if (!input.strategy || typeof input.strategy.decide !== 'function') {
    throw new Error('bounded_two_step_strategy_required');
  }

  const budgets = input.budgets || {
    maxSteps: 8,
    maxDurationMs: 120000,
    maxConsecutiveFailures: 2,
    maxReplans: 6,
    maxStalledSteps: 3
  };
  const startedAtMs = Number.isFinite(Number(input.startedAtMs)) ? Number(input.startedAtMs) : Date.now();

  let actionExecutionCount = 0;
  const firstStep = await runOneAction({
    runtime,
    baseline: input.baseline || null,
    ...(typeof input.firstDecide === 'function' ? { decide: input.firstDecide } : { agentAction: input.firstAction }),
    rng: input.rng,
    postActionSettle: input.postActionSettle
  });
  if (!firstStep?.execution) throw new Error('bounded_two_step_first_action_not_executed');
  if (firstStep?.invariant?.actionExecuted === true) actionExecutionCount += 1;

  const firstControl = await orchestrateOneStepReplan({
    task,
    stepResult: firstStep,
    strategy: input.strategy,
    observeForReplan: input.observeForReplan || (() => runtime.observe()),
    history: Array.isArray(input.history) ? input.history : [],
    budgets,
    blocker: input.blocker || null,
    startedAtMs,
    nowMs: Date.now()
  });

  let secondStep = null;
  let finalOutcome = firstControl.outcome;
  let finalControl = firstControl.control;
  let finalBudget = firstControl.budget;
  const secondDecision = firstControl?.replan?.decision || null;

  if (
    firstControl?.replan?.permitted === true &&
    secondDecision?.status === 'act' &&
    secondDecision?.action
  ) {
    secondStep = await runOneAction({
      runtime,
      baseline: input.baseline || null,
      agentAction: secondDecision.action,
      rng: input.rng,
      postActionSettle: input.postActionSettle
    });
    if (secondStep?.invariant?.actionExecuted === true) actionExecutionCount += 1;

    finalOutcome = evaluateGoal(goalInputFor(task, secondStep));
    finalControl = reduceOutcomeToControl({
      outcome: finalOutcome,
      blocker: input.blocker || null
    });
    finalBudget = evaluateEpisodeBudget({
      history: firstControl.budget.history,
      control: finalControl,
      actionType: actionTypeFor(secondStep),
      budgets,
      startedAtMs,
      nowMs: Date.now()
    });
  }

  return {
    boundedTwoStepVersion: BOUNDED_TWO_STEP_VERSION,
    task,
    firstStep,
    firstControl,
    secondDecision,
    secondStep,
    finalOutcome,
    finalControl,
    finalBudget,
    invariant: {
      actionExecutionCount,
      atMostTwoActions: actionExecutionCount <= 2,
      secondActionExecutedOnlyFromReplan: secondStep == null || secondDecision?.status === 'act',
      secondActionMatchesReplanDecision: secondStep == null || secondStep?.mappedAction?.type === secondDecision?.action?.type,
      strategyCallsBeforeSecondAction: firstControl?.replan?.strategyCallCount || 0,
      boundedStrategyCalls: (firstControl?.replan?.strategyCallCount || 0) <= 1,
      noThirdActionExecuted: true,
      selectorUsedByStrategy: false,
      literalTrajectoryReplay: false
    }
  };
}

module.exports = {
  BOUNDED_TWO_STEP_VERSION,
  executeBoundedTwoStep
};
