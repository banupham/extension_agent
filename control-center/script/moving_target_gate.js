'use strict';

const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { mapAgentAction } = require('../manager/strategy/agent_action_contract.js');
const { sampledBehavior } = require('../manager/behavior/empirical_policy.js');
const { buildCdpPlan } = require('../manager/execution/cdp_plan.js');
const { pointerStartFor } = require('../manager/agent/one_action_bridge.js');
const {
  parseArgs,
  discoverRuntimeAgent,
  resolveCommandTabId,
  chooseTarget
} = require('./agent_one_action.js');

const ALLOWED_TYPES = new Set(['replaceText', 'clear', 'submit', 'hoverAndObserve']);
const EXPECTED_ERROR = 'target_geometry_changed';

const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0))));

function actionFor(args, target) {
  const type = String(args.type || '').trim();
  if (!ALLOWED_TYPES.has(type)) throw new Error('moving_target_gate_type_must_be_replaceText_clear_submit_or_hoverAndObserve');
  if (!target?.ref) throw new Error('moving_target_gate_target_required');
  const action = { type, targetRef: target.ref, args: {} };
  if (type === 'replaceText') action.args.text = String(args.text ?? 'NEW');
  return action;
}

function normalizedDelay(value) {
  const delay = Number(value ?? 350);
  if (!Number.isFinite(delay) || delay < 80 || delay > 1500) throw new Error('moving_target_gate_delay_must_be_80_to_1500_ms');
  return Math.round(delay);
}

function deterministicRng() {
  return 0.5;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
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
    if (!target) throw new Error(`moving_target_gate_label_not_found:${String(args.label || '')}`);

    const mappedAction = mapAgentAction(actionFor(args, target));
    const behavior = sampledBehavior({ baseline: null, mappedAction, target, rng: deterministicRng });
    const context = {
      pointerStart: pointerStartFor(before, before.agentPointer || null),
      viewportCenter: pointerStartFor(before, null),
      rng: deterministicRng
    };
    const plan = buildCdpPlan({ mappedAction, behavior, target, context });
    const delayMs = normalizedDelay(args.delay);

    await sleep(delayMs);

    let execution = null;
    let executionError = null;
    try {
      execution = await runtime.executePlan({
        tabId,
        observationId: before.observationId,
        plan
      });
    } catch (error) {
      executionError = String(error?.message || error);
    }

    const guardPassed = executionError != null && executionError.includes(EXPECTED_ERROR);
    const output = {
      ok: guardPassed,
      gate: 'moving-target-observation-binding',
      actionType: mappedAction.type,
      tabId: tabId ?? before.tabId ?? null,
      observationId: before.observationId,
      targetRef: target.ref,
      targetLabel: target.label,
      observedRect: target.rect,
      deliberatePreExecuteWaitMs: delayMs,
      expectedError: EXPECTED_ERROR,
      execution,
      executionError,
      result: guardPassed ? 'PASS' : 'FAIL'
    };
    console.log(JSON.stringify(output, null, 2));
    if (!guardPassed) process.exitCode = 2;
  } finally {
    runtime.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({ ok: false, gate: 'moving-target-observation-binding', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  ALLOWED_TYPES,
  EXPECTED_ERROR,
  actionFor,
  normalizedDelay,
  deterministicRng,
  main
};
