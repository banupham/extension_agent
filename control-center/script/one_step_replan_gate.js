'use strict';

const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { runOneAction } = require('../manager/agent/one_action_bridge.js');
const { orchestrateOneStepReplan } = require('../manager/agent/one_step_replan.js');
const {
  parseArgs,
  discoverRuntimeAgent,
  resolveCommandTabId,
  chooseTarget
} = require('./agent_one_action.js');

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const agentId = args.agent || await discoverRuntimeAgent(args['health-base'] || 'http://127.0.0.1:3000');
  const runtime = createBrokerRuntimeClient({
    url: args.broker || 'ws://127.0.0.1:3000',
    agentId,
    timeoutMs: Number(args.timeout || 10000)
  });

  try {
    const tabId = await resolveCommandTabId(runtime, {
      ...args,
      'url-includes': args['url-includes'] || '127.0.0.1:8091'
    });

    const step = await runOneAction({
      runtime: {
        observe: () => runtime.observe(tabId),
        listTabs: scope => runtime.listTabs(scope),
        executePlan: payload => runtime.executePlan({ ...payload, tabId }),
        executeBrowserAction: payload => runtime.executeBrowserAction({ ...payload, tabId })
      },
      decide: async observation => {
        const target = chooseTarget(observation, { label: args.label || 'Submit Target' });
        if (!target) throw new Error('a5_4_submit_target_not_found');
        return {
          status: 'act',
          source: 'a5.4-native-first-step',
          action: {
            type: 'moveTo',
            targetRef: target.ref,
            args: {}
          }
        };
      }
    });

    let strategyCalls = 0;
    const strategy = {
      async decide({ observation }) {
        strategyCalls += 1;
        const target = chooseTarget(observation, { label: args.label || 'Submit Target' });
        if (!target) {
          return { status: 'failed', reasonCode: 'submit_target_missing_after_reobserve' };
        }
        return {
          status: 'act',
          reasonCode: 'goal_unmet_choose_submit',
          action: {
            type: 'submit',
            targetRef: target.ref,
            args: {}
          }
        };
      }
    };

    const task = {
      taskId: `a5-4-native-${Date.now()}`,
      type: 'controlled-one-step-replan',
      instruction: 'Reach SUBMIT PASS using bounded one-step replan',
      successCriteria: [
        { type: 'page', field: 'title', operator: 'equals', value: 'SUBMIT PASS' }
      ]
    };

    const result = await orchestrateOneStepReplan({
      task,
      stepResult: step,
      strategy,
      observeForReplan: () => runtime.observe(tabId),
      budgets: {
        maxSteps: 8,
        maxDurationMs: 120000,
        maxConsecutiveFailures: 2,
        maxReplans: 6,
        maxStalledSteps: 3
      },
      startedAtMs: Date.now() - 100,
      nowMs: Date.now()
    });

    const pass = (
      step.execution?.ok === true &&
      result.outcome.actionSucceeded === true &&
      result.outcome.taskSucceeded === false &&
      result.control.status === 'continue' &&
      result.budget.terminal === false &&
      result.budget.shouldReplan === true &&
      result.replan.permitted === true &&
      result.replan.strategyCallCount === 1 &&
      strategyCalls === 1 &&
      result.replan.decision?.status === 'act' &&
      result.replan.decision?.action?.type === 'submit' &&
      result.invariant?.nextActionExecuted === false &&
      result.invariant?.boundedStrategyCalls === true
    );

    console.log(JSON.stringify({
      ok: pass,
      gate: 'A5.4-explicit-one-step-replan-native',
      result: pass ? 'PASS' : 'FAIL',
      agentId,
      tabId: tabId ?? step.before?.tabId ?? null,
      firstAction: step.mappedAction,
      firstExecution: step.execution,
      beforePage: step.before ? { url: step.before.url || null, title: step.before.title || null } : null,
      afterPage: step.after ? { url: step.after.url || null, title: step.after.title || null } : null,
      outcome: result.outcome,
      control: result.control,
      budget: {
        status: result.budget.status,
        terminal: result.budget.terminal,
        shouldReplan: result.budget.shouldReplan,
        reasonCode: result.budget.reasonCode,
        usage: result.budget.usage
      },
      replan: result.replan,
      invariant: result.invariant
    }, null, 2));

    if (!pass) process.exitCode = 1;
  } finally {
    runtime.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({
      ok: false,
      gate: 'A5.4-explicit-one-step-replan-native',
      result: 'ERROR',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = { main };
