'use strict';

const fs = require('fs');
const path = require('path');
const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { executeBoundedEpisodeLoop } = require('../manager/agent/bounded_episode_loop.js');
const { createStrategy, createOfflineBaselineProvider } = require('../manager/strategy');
const {
  parseArgs,
  discoverRuntimeAgent,
  resolveCommandTabId
} = require('./agent_one_action.js');

function loadJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function makeTask(instruction, expectedTitle) {
  return {
    taskId: `offline-bounded-episode-${Date.now()}`,
    type: 'controlled-offline-strategy-bounded-episode',
    instruction,
    args: {},
    successCriteria: [
      { type: 'page', field: 'title', operator: 'equals', value: expectedTitle }
    ],
    constraints: {},
    metadata: { gate: 'offline-strategy-bounded-episode-loop' }
  };
}

async function runGate(options = {}) {
  const runtime = options.runtime;
  const instruction = String(options.instruction || '').trim();
  const expectedAction = String(options.expectedAction || '').trim();
  const expectedTitle = String(options.expectedTitle || '').trim();
  if (!runtime) throw new Error('runtime_required');
  if (!instruction) throw new Error('task_instruction_required');
  if (!expectedAction) throw new Error('expected_action_required');
  if (!expectedTitle) throw new Error('expected_title_required');

  const provider = createOfflineBaselineProvider({
    model: options.model,
    minimumConfidence: options.minimumConfidence ?? 0
  });
  const strategy = createStrategy({ provider });
  const task = makeTask(instruction, expectedTitle);

  const result = await executeBoundedEpisodeLoop({
    runtime,
    strategy,
    task,
    budgets: options.budgets || {
      maxSteps: 8,
      maxDurationMs: 120000,
      maxConsecutiveFailures: 2,
      maxReplans: 6,
      maxStalledSteps: 3
    },
    startedAtMs: Date.now() - 100
  });

  const errors = [];
  const first = result.steps[0] || null;
  if (!first) errors.push('no_action_executed');
  if (first?.outcome?.metadata?.progressBefore === 1) errors.push('task_already_satisfied_before_loop');
  if (first?.action?.type !== expectedAction) errors.push(`first_action:${first?.action?.type || '<missing>'}`);
  if (result?.finalOutcome?.taskSucceeded !== true) errors.push('final_goal_not_satisfied');
  if (result?.finalControl?.status !== 'done') errors.push(`final_control_status:${result?.finalControl?.status || '<missing>'}`);
  if (result?.finalBudget?.terminal !== true) errors.push('final_budget_not_terminal');
  if (result?.finalBudget?.reasonCode !== 'goal_satisfied') errors.push(`final_budget_reason:${result?.finalBudget?.reasonCode || '<missing>'}`);
  if (result?.invariant?.oneStrategyCallPerLoop !== true) errors.push('strategy_call_per_loop_invariant_failed');
  if (result?.invariant?.strategyCallsMatchExecutedActions !== true) errors.push('strategy_action_count_mismatch');
  if (result?.invariant?.noActionAfterTerminalBudget !== true) errors.push('action_after_terminal_budget');
  if (result?.invariant?.selectorUsedByStrategy !== false) errors.push('strategy_selector_boundary_failed');
  if (result?.invariant?.literalTrajectoryReplay !== false) errors.push('literal_trajectory_replay_boundary_failed');
  const finalAfter = result.steps.length ? result.steps[result.steps.length - 1].after : null;
  if (finalAfter?.title !== expectedTitle) errors.push(`after_title:${finalAfter?.title || '<missing>'}`);

  return {
    ok: errors.length === 0,
    result: errors.length === 0 ? 'PASS' : 'FAIL',
    gate: 'offline-strategy-bounded-episode-loop',
    task: instruction,
    provider: strategy.provider,
    steps: result.steps.map(step => ({
      stepIndex: step.stepIndex,
      action: step.action ? {
        type: step.action.type,
        targetRef: step.action.targetRef,
        intent: step.action.intent
      } : null,
      before: step.before ? {
        observationId: step.before.observationId || null,
        title: step.before.title || null,
        url: step.before.url || null
      } : null,
      after: step.after ? {
        observationId: step.after.observationId || null,
        title: step.after.title || null,
        url: step.after.url || null
      } : null,
      outcome: step.outcome,
      control: step.control,
      budget: step.budget
    })),
    finalOutcome: result.finalOutcome,
    finalControl: result.finalControl,
    finalBudget: result.finalBudget ? {
      status: result.finalBudget.status,
      terminal: result.finalBudget.terminal,
      shouldReplan: result.finalBudget.shouldReplan,
      reasonCode: result.finalBudget.reasonCode,
      usage: result.finalBudget.usage
    } : null,
    invariant: result.invariant,
    errors
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.model) throw new Error('--model is required');
  if (!args.task) throw new Error('--task is required');
  if (!args['expected-action']) throw new Error('--expected-action is required');
  if (!args['expected-title']) throw new Error('--expected-title is required');

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
    const gate = await runGate({
      runtime,
      model: loadJson(args.model),
      instruction: args.task,
      expectedAction: args['expected-action'],
      expectedTitle: args['expected-title'],
      minimumConfidence: args['minimum-confidence'] == null ? 0 : Number(args['minimum-confidence'])
    });
    console.log(JSON.stringify({ agentId, tabId, ...gate }, null, 2));
    if (!gate.ok) process.exitCode = 2;
  } finally {
    client.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({
      ok: false,
      result: 'FAIL',
      gate: 'offline-strategy-bounded-episode-loop',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = { loadJson, makeTask, runGate, main };
