'use strict';

const { mapAgentAction } = require('../strategy/agent_action_contract.js');
const { sampledBehavior } = require('../behavior/empirical_policy.js');
const { buildCdpPlan } = require('../execution/cdp_plan.js');

const BRIDGE_VERSION = '0.1.0';

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

async function runOneAction(options) {
  const runtime = options?.runtime;
  if (!runtime || typeof runtime.observe !== 'function' || typeof runtime.executePlan !== 'function') {
    throw new Error('runtime observe/executePlan required');
  }
  if (!options?.agentAction) throw new Error('agentAction required');

  const before = await runtime.observe();
  if (!before?.observationId) throw new Error('observation_id_missing');

  const mappedAction = mapAgentAction(options.agentAction);
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
    mappedAction,
    behavior,
    cdpPlan,
    execution,
    before,
    after,
    invariant: {
      oneActionOnly: true,
      reObservedAfterExecution: !!after?.observationId,
      selectorUsedByStrategy: false,
      literalTrajectoryReplay: false
    }
  };
}

module.exports = { BRIDGE_VERSION, findTarget, pointerStartFor, runOneAction };
