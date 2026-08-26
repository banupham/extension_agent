'use strict';

const fs = require('fs');
const path = require('path');
const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { runOneAction } = require('../manager/agent/one_action_bridge.js');
const { createStrategy, createOfflineBaselineProvider } = require('../manager/strategy');

function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) { out[key] = next; i += 1; }
    else out[key] = true;
  }
  return out;
}

async function discoverRuntimeAgent(healthBase = 'http://127.0.0.1:3000') {
  const response = await fetch(`${healthBase}/agents`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`broker_agents_http_${response.status}`);
  const body = await response.json();
  const agents = (Array.isArray(body?.agents) ? body.agents : [])
    .filter(agent => agent?.meta?.product === 'agent-runtime');
  if (agents.length === 1) return agents[0].agentId;
  if (!agents.length) throw new Error('no_agent_runtime_connected');
  throw new Error(`multiple_agent_runtimes_connected:${agents.map(x => x.agentId).join(',')}`);
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

async function resolveTabId(runtime, urlIncludes) {
  const tabs = await runtime.listTabs({ mode: 'matching', urlIncludes });
  if (tabs.length === 1) return Number(tabs[0].tabId);
  if (!tabs.length) throw new Error(`target_tab_not_found:${urlIncludes}`);
  const active = tabs.filter(tab => tab?.active === true);
  if (active.length === 1) return Number(active[0].tabId);
  throw new Error(`target_tab_ambiguous:${tabs.map(tab => `${tab.tabId}:${tab.title || tab.url || ''}`).join('|')}`);
}

function makeTask(instruction) {
  return {
    taskId: `offline-native-${Date.now()}`,
    type: 'controlled-browser-action',
    instruction,
    args: {},
    successCriteria: [],
    constraints: {},
    metadata: { gate: 'offline-strategy-native-one-action' }
  };
}

async function runGate(options) {
  const runtime = options.runtime;
  const model = options.model;
  const instruction = String(options.instruction || '').trim();
  if (!instruction) throw new Error('task_instruction_required');
  if (!runtime) throw new Error('runtime_required');

  const provider = createOfflineBaselineProvider({
    model,
    minimumConfidence: options.minimumConfidence ?? 0
  });
  const strategy = createStrategy({ provider });
  const task = makeTask(instruction);

  const result = await runOneAction({
    runtime,
    decide: observation => strategy.decide({ task, observation, history: [] })
  });

  const expectedAction = options.expectedAction ? String(options.expectedAction) : null;
  const expectedTitle = options.expectedTitle ? String(options.expectedTitle) : null;
  const errors = [];
  if (result?.decision?.status !== 'act') errors.push(`decision_status:${result?.decision?.status || '<missing>'}`);
  if (expectedAction && result?.mappedAction?.type !== expectedAction) {
    errors.push(`action_type:${result?.mappedAction?.type || '<missing>'}`);
  }
  if (expectedTitle && result?.after?.title !== expectedTitle) {
    errors.push(`after_title:${result?.after?.title || '<missing>'}`);
  }
  if (result?.invariant?.oneActionOnly !== true) errors.push('one_action_only_invariant_failed');
  if (result?.invariant?.actionExecuted !== true) errors.push('action_not_executed');
  if (result?.invariant?.reObservedAfterExecution !== true) errors.push('after_observation_missing');
  if (result?.invariant?.selectorUsedByStrategy !== false) errors.push('strategy_selector_boundary_failed');
  if (result?.invariant?.literalTrajectoryReplay !== false) errors.push('literal_trajectory_replay_boundary_failed');

  return {
    ok: errors.length === 0,
    result: errors.length === 0 ? 'PASS' : 'FAIL',
    gate: 'offline-strategy-native-one-action',
    task: instruction,
    provider: strategy.provider,
    decision: {
      status: result?.decision?.status || null,
      confidence: result?.decision?.confidence ?? null,
      reasonCode: result?.decision?.reasonCode || null,
      metadata: result?.decision?.metadata || {}
    },
    action: result?.mappedAction ? {
      type: result.mappedAction.type,
      targetRef: result.mappedAction.targetRef,
      intent: result.mappedAction.intent
    } : null,
    before: {
      observationId: result?.beforeObservationId || null,
      title: result?.before?.title || null,
      url: result?.before?.url || null
    },
    after: {
      observationId: result?.afterObservationId || null,
      title: result?.after?.title || null,
      url: result?.after?.url || null
    },
    invariant: result?.invariant || null,
    errors
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.model) throw new Error('--model is required');
  if (!args.task) throw new Error('--task is required');
  const urlIncludes = String(args['url-includes'] || '127.0.0.1:8091');
  const agentId = args.agent || await discoverRuntimeAgent(args['health-base'] || 'http://127.0.0.1:3000');
  const client = createBrokerRuntimeClient({
    url: args.broker || 'ws://127.0.0.1:3000',
    agentId,
    timeoutMs: Number(args.timeout || 10000)
  });

  try {
    const tabId = await resolveTabId(client, urlIncludes);
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
      minimumConfidence: args['minimum-confidence'] == null ? 0 : Number(args['minimum-confidence']),
      expectedAction: args['expected-action'],
      expectedTitle: args['expected-title']
    });
    console.log(JSON.stringify({ agentId, tabId, ...gate }, null, 2));
    if (!gate.ok) process.exitCode = 2;
  } finally {
    client.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', gate: 'offline-strategy-native-one-action', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  discoverRuntimeAgent,
  loadJson,
  resolveTabId,
  makeTask,
  runGate
};
