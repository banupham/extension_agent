'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const harbor = require('./offline_strategy_fresh_long_harbor_gate.js');
const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { executeMissionWithStrategy } = require('../manager/mission/mission_strategy_executor.js');
const { createStrategy } = require('../manager/strategy');
const { createRecoveryExplorationProvider } = require('../manager/strategy/recovery_exploration_provider.js');
const { parseArgs, discoverRuntimeAgent } = require('./agent_one_action.js');
const {
  listen,
  closeServer,
  sha256File,
  activeAnchorTab
} = require('./offline_strategy_fresh_native_text_gate.js');

const HOST = '127.0.0.1';

async function waitForLab(client, tabId, expectedUrl, timeoutMs = 10000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const observation = await client.observe(tabId);
      if (String(observation?.url || '').startsWith(expectedUrl) && observation?.title === harbor.INITIAL_TITLE) return observation;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`harbor_diag_lab_not_ready:${lastError?.message || 'timeout'}`);
}

function stepSummary(step) {
  return {
    stepIndex: step?.stepIndex ?? null,
    actionType: step?.action?.type || null,
    targetLabel: harbor.targetLabel(step),
    decisionStatus: step?.decision?.status || null,
    decisionReasonCode: step?.decision?.reasonCode || null,
    prototypeSource: step?.decision?.metadata?.prototypeSource || null,
    controlStatus: step?.control?.status || null,
    controlReasonCode: step?.control?.reasonCode || null,
    effectStatus: step?.effect?.status || null,
    effectCodes: Array.isArray(step?.effect?.codes) ? [...step.effect.codes] : []
  };
}

function subgoalSummary(item) {
  const result = item?.result || {};
  return {
    subgoalId: item?.subgoalId || null,
    instruction: item?.instruction || null,
    status: item?.status || null,
    error: result?.error || null,
    finalOutcome: {
      taskSucceeded: result?.finalOutcome?.taskSucceeded === true,
      errorCode: result?.finalOutcome?.errorCode || null
    },
    finalControl: {
      status: result?.finalControl?.status || null,
      reasonCode: result?.finalControl?.reasonCode || null
    },
    finalBudget: {
      terminal: result?.finalBudget?.terminal === true,
      reasonCode: result?.finalBudget?.reasonCode || null
    },
    steps: Array.isArray(result?.steps) ? result.steps.map(stepSummary) : []
  };
}

async function run(options = {}) {
  const modelFile = path.resolve(String(options.modelFile || ''));
  if (!modelFile || !fs.existsSync(modelFile)) throw new Error(`model_file_missing:${modelFile}`);
  const model = JSON.parse(fs.readFileSync(modelFile, 'utf8'));
  const hashBefore = sha256File(modelFile);
  const transientText = `harbor-diag-${crypto.randomBytes(12).toString('hex')}`;
  const server = harbor.createLabServer();
  let client = null;
  let createdTabId = null;
  let tabClosed = false;

  try {
    const port = await listen(server);
    const labUrl = `http://${HOST}:${port}/`;
    const agentId = options.agentId || await discoverRuntimeAgent(options.healthBase || 'http://127.0.0.1:3000');
    client = createBrokerRuntimeClient({
      url: options.broker || 'ws://127.0.0.1:3000',
      agentId,
      timeoutMs: Number(options.timeoutMs || 10000)
    });

    const anchorTabId = await activeAnchorTab(client);
    const opened = await client.executeBrowserAction({
      tabId: anchorTabId,
      action: { browserActionVersion: '0.1.0', actionType: 'openNewTab', args: { url: labUrl } }
    });
    createdTabId = Number(opened?.tab?.tabId);
    if (!Number.isInteger(createdTabId) || createdTabId <= 0) throw new Error('harbor_diag_created_tab_missing');
    await waitForLab(client, createdTabId, labUrl, Number(options.timeoutMs || 10000));

    const runtime = {
      observe: () => client.observe(createdTabId),
      listTabs: scope => client.listTabs(scope),
      executePlan: payload => client.executePlan({ ...payload, tabId: createdTabId }),
      executeBrowserAction: payload => client.executeBrowserAction({ ...payload, tabId: createdTabId })
    };

    const baseStrategy = createStrategy({ modelFile, minimumConfidence: options.minimumConfidence ?? 0 });
    const recoveryProvider = createRecoveryExplorationProvider({ baseProvider: baseStrategy });
    const missionStrategy = createStrategy({ provider: recoveryProvider });
    const result = await executeMissionWithStrategy({
      plan: harbor.missionPlan(),
      runtime,
      strategy: missionStrategy,
      resolveSubgoalTask: harbor.resolveSubgoalTask,
      resolveTransientActionArgs: ({ action }) => action?.type === 'typeText' ? { text: transientText } : null,
      missionBudgets: {
        maxSubgoals: 3,
        maxDurationMs: 60000,
        stopOnSubgoalFailure: true
      },
      episodeBudgets: {
        maxSteps: 6,
        maxDurationMs: 20000,
        maxConsecutiveFailures: 3,
        maxReplans: 5,
        maxStalledSteps: 3
      }
    });

    const hashAfter = sha256File(modelFile);
    return {
      ok: result?.ok === true,
      diagnostic: 'harbor-native-subgoal-failure',
      modelVersion: model?.modelVersion || null,
      wrapperProviderVersion: baseStrategy?.provider?.version || null,
      modelLoadedFromFile: baseStrategy?.model?.loaded === true && baseStrategy?.model?.source === 'file',
      modelFileMutated: hashBefore !== hashAfter,
      modelHashBefore: hashBefore,
      modelHashAfter: hashAfter,
      missionReasonCode: result?.reasonCode || null,
      progress: result?.progress || null,
      subgoals: (result?.subgoalResults || []).map(subgoalSummary),
      createdTabClosed: false
    };
  } finally {
    if (client && Number.isInteger(createdTabId) && createdTabId > 0) {
      try {
        await client.executeBrowserAction({
          tabId: createdTabId,
          action: { browserActionVersion: '0.1.0', actionType: 'closeTab', args: {} }
        });
        tabClosed = true;
      } catch (_) {}
    }
    try { client?.close(); } catch (_) {}
    await closeServer(server);
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.model) throw new Error('--model is required');
  const output = await run({
    modelFile: args.model,
    agentId: args.agent || null,
    healthBase: args['health-base'] || 'http://127.0.0.1:3000',
    broker: args.broker || 'ws://127.0.0.1:3000',
    timeoutMs: Number(args.timeout || 10000),
    minimumConfidence: args['minimum-confidence'] == null ? 0 : Number(args['minimum-confidence'])
  });
  console.log(JSON.stringify(output, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({
      ok: false,
      diagnostic: 'harbor-native-subgoal-failure',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = { stepSummary, subgoalSummary, run, main };
