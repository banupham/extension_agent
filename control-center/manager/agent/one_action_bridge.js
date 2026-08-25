'use strict';

const { mapAgentAction } = require('../strategy/agent_action_contract.js');
const { sampledBehavior } = require('../behavior/empirical_policy.js');
const { buildCdpPlan } = require('../execution/cdp_plan.js');

const BRIDGE_VERSION = '0.2.0';

function findTarget(observation, targetRef) {
  if (!targetRef) return null;
  const targets = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  return targets.find(target => target?.ref === targetRef) || null;
}

function pointerStartFor(observation, previousPointer = null) {
  if (previousPointer && Number.isFinite(Number(previousPointer.x)) && Number.isFinite(Number(previousPointer.y))) {
    return { x: Number(previousPointer.x), y: Number(previousPointer.y) };
  }
  const viewport = observation?.viewport || {};
  const width = Number(viewport.width), height = Number(viewport.height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { x: width / 2, y: height / 2 };
  }
  return { x: 400, y: 300 };
}

async function decideOneAction(options, observation) {
  if (typeof options?.decide === 'function') {
    const decision = await options.decide(observation);
    if (!decision || typeof decision !== 'object') throw new Error('brain_decision_missing');
    if (decision.status && decision.status !== 'act') {
      return { terminal: true, decision };
    }
    const action = decision.action || decision.agentAction || null;
    if (!action) throw new Error('brain_action_missing');
    return { terminal: false, decision, action };
  }
  if (options?.agentAction) {
    return {
      terminal: false,
      decision: { status: 'act', source: 'provided-agent-action', action: options.agentAction },
      action: options.agentAction
    };
  }
  throw new Error('decide_or_agentAction_required');
}

async function runOneAction(options) {
  const runtime = options?.runtime;
  if (!runtime || typeof runtime.observe !== 'function' || typeof runtime.executePlan !== 'function') {
    throw new Error('runtime observe/executePlan required');
  }

  const before = await runtime.observe();
  if (!before?.observationId) throw new Error('observation_id_missing');

  const chosen = await decideOneAction(options, before);
  if (chosen.terminal) {
    return {
      bridgeVersion: BRIDGE_VERSION,
      beforeObservationId: before.observationId,
      afterObservationId: null,
      decision: chosen.decision,
      mappedAction: null,
      behavior: null,
      cdpPlan: null,
      execution: null,
      before,
      after: null,
      invariant: {
        oneActionOnly: true,
        actionExecuted: false,
        reObservedAfterExecution: false,
        selectorUsedByStrategy: false,
        literalTrajectoryReplay: false
      }
    };
  }

  const mappedAction = mapAgentAction(chosen.action);
  const target = mappedAction.targetRef ? findTarget(before, mappedAction.targetRef) : null;
  if (mappedAction.targetRef && !target) throw new Error('target_ref_not_in_observation');

  const behavior = sampledBehavior({
    baseline: options.baseline || null,
    mappedAction,
    target,
    rng: options.rng || Math.random
  });

  const cdpPlan = buildCdpPlan({
    mappedAction,
    behavior,
    target,
    context: {
      pointerStart: pointerStartFor(before, options.previousPointer || before.agentPointer || null),
      viewportCenter: pointerStartFor(before, null),
      rng: options.rng || Math.random
    }
  });

  const execution = await runtime.executePlan({
    observationId: before.observationId,
    plan: cdpPlan
  });

  const after = await runtime.observe();

  return {
    bridgeVersion: BRIDGE_VERSION,
    beforeObservationId: before.observationId,
    afterObservationId: after?.observationId || null,
    decision: chosen.decision,
    mappedAction,
    behavior,
    cdpPlan,
    execution,
    before,
    after,
    invariant: {
      oneActionOnly: true,
      actionExecuted: true,
      reObservedAfterExecution: !!after?.observationId,
      selectorUsedByStrategy: false,
      literalTrajectoryReplay: false
    }
  };
}

module.exports = { BRIDGE_VERSION, findTarget, pointerStartFor, decideOneAction, runOneAction };
