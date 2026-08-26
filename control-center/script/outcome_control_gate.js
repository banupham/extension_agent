'use strict';

const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { runOneAction } = require('../manager/agent/one_action_bridge.js');
const { evaluateGoal } = require('../manager/goal/goal_checker.js');
const { reduceOutcomeToControl, CONTROL_STATUSES } = require('../manager/goal/outcome_controller.js');
const { criteriaFromArgs } = require('./goal_checker_gate.js');
const {
  parseArgs,
  discoverRuntimeAgent,
  resolveCommandTabId,
  actionFromArgs
} = require('./agent_one_action.js');

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const successCriteria = criteriaFromArgs(args);
  const expectedStatus = String(args['expect-status'] || '').trim();
  if (!CONTROL_STATUSES.has(expectedStatus)) throw new Error(`invalid_expect_status:${expectedStatus}`);

  const agentId = args.agent || await discoverRuntimeAgent(args['health-base'] || 'http://127.0.0.1:3000');
  const runtime = createBrokerRuntimeClient({
    url: args.broker || 'ws://127.0.0.1:3000',
    agentId,
    timeoutMs: Number(args.timeout || 10000)
  });

  try {
    const tabId = await resolveCommandTabId(runtime, args);
    let selectedTarget = null;
    const step = await runOneAction({
      runtime: {
        observe: () => runtime.observe(tabId),
        listTabs: scope => runtime.listTabs(scope),
        executePlan: payload => runtime.executePlan({ ...payload, tabId }),
        executeBrowserAction: payload => runtime.executeBrowserAction({ ...payload, tabId })
      },
      decide: async observation => {
        const built = actionFromArgs(observation, args);
        selectedTarget = built.selectedTarget;
        return {
          status: 'act',
          source: 'a5.2-native-outcome-control-gate',
          action: built.action
        };
      }
    });

    const task = {
      taskId: `a5-control-${Date.now()}`,
      type: 'controlled-outcome-control',
      instruction: 'Classify one semantic action outcome into a control status',
      successCriteria
    };

    const outcome = evaluateGoal({
      task,
      execution: step.execution,
      before: step.before,
      after: step.after,
      beforeBrowserContext: step.beforeBrowserContext,
      afterBrowserContext: step.afterBrowserContext
    });
    const control = reduceOutcomeToControl({ outcome });
    const firstEvidence = outcome.evidence?.[0] || null;
    const executionOk = step.execution?.ok === true;
    const statusMatched = control.status === expectedStatus;
    const evidenceMatched = expectedStatus === 'done'
      ? firstEvidence?.beforeMatched === false && firstEvidence?.afterMatched === true
      : expectedStatus === 'continue'
        ? firstEvidence?.afterMatched === false
        : true;
    const pass = executionOk && statusMatched && evidenceMatched;

    console.log(JSON.stringify({
      ok: pass,
      gate: 'A5.2-outcome-control-native',
      result: pass ? 'PASS' : 'FAIL',
      actionType: step.mappedAction?.type || null,
      targetLabel: selectedTarget?.label || null,
      executionOk,
      beforeMatched: firstEvidence?.beforeMatched ?? null,
      afterMatched: firstEvidence?.afterMatched ?? null,
      actionSucceeded: outcome.actionSucceeded,
      taskSucceeded: outcome.taskSucceeded,
      progress: outcome.progress,
      progressDelta: outcome.metadata?.progressDelta ?? 0,
      control: {
        status: control.status,
        terminal: control.terminal,
        shouldReplan: control.shouldReplan,
        reasonCode: control.reasonCode
      },
      expectedStatus
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
      gate: 'A5.2-outcome-control-native',
      result: 'ERROR',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = { main };
