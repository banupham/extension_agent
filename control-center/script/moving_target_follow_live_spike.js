'use strict';

const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { mapAgentAction } = require('../manager/strategy/agent_action_contract.js');
const { sampledBehavior } = require('../manager/behavior/empirical_policy.js');
const { buildCdpPlan } = require('../manager/execution/cdp_plan.js');
const { pointerStartFor } = require('../manager/agent/one_action_bridge.js');
const {
  withTargetTrackingBehavior,
  withTargetTrackingPlan
} = require('../manager/execution/target_tracking_variant.js');
const {
  parseArgs,
  discoverRuntimeAgent,
  resolveCommandTabId,
  chooseTarget
} = require('./agent_one_action.js');

const ALLOWED_TYPES = new Set(['submit', 'hoverAndObserve']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0))));

function normalizedDelay(value) {
  const n = Number(value ?? 350);
  if (!Number.isFinite(n) || n < 0 || n > 1500) throw new Error('follow_live_spike_delay_must_be_0_to_1500_ms');
  return Math.round(n);
}

function deterministicRng() {
  return 0.5;
}

function actionFor(args, target) {
  const type = String(args.type || '').trim();
  if (!ALLOWED_TYPES.has(type)) throw new Error('follow_live_spike_type_must_be_submit_or_hoverAndObserve');
  if (!target?.ref) throw new Error('follow_live_spike_target_required');
  return { type, targetRef: target.ref, args: {} };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const requestedMode = String(args['target-tracking'] || 'follow-live').trim().toLowerCase();
  if (requestedMode !== 'follow-live') throw new Error('follow_live_spike_requires_target_tracking_follow-live');

  const agentId = args.agent || await discoverRuntimeAgent(args['health-base'] || 'http://127.0.0.1:3000');
  const runtime = createBrokerRuntimeClient({
    url: args.broker || 'ws://127.0.0.1:3000',
    agentId,
    timeoutMs: Number(args.timeout || 10000)
  });

  try {
    const tabId = await resolveCommandTabId(runtime, args);
    const before = await runtime.observe(tabId);
    const target = chooseTarget(before, args);
    if (!target) throw new Error(`follow_live_spike_label_not_found:${String(args.label || '')}`);

    const mappedAction = mapAgentAction(actionFor(args, target));
    const sampled = sampledBehavior({ baseline: null, mappedAction, target, rng: deterministicRng });
    const behavior = withTargetTrackingBehavior(sampled, 'follow-live');
    const context = {
      pointerStart: pointerStartFor(before, before.agentPointer || null),
      viewportCenter: pointerStartFor(before, null),
      rng: deterministicRng
    };
    const productionPlan = buildCdpPlan({ mappedAction, behavior, target, context });
    const plan = withTargetTrackingPlan(productionPlan, behavior, target);
    const delayMs = normalizedDelay(args.delay);

    if (delayMs) await sleep(delayMs);

    const execution = await runtime.executePlan({
      tabId,
      observationId: before.observationId,
      plan
    });
    const after = await runtime.observe(tabId);

    console.log(JSON.stringify({
      ok: execution?.ok === true,
      gate: 'moving-target-follow-live-visual',
      actionType: mappedAction.type,
      tabId: tabId ?? before.tabId ?? null,
      beforeObservationId: before.observationId,
      afterObservationId: after?.observationId || null,
      targetRef: target.ref,
      targetLabel: target.label,
      observedRect: target.rect,
      deliberatePreExecuteWaitMs: delayMs,
      behavior: {
        profile: behavior.profile,
        pointer: behavior.pointer,
        metadata: behavior.metadata
      },
      plan: {
        cdpPlanVersion: plan.cdpPlanVersion,
        actionType: plan.actionType,
        targetRef: plan.targetRef,
        targetTracking: plan.targetTracking,
        stepCount: Array.isArray(plan.steps) ? plan.steps.length : 0
      },
      execution,
      after: {
        title: after?.title || null,
        observationId: after?.observationId || null
      },
      result: 'VISUAL_CONFIRMATION_REQUIRED'
    }, null, 2));
  } finally {
    runtime.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({
      ok: false,
      gate: 'moving-target-follow-live-visual',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  ALLOWED_TYPES,
  normalizedDelay,
  deterministicRng,
  actionFor,
  main
};
