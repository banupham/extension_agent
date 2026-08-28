'use strict';

const fs = require('fs');
const path = require('path');
const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { executeBoundedTwoStep } = require('../manager/agent/bounded_two_step_execution.js');
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
    taskId: `offline-bounded-two-step-${Date.now()}`,
    type: 'controlled-offline-strategy-bounded-two-step',
    instruction,
    args: {},
    successCriteria: [
      { type: 'page', field: 'title', operator: 'equals', value: expectedTitle }
    ],
    constraints: {},
    metadata: { gate: 'offline-strategy-bounded-two-step' }
  };
}

async function runGate(options = {}) {
  const runtime = options.runtime;
  const instruction = String(options.instruction || '').trim();
  const expectedAction = String(options.expectedAction || '').trim();
  const expectedTitle = String(options.expectedTitle || '').trim();
  const firstTargetLabel = String(options.firstTargetLabel || 'Media Play').trim();
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

  const result = await executeBoundedTwoStep({
    runtime,
    task,
    strategy,
    firstDecide: async observation => {
      const target = chooseTarget(observation, { label: firstTargetLabel });
      if (!target) throw new Error(`first_target_not_found:${firstTargetLabel}`);
      return {
        status: 'act',
        source: 'offline-strategy-bounded-two-step-primer',
        action: { type: 'moveTo', targetRef: target.ref, args: {} }
      };
    },
    observeForReplan: () => runtime.observe(),
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
  if (result?.firstStep?.execution?.ok !== true) errors.push('primer_execution_failed');
  if (result?.firstControl?.outcome?.taskSucceeded !== false) errors.push('task_should_remain_unmet_after_primer');
  if (result?.firstControl?.control?.status !== 'continue') errors.push(`first_control_status:${result?.firstControl?.control?.status || '<missing>'}`);
  if (result?.firstControl?.budget?.shouldReplan !== true) errors.push('first_budget_did_not_request_replan');
  if (result?.firstControl?.replan?.strategyCallCount !== 1) errors.push(`strategy_call_count:${result?.firstControl?.replan?.strategyCallCount}`);
  if (result?.secondDecision?.status !== 'act') errors.push(`second_decision_status:${result?.secondDecision?.status || '<missing>'}`);
  if (result?.secondDecision?.action?.type !== expectedAction) errors.push(`second_decision_action:${result?.secondDecision?.action?.type || '<missing>'}`);
  if (!result?.secondStep) errors.push('second_action_not_executed');
  if (result?.secondStep?.execution?.ok !== true) errors.push('second_execution_failed');
  if (result?.secondStep?.mappedAction?.type !== expectedAction) errors.push(`second_action:${result?.secondStep?.mappedAction?.type || '<missing>'}`);
  if (result?.secondStep?.after?.title !== expectedTitle) errors.push(`after_title:${result?.secondStep?.after?.title || '<missing>'}`);
  if (result?.finalOutcome?.taskSucceeded !== true) errors.push('final_goal_not_satisfied');
  if (result?.finalControl?.status !== 'done') errors.push(`final_control_status:${result?.finalControl?.status || '<missing>'}`);
  if (result?.finalBudget?.terminal !== true) errors.push('final_budget_not_terminal');
  if (result?.finalBudget?.reasonCode !== 'goal_satisfied') errors.push(`final_budget_reason:${result?.finalBudget?.reasonCode || '<missing>'}`);
  if (result?.invariant?.actionExecutionCount !== 2) errors.push(`action_execution_count:${result?.invariant?.actionExecutionCount}`);
  if (result?.invariant?.atMostTwoActions !== true) errors.push('two_action_bound_failed');
  if (result?.invariant?.boundedStrategyCalls !== true) errors.push('strategy_call_bound_failed');
  if (result?.invariant?.secondActionExecutedOnlyFromReplan !== true) errors.push('second_action_source_failed');
  if (result?.invariant?.secondActionMatchesReplanDecision !== true) errors.push('second_action_mismatch');
  if (result?.invariant?.noThirdActionExecuted !== true) errors.push('third_action_executed');
  if (result?.invariant?.selectorUsedByStrategy !== false) errors.push('strategy_selector_boundary_failed');
  if (result?.invariant?.literalTrajectoryReplay !== false) errors.push('literal_trajectory_replay_boundary_failed');

  return {
    ok: errors.length === 0,
    result: errors.length === 0 ? 'PASS' : 'FAIL',
    gate: 'offline-strategy-bounded-two-step',
    task: instruction,
    provider: strategy.provider,
    primerAction: result?.firstStep?.mappedAction ? {
      type: result.firstStep.mappedAction.type,
      targetRef: result.firstStep.mappedAction.targetRef
    } : null,
    firstControl: result?.firstControl ? {
      outcome: result.firstControl.outcome,
      control: result.firstControl.control,
      budget: {
        status: result.firstControl.budget.status,
        terminal: result.firstControl.budget.terminal,
        shouldReplan: result.firstControl.budget.shouldReplan,
        reasonCode: result.firstControl.budget.reasonCode
      },
      replan: result.firstControl.replan
    } : null,
    secondAction: result?.secondStep?.mappedAction ? {
      type: result.secondStep.mappedAction.type,
      targetRef: result.secondStep.mappedAction.targetRef,
      intent: result.secondStep.mappedAction.intent
    } : null,
    afterSecond: result?.secondStep?.after ? {
      observationId: result.secondStep.after.observationId || null,
      title: result.secondStep.after.title || null,
      url: result.secondStep.after.url || null
    } : null,
    finalOutcome: result?.finalOutcome || null,
    finalControl: result?.finalControl || null,
    finalBudget: result?.finalBudget ? {
      status: result.finalBudget.status,
      terminal: result.finalBudget.terminal,
      shouldReplan: result.finalBudget.shouldReplan,
      reasonCode: result.finalBudget.reasonCode,
      usage: result.finalBudget.usage
    } : null,
    invariant: result?.invariant || null,
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
      gate: 'offline-strategy-bounded-two-step',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = { loadJson, makeTask, runGate, main };
