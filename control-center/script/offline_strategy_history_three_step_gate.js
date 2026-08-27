'use strict';

const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { parseArgs, discoverRuntimeAgent, resolveCommandTabId } = require('./agent_one_action.js');
const { loadJson, runGate: runBoundedGate } = require('./offline_strategy_bounded_episode_loop_gate.js');

const EXPECTED_SEQUENCE = ['play', 'mute', 'unmute'];

async function runGate(options = {}) {
  const base = await runBoundedGate({
    ...options,
    expectedAction: 'play',
    expectedTitle: options.expectedTitle || 'UNMUTE PASS'
  });

  const actions = (base.steps || []).map(step => step?.action?.type || null);
  const errors = [...(base.errors || [])];
  if (actions.length !== EXPECTED_SEQUENCE.length) errors.push(`action_count:${actions.length}`);
  if (actions.join(',') !== EXPECTED_SEQUENCE.join(',')) errors.push(`action_sequence:${actions.join(',') || '<empty>'}`);
  if (base.steps?.[0]?.outcome?.taskSucceeded !== false) errors.push('step0_should_not_finish_task');
  if (base.steps?.[0]?.control?.status !== 'continue') errors.push(`step0_control:${base.steps?.[0]?.control?.status || '<missing>'}`);
  if (base.steps?.[1]?.outcome?.taskSucceeded !== false) errors.push('step1_should_not_finish_task');
  if (base.steps?.[1]?.control?.status !== 'continue') errors.push(`step1_control:${base.steps?.[1]?.control?.status || '<missing>'}`);
  if (base.steps?.[2]?.outcome?.taskSucceeded !== true) errors.push('step2_should_finish_task');
  if (base.finalControl?.status !== 'done') errors.push(`final_control:${base.finalControl?.status || '<missing>'}`);
  if (base.finalBudget?.reasonCode !== 'goal_satisfied') errors.push(`final_budget:${base.finalBudget?.reasonCode || '<missing>'}`);
  if (base.invariant?.actionExecutionCount !== 3) errors.push(`action_execution_count:${base.invariant?.actionExecutionCount}`);
  if (base.invariant?.strategyCallCount !== 3) errors.push(`strategy_call_count:${base.invariant?.strategyCallCount}`);

  return {
    ...base,
    ok: errors.length === 0,
    result: errors.length === 0 ? 'PASS' : 'FAIL',
    gate: 'offline-strategy-history-three-step',
    expectedSequence: EXPECTED_SEQUENCE,
    actualSequence: actions,
    errors
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.model) throw new Error('--model is required');
  if (!args.task) throw new Error('--task is required');

  const agentId = args.agent || await discoverRuntimeAgent(args['health-base'] || 'http://127.0.0.1:3000');
  const client = createBrokerRuntimeClient({
    url: args.broker || 'ws://127.0.0.1:3000',
    agentId,
    timeoutMs: Number(args.timeout || 10000)
  });

  try {
    const tabId = await resolveCommandTabId(client, {
      ...args,
      'url-includes': args['url-includes'] || '127.0.0.1:8091'
    });
    const runtime = {
      observe: () => client.observe(tabId),
      listTabs: scope => client.listTabs(scope),
      executePlan: payload => client.executePlan({ ...payload, tabId }),
      executeBrowserAction: payload => client.executeBrowserAction({ ...payload, tabId })
    };
    const result = await runGate({
      runtime,
      model: loadJson(args.model),
      instruction: args.task,
      expectedTitle: args['expected-title'] || 'UNMUTE PASS',
      minimumConfidence: args['minimum-confidence'] == null ? 0 : Number(args['minimum-confidence'])
    });
    console.log(JSON.stringify({ agentId, tabId, ...result }, null, 2));
    if (!result.ok) process.exitCode = 2;
  } finally {
    client.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({
      ok: false,
      result: 'FAIL',
      gate: 'offline-strategy-history-three-step',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = { EXPECTED_SEQUENCE, runGate, main };
