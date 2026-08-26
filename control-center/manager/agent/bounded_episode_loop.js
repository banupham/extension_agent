'use strict';

const { validateTask, validateDecision } = require('../strategy/contracts.js');
const { validateAgentAction } = require('../strategy/agent_action_contract.js');
const { runOneAction } = require('./one_action_bridge.js');
const { goalInputFor, actionTypeFor } = require('./one_step_replan.js');
const { evaluateGoal } = require('../goal/goal_checker.js');
const { reduceOutcomeToControl } = require('../goal/outcome_controller.js');
const { evaluateEpisodeBudget, DEFAULT_BUDGETS } = require('../goal/episode_budget.js');

const BOUNDED_EPISODE_LOOP_VERSION = '0.1.0';

function validateSemanticDecision(rawDecision) {
  const decision = validateDecision(rawDecision);
  if (decision.status !== 'act') return decision;
  return {
    ...decision,
    action: validateAgentAction(decision.action)
  };
}

async function executeBoundedEpisodeLoop(input = {}) {
  const task = validateTask(input.task);
  const runtime = input.runtime;
  const strategy = input.strategy;
  if (!runtime) throw new Error('bounded_episode_runtime_required');
  if (!strategy || typeof strategy.decide !== 'function') {
    throw new Error('bounded_episode_strategy_required');
  }

  const budgets = input.budgets || DEFAULT_BUDGETS;
  const startedAtMs = Number.isFinite(Number(input.startedAtMs)) ? Number(input.startedAtMs) : Date.now();
  let history = Array.isArray(input.history) ? input.history : [];
  const steps = [];
  let strategyCallCount = 0;
  let actionExecutionCount = 0;
  let terminalDecision = null;
  let finalOutcome = null;
  let finalControl = null;
  let finalBudget = null;

  while (true) {
    let chosenDecision = null;
    const step = await runOneAction({
      runtime,
      baseline: input.baseline || null,
      rng: input.rng,
      postActionSettle: input.postActionSettle,
      decide: async observation => {
        strategyCallCount += 1;
        const raw = await strategy.decide({ task, observation, history });
        chosenDecision = validateSemanticDecision(raw);
        return chosenDecision;
      }
    });

    if (!step?.execution) {
      terminalDecision = chosenDecision || step?.decision || null;
      break;
    }

    if (step?.invariant?.actionExecuted === true) actionExecutionCount += 1;

    const outcome = evaluateGoal(goalInputFor(task, step));
    const control = reduceOutcomeToControl({
      outcome,
      blocker: input.blocker || null
    });
    const budget = evaluateEpisodeBudget({
      history,
      control,
      actionType: actionTypeFor(step),
      budgets,
      startedAtMs,
      nowMs: Date.now()
    });
    history = budget.history;
    finalOutcome = outcome;
    finalControl = control;
    finalBudget = budget;

    steps.push({
      stepIndex: steps.length,
      decision: chosenDecision || step.decision || null,
      action: step.mappedAction || null,
      execution: step.execution,
      before: step.before || null,
      after: step.after || null,
      beforeBrowserContext: step.beforeBrowserContext || null,
      afterBrowserContext: step.afterBrowserContext || null,
      outcome,
      control,
      budget: {
        status: budget.status,
        terminal: budget.terminal,
        shouldReplan: budget.shouldReplan,
        reasonCode: budget.reasonCode,
        usage: budget.usage
      }
    });

    if (budget.terminal === true || budget.shouldReplan !== true) break;
  }

  return {
    boundedEpisodeLoopVersion: BOUNDED_EPISODE_LOOP_VERSION,
    task,
    steps,
    history,
    terminalDecision,
    finalOutcome,
    finalControl,
    finalBudget,
    invariant: {
      actionExecutionCount,
      strategyCallCount,
      oneStrategyCallPerLoop: strategyCallCount <= actionExecutionCount + (terminalDecision ? 1 : 0),
      strategyCallsMatchExecutedActions: terminalDecision ? strategyCallCount === actionExecutionCount + 1 : strategyCallCount === actionExecutionCount,
      stoppedOnTerminalBudget: finalBudget == null || finalBudget.terminal === true || terminalDecision != null,
      noActionAfterTerminalBudget: true,
      selectorUsedByStrategy: false,
      literalTrajectoryReplay: false
    }
  };
}

module.exports = {
  BOUNDED_EPISODE_LOOP_VERSION,
  validateSemanticDecision,
  executeBoundedEpisodeLoop
};
