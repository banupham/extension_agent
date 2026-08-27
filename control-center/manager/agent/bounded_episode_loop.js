'use strict';

const { validateTask, validateDecision } = require('../strategy/contracts.js');
const { validateAgentAction } = require('../strategy/agent_action_contract.js');
const { runOneAction } = require('./one_action_bridge.js');
const { goalInputFor, actionTypeFor } = require('./one_step_replan.js');
const { evaluateGoal } = require('../goal/goal_checker.js');
const { evaluateActionEffect } = require('../goal/semantic_effect_evaluator.js');
const { reduceOutcomeToControl } = require('../goal/outcome_controller.js');
const { evaluateEpisodeBudget, DEFAULT_BUDGETS } = require('../goal/episode_budget.js');

const BOUNDED_EPISODE_LOOP_VERSION = '0.5.0';

function validateSemanticDecision(rawDecision) {
  const decision = validateDecision(rawDecision);
  if (decision.status !== 'act') return decision;
  return {
    ...decision,
    action: validateAgentAction(decision.action)
  };
}

function semanticTargetLabel(action, observation) {
  const targetRef = typeof action?.targetRef === 'string' ? action.targetRef : null;
  if (!targetRef) return null;
  const elements = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  const target = elements.find(element => element?.ref === targetRef) || null;
  const label = typeof target?.label === 'string' ? target.label.trim() : '';
  return label || null;
}

function copyArray(value) {
  return Array.isArray(value) ? [...value] : [];
}

function copyDecisionFeedback(out, metadata = {}) {
  const source = String(metadata.prototypeSource || '').trim();
  if (source) out.decisionSource = source;

  const triggerActionType = String(metadata.triggerActionType || '').trim();
  if (triggerActionType) {
    out.recoveryTriggerActionType = triggerActionType;
    const targetLabel = typeof metadata.triggerTargetLabel === 'string' ? metadata.triggerTargetLabel.trim() : '';
    out.recoveryTriggerTargetLabel = targetLabel || null;
    out.recoveryTriggerReasonCode = String(metadata.triggerReasonCode || '').trim() || null;
    out.recoveryTriggerEffectStatus = String(metadata.triggerEffectStatus || '').trim() || null;
    out.recoveryTriggerEffectCodes = copyArray(metadata.triggerEffectCodes);
  }
  return out;
}

function mergeSemanticFeedback(historyBefore, budgetHistory, effect, feedback = {}) {
  const previous = new Map((Array.isArray(historyBefore) ? historyBefore : []).map(entry => [Number(entry?.stepIndex), entry]));
  const latestStepIndex = Array.isArray(budgetHistory) && budgetHistory.length
    ? Number(budgetHistory[budgetHistory.length - 1]?.stepIndex)
    : null;

  return (Array.isArray(budgetHistory) ? budgetHistory : []).map(entry => {
    const prior = previous.get(Number(entry?.stepIndex)) || null;
    const out = { ...entry };
    if (prior?.effectStatus) out.effectStatus = prior.effectStatus;
    if (Array.isArray(prior?.effectCodes)) out.effectCodes = copyArray(prior.effectCodes);
    if (Array.isArray(prior?.effectMeaningfulCodes)) out.effectMeaningfulCodes = copyArray(prior.effectMeaningfulCodes);
    if (Array.isArray(prior?.effectIncidentalCodes)) out.effectIncidentalCodes = copyArray(prior.effectIncidentalCodes);
    if (Number.isFinite(Number(prior?.effectConfidence))) out.effectConfidence = Number(prior.effectConfidence);
    if (typeof prior?.observableEffectExpected === 'boolean') out.observableEffectExpected = prior.observableEffectExpected;
    if (typeof prior?.actionTargetLabel === 'string' && prior.actionTargetLabel.trim()) out.actionTargetLabel = prior.actionTargetLabel.trim();
    if (typeof prior?.decisionSource === 'string' && prior.decisionSource.trim()) out.decisionSource = prior.decisionSource.trim();
    if (typeof prior?.recoveryTriggerActionType === 'string' && prior.recoveryTriggerActionType.trim()) {
      out.recoveryTriggerActionType = prior.recoveryTriggerActionType.trim();
      out.recoveryTriggerTargetLabel = prior.recoveryTriggerTargetLabel || null;
      out.recoveryTriggerReasonCode = prior.recoveryTriggerReasonCode || null;
      out.recoveryTriggerEffectStatus = prior.recoveryTriggerEffectStatus || null;
      out.recoveryTriggerEffectCodes = copyArray(prior.recoveryTriggerEffectCodes);
    }
    if (Number(entry?.stepIndex) === latestStepIndex && effect) {
      out.effectStatus = effect.status;
      out.effectCodes = copyArray(effect.codes);
      out.effectMeaningfulCodes = copyArray(effect.meaningfulCodes);
      out.effectIncidentalCodes = copyArray(effect.incidentalCodes);
      out.effectConfidence = effect.confidence;
      out.observableEffectExpected = effect.observableEffectExpected === true;
      if (typeof feedback.actionTargetLabel === 'string' && feedback.actionTargetLabel.trim()) {
        out.actionTargetLabel = feedback.actionTargetLabel.trim();
      }
      copyDecisionFeedback(out, feedback.decision?.metadata || {});
    }
    return out;
  });
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

    const goalOutcome = evaluateGoal(goalInputFor(task, step));
    const effect = evaluateActionEffect({
      execution: step.execution,
      action: step.mappedAction || chosenDecision?.action || null,
      before: step.before || null,
      after: step.after || null,
      beforeBrowserContext: step.beforeBrowserContext || null,
      afterBrowserContext: step.afterBrowserContext || null
    });
    const outcome = {
      ...goalOutcome,
      metadata: {
        ...(goalOutcome.metadata || {}),
        actionEffectStatus: effect.status,
        actionEffectConfidence: effect.confidence,
        actionEffectCodes: copyArray(effect.codes),
        actionEffectMeaningfulCodes: copyArray(effect.meaningfulCodes),
        actionEffectIncidentalCodes: copyArray(effect.incidentalCodes),
        actionEffectExpected: effect.observableEffectExpected === true,
        semanticChangeCount: effect.semanticChangeCount,
        meaningfulChangeCount: effect.meaningfulChangeCount
      }
    };
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
    const actionTargetLabel = semanticTargetLabel(step.mappedAction || chosenDecision?.action || null, step.before || null);
    history = mergeSemanticFeedback(history, budget.history, effect, {
      actionTargetLabel,
      decision: chosenDecision || step.decision || null
    });
    finalOutcome = outcome;
    finalControl = control;
    finalBudget = budget;

    const completedStep = {
      stepIndex: steps.length,
      decision: chosenDecision || step.decision || null,
      action: step.mappedAction || null,
      execution: step.execution,
      before: step.before || null,
      after: step.after || null,
      beforeBrowserContext: step.beforeBrowserContext || null,
      afterBrowserContext: step.afterBrowserContext || null,
      effect,
      outcome,
      control,
      budget: {
        status: budget.status,
        terminal: budget.terminal,
        shouldReplan: budget.shouldReplan,
        reasonCode: budget.reasonCode,
        usage: budget.usage
      }
    };
    steps.push(completedStep);

    if (typeof input.onStep === 'function') {
      await input.onStep({
        task,
        step: completedStep,
        history,
        steps: [...steps],
        control,
        budget
      });
    }

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
  semanticTargetLabel,
  copyArray,
  copyDecisionFeedback,
  mergeSemanticFeedback,
  executeBoundedEpisodeLoop
};
