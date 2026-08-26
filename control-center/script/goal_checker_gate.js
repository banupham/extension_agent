'use strict';

const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { runOneAction } = require('../manager/agent/one_action_bridge.js');
const { evaluateGoal } = require('../manager/goal/goal_checker.js');
const {
  parseArgs,
  discoverRuntimeAgent,
  resolveCommandTabId,
  actionFromArgs
} = require('./agent_one_action.js');

function parseBoolean(value, fallback = null) {
  if (value == null) return fallback;
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(text)) return true;
  if (['false', '0', 'no'].includes(text)) return false;
  throw new Error(`invalid_boolean:${value}`);
}

function criteriaFromArgs(args) {
  const criteria = [];
  if (args['success-title'] != null) {
    criteria.push({ type: 'page', field: 'title', operator: 'equals', value: String(args['success-title']) });
  }
  if (args['success-title-includes'] != null) {
    criteria.push({ type: 'page', field: 'title', operator: 'includes', value: String(args['success-title-includes']) });
  }
  if (args['success-url'] != null) {
    criteria.push({ type: 'page', field: 'url', operator: 'equals', value: String(args['success-url']) });
  }
  if (args['success-url-includes'] != null) {
    criteria.push({ type: 'page', field: 'url', operator: 'includes', value: String(args['success-url-includes']) });
  }
  if (args['success-element-label'] != null) {
    criteria.push({
      type: 'element',
      match: { label: String(args['success-element-label']) },
      expect: { exists: true }
    });
  }
  if (!criteria.length) throw new Error('goal_checker_gate_success_criterion_required');
  return criteria;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const successCriteria = criteriaFromArgs(args);
  const expectedTaskSucceeded = parseBoolean(args['expect-task-succeeded'], true);
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
          source: 'a5.1-native-goal-checker-gate',
          action: built.action
        };
      }
    });

    const task = {
      taskId: `a5-native-${Date.now()}`,
      type: 'controlled-goal-check',
      instruction: 'Validate one semantic action outcome against explicit success criteria',
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

    const pass = outcome.actionSucceeded === true && outcome.taskSucceeded === expectedTaskSucceeded;
    console.log(JSON.stringify({
      ok: pass,
      gate: 'A5.1-goal-checker-native',
      result: pass ? 'PASS' : 'FAIL',
      expectedTaskSucceeded,
      agentId,
      tabId: tabId ?? step.before?.tabId ?? null,
      selectedTarget: selectedTarget ? {
        ref: selectedTarget.ref,
        tag: selectedTarget.tag,
        role: selectedTarget.role,
        label: selectedTarget.label
      } : null,
      action: step.mappedAction,
      execution: step.execution,
      beforePage: step.before ? { url: step.before.url || null, title: step.before.title || null } : null,
      afterPage: step.after ? { url: step.after.url || null, title: step.after.title || null } : null,
      successCriteria,
      outcome
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
      gate: 'A5.1-goal-checker-native',
      result: 'ERROR',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = { parseBoolean, criteriaFromArgs, main };
