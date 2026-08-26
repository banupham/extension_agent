'use strict';

const fs = require('fs');
const path = require('path');
const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { runOneAction } = require('../manager/agent/one_action_bridge.js');
const { orchestrateOneStepReplan } = require('../manager/agent/one_step_replan.js');
const { createStrategy, createOfflineBaselineProvider } = require('../manager/strategy');
const {
  parseArgs,
  discoverRuntimeAgent,
  resolveCommandTabId,
  chooseTarget
} = require('./agent_one_action.js');

function loadJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function makeTask(instruction, expectedTitle) {
  return {
    taskId: `offline-replan-${Date.now()}`,
    type: 'controlled-offline-strategy-replan',
    instruction,
    args: {},
    successCriteria: [
      { type: 'page', field: 'title', operator: 'equals', value: expectedTitle }
    ],
    constraints: {},
    metadata: { gate: 'offline-strategy-one-step-replan' }
  };
}

async function runGate(options = {}) {
  const runtime = options.runtime;
  const model = options.model;
  const instruction = String(options.instruction || '').trim();
  const expectedAction = String(options.expectedAction || '').trim();
  const expectedTitle = String(options.expectedTitle || '').trim();
  const firstTargetLabel = String(options.firstTargetLabel || 'Media Play').trim();
  if (!runtime) throw new Error('runtime_required');
  if (!instruction) throw new Error('task_instruction_required');
  if (!expectedAction) throw new Error('expected_action_required');
  if (!expectedTitle) throw new Error('expected_title_required');

  const provider = createOfflineBaselineProvider({
    model,
    minimumConfidence: options.minimumConfidence ?? 0
  });
  const strategy = createStrategy({ provider });
  const task = makeTask(instruction, expectedTitle);

  const step = await runOneAction({
    runtime,
    decide: async observation => {
      const target = chooseTarget(observation, { label: firstTargetLabel });
      if (!target) throw new Error(`first_target_not_found:${firstTargetLabel}`);
      return {
        status: 'act',
        source: 'offline-strategy-replan-primer',
        action: { type: 'moveTo', targetRef: target.ref, args: {} }
      };
    }
  });

  const replanned = await orchestrateOneStepReplan({
    task,
    stepResult: step,
    strategy,
    observeForReplan: () => runtime.observe(),
    budgets: options.budgets || {
      maxSteps: 8,
      maxDurationMs: 120000,
      maxConsecutiveFailures: 2,
      maxReplans: 6,
      maxStalledSteps: 3
    },
    startedAtMs: Date.now() - 100,
    nowMs: Date.now()
  });

  const errors = [];
  if (step?.execution?.ok !== true) errors.push('primer_execution_failed');
  if (replanned?.outcome?.actionSucceeded !== true) errors.push('primer_action_not_successful');
  if (replanned?.outcome?.taskSucceeded !== false) errors.push('task_should_remain_unmet_after_primer');
  if (replanned?.control?.status !== 'continue') errors.push(`control_status:${replanned?.control?.status || '<missing>'}`);
  if (replanned?.budget?.terminal !== false) errors.push('budget_terminal_before_replan');
  if (replanned?.budget?.shouldReplan !== true) errors.push('budget_did_not_request_replan');
  if (replanned?.replan?.strategyCallCount !== 1) errors.push(`strategy_call_count:${replanned?.replan?.strategyCallCount}`);
  if (replanned?.replan?.decision?.status !== 'act') errors.push(`replan_status:${replanned?.replan?.decision?.status || '<missing>'}`);
  if (replanned?.replan?.decision?.action?.type !== expectedAction) {
    errors.push(`replan_action:${replanned?.replan?.decision?.action?.type || '<missing>'}`);
  }
  if (replanned?.invariant?.nextActionExecuted !== false) errors.push('replanned_action_must_not_execute');
  if (replanned?.invariant?.boundedStrategyCalls !== true) errors.push('strategy_call_bound_failed');
  if (replanned?.invariant?.returnedActDecisionUsesSemanticAgentAction !== true) errors.push('semantic_action_boundary_failed');
  if (replanned?.invariant?.goalCheckerChoseAction !== false) errors.push('goal_checker_chose_action');
  if (replanned?.invariant?.episodeBudgetCalledStrategy !== false) errors.push('episode_budget_called_strategy');

  return {
    ok: errors.length === 0,
    result: errors.length === 0 ? 'PASS' : 'FAIL',
    gate: 'offline-strategy-one-step-replan',
    task: instruction,
    provider: strategy.provider,
    primerAction: step?.mappedAction ? {
      type: step.mappedAction.type,
      targetRef: step.mappedAction.targetRef
    } : null,
    afterPrimer: step?.after ? {
      observationId: step.after.observationId || null,
      title: step.after.title || null,
      url: step.after.url || null
    } : null,
    outcome: replanned?.outcome || null,
    control: replanned?.control || null,
    budget: replanned?.budget ? {
      status: replanned.budget.status,
      terminal: replanned.budget.terminal,
      shouldReplan: replanned.budget.shouldReplan,
      reasonCode: replanned.budget.reasonCode
    } : null,
    replan: replanned?.replan ? {
      permitted: replanned.replan.permitted,
      attempted: replanned.replan.attempted,
      strategyCallCount: replanned.replan.strategyCallCount,
      observationSource: replanned.replan.observationSource,
      observationId: replanned.replan.observationId,
      decision: replanned.replan.decision,
      errorCode: replanned.replan.errorCode
    } : null,
    invariant: replanned?.invariant || null,
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
      firstTargetLabel: args['first-target-label'] || 'Media Play',
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
      gate: 'offline-strategy-one-step-replan',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = { loadJson, makeTask, runGate, main };
