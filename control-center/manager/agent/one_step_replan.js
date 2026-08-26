'use strict';

const { validateTask, validateObservation, validateDecision } = require('../strategy/contracts.js');
const { validateAgentAction } = require('../strategy/agent_action_contract.js');
const { evaluateGoal } = require('../goal/goal_checker.js');
const { reduceOutcomeToControl } = require('../goal/outcome_controller.js');
const { evaluateEpisodeBudget } = require('../goal/episode_budget.js');

const ONE_STEP_REPLAN_VERSION = '0.1.0';

function requireStepResult(stepResult) {
  if (!stepResult || typeof stepResult !== 'object' || Array.isArray(stepResult)) {
    throw new Error('replan_step_result_required');
  }
  if (!stepResult.execution || typeof stepResult.execution !== 'object') {
    throw new Error('replan_step_execution_required');
  }
  return stepResult;
}

function actionTypeFor(stepResult) {
  const type = String(stepResult?.mappedAction?.type || stepResult?.decision?.action?.type || '').trim();
  return type || null;
}

function goalInputFor(task, stepResult) {
  return {
    task,
    before: stepResult.before || null,
    after: stepResult.after || null,
    beforeBrowserContext: stepResult.beforeBrowserContext || null,
    afterBrowserContext: stepResult.afterBrowserContext || null,
    execution: stepResult.execution
  };
}

async function resolveReplanObservation(stepResult, observeForReplan) {
  if (stepResult?.after?.observationId) {
    return {
      observation: validateObservation(stepResult.after),
      source: 'settled-after'
    };
  }

  if (typeof observeForReplan !== 'function') {
    throw new Error('replan_observation_required');
  }

  const observed = await observeForReplan();
  const observation = validateObservation(observed);
  if (!observation.observationId) throw new Error('replan_observation_id_required');
  return {
    observation,
    source: 'fresh-observe'
  };
}

function validateSemanticReplanDecision(rawDecision) {
  const decision = validateDecision(rawDecision);
  if (decision.status !== 'act') return decision;
  return {
    ...decision,
    action: validateAgentAction(decision.action)
  };
}

function baseReplanState(permitted) {
  return {
    permitted,
    attempted: false,
    strategyCallCount: 0,
    observationSource: null,
    observationId: null,
    decision: null,
    errorCode: null
  };
}

function buildResult({ outcome, control, budget, replan }) {
  return {
    oneStepReplanVersion: ONE_STEP_REPLAN_VERSION,
    outcome,
    control,
    budget,
    replan,
    invariant: {
      boundedStrategyCalls: replan.strategyCallCount <= 1,
      oneSemanticActionPerLoop: true,
      nextActionExecuted: false,
      returnedActDecisionUsesSemanticAgentAction: replan.decision?.status !== 'act' || !!replan.decision?.action?.contractVersion,
      goalCheckerChoseAction: false,
      episodeBudgetCalledStrategy: false
    }
  };
}

async function orchestrateOneStepReplan(input = {}) {
  const task = validateTask(input.task);
  const stepResult = requireStepResult(input.stepResult);

  const outcome = evaluateGoal(goalInputFor(task, stepResult));
  const control = reduceOutcomeToControl({
    outcome,
    blocker: input.blocker || null
  });
  const budget = evaluateEpisodeBudget({
    history: Array.isArray(input.history) ? input.history : [],
    control,
    actionType: actionTypeFor(stepResult),
    budgets: input.budgets || {},
    startedAtMs: input.startedAtMs,
    nowMs: input.nowMs
  });

  const permitted = budget.terminal !== true && budget.shouldReplan === true;
  const replan = baseReplanState(permitted);

  if (!permitted) {
    return buildResult({ outcome, control, budget, replan });
  }

  const strategy = input.strategy;
  if (!strategy || typeof strategy.decide !== 'function') {
    throw new Error('replan_strategy_decide_required');
  }

  const resolved = await resolveReplanObservation(stepResult, input.observeForReplan);
  replan.observationSource = resolved.source;
  replan.observationId = resolved.observation.observationId;
  replan.attempted = true;
  replan.strategyCallCount = 1;

  let rawDecision;
  try {
    rawDecision = await strategy.decide({
      task,
      observation: resolved.observation,
      history: budget.history
    });
  } catch (error) {
    replan.errorCode = 'replan_strategy_failed';
    return buildResult({ outcome, control, budget, replan });
  }

  try {
    replan.decision = validateSemanticReplanDecision(rawDecision);
  } catch (error) {
    replan.errorCode = 'replan_decision_invalid';
  }

  return buildResult({ outcome, control, budget, replan });
}

module.exports = {
  ONE_STEP_REPLAN_VERSION,
  requireStepResult,
  actionTypeFor,
  goalInputFor,
  resolveReplanObservation,
  validateSemanticReplanDecision,
  orchestrateOneStepReplan
};
