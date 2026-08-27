'use strict';

const fs = require('fs');
const path = require('path');
const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { executeBoundedEpisodeLoop } = require('../manager/agent/bounded_episode_loop.js');
const { createStrategy } = require('../manager/strategy/index.js');
const { createOfflineBaselineProvider } = require('../manager/strategy/offline_baseline_provider.js');
const {
  buildSuccessfulExperience,
  appendExperience,
  readExperienceMemory,
  createSelfExperienceProvider
} = require('../manager/strategy/self_experience_memory.js');
const { parseArgs, discoverRuntimeAgent, resolveCommandTabId } = require('./agent_one_action.js');
const { loadJson } = require('./offline_strategy_bounded_episode_loop_gate.js');

const EXPECTED_SEQUENCE = ['play', 'pause'];
const DEFAULT_MEMORY_FILE = path.join('training-collector', 'strategy-data', 'self-experience-v01', 'memory.jsonl');

function makeTask(instruction, expectedTitle) {
  return {
    taskId: `self-experience-${Date.now()}`,
    type: 'controlled-self-experience',
    instruction,
    args: {},
    successCriteria: [{ type: 'page', field: 'title', operator: 'equals', value: expectedTitle }],
    constraints: {},
    metadata: { gate: 'offline-strategy-self-experience' }
  };
}

function resultErrors(result, mode) {
  const errors = [];
  const actions = (result.steps || []).map(step => step?.action?.type || null);
  if (actions.join(',') !== EXPECTED_SEQUENCE.join(',')) errors.push(`action_sequence:${actions.join(',') || '<empty>'}`);
  if (result?.finalOutcome?.taskSucceeded !== true) errors.push('final_goal_not_satisfied');
  if (result?.finalControl?.status !== 'done') errors.push(`final_control:${result?.finalControl?.status || '<missing>'}`);
  if (result?.finalBudget?.terminal !== true) errors.push('final_budget_not_terminal');
  if (result?.finalBudget?.reasonCode !== 'goal_satisfied') errors.push(`final_budget:${result?.finalBudget?.reasonCode || '<missing>'}`);
  if (result?.invariant?.actionExecutionCount !== 2) errors.push(`action_execution_count:${result?.invariant?.actionExecutionCount}`);
  if (result?.invariant?.strategyCallCount !== 2) errors.push(`strategy_call_count:${result?.invariant?.strategyCallCount}`);
  if (result?.invariant?.noActionAfterTerminalBudget !== true) errors.push('action_after_terminal_budget');
  if (result?.invariant?.selectorUsedByStrategy !== false) errors.push('selector_boundary_failed');
  if (result?.invariant?.literalTrajectoryReplay !== false) errors.push('trajectory_replay_boundary_failed');

  const sources = (result.steps || []).map(step => step?.decision?.metadata?.prototypeSource || null);
  if (mode === 'learn' && sources.some(source => source !== 'taskComposition')) {
    errors.push(`learn_source:${sources.join(',')}`);
  }
  if (mode === 'recall' && sources.some(source => source !== 'selfExperience')) {
    errors.push(`recall_source:${sources.join(',')}`);
  }
  return { errors, actions, sources };
}

async function runGate(options = {}) {
  const runtime = options.runtime;
  if (!runtime) throw new Error('runtime_required');
  const mode = String(options.mode || 'learn').trim().toLowerCase();
  if (!['learn', 'recall'].includes(mode)) throw new Error('mode must be learn or recall');
  const instruction = String(options.instruction || 'Play the media, then pause it').trim();
  const expectedTitle = String(options.expectedTitle || 'PAUSE PASS').trim();
  const memoryFile = path.resolve(options.memoryFile || DEFAULT_MEMORY_FILE);

  if (options.resetMemory === true && fs.existsSync(memoryFile)) fs.rmSync(memoryFile, { force: true });

  const baseProvider = createOfflineBaselineProvider({
    model: options.model,
    minimumConfidence: options.minimumConfidence ?? 0
  });
  let provider = baseProvider;
  if (mode === 'recall') {
    const records = readExperienceMemory(memoryFile);
    if (!records.length) throw new Error(`self_experience_memory_empty:${memoryFile}`);
    provider = createSelfExperienceProvider({
      baseProvider,
      memoryFile,
      minimumSimilarity: options.minimumRecallSimilarity ?? 0.8
    });
  }

  const strategy = createStrategy({ provider });
  const task = makeTask(instruction, expectedTitle);
  const result = await executeBoundedEpisodeLoop({
    runtime,
    strategy,
    task,
    postActionSettle: options.postActionSettle,
    budgets: {
      maxSteps: 6,
      maxDurationMs: 120000,
      maxConsecutiveFailures: 2,
      maxReplans: 5,
      maxStalledSteps: 3
    },
    startedAtMs: Date.now() - 100
  });

  const checked = resultErrors(result, mode);
  let memoryWrite = null;
  let learnedExperience = null;
  if (!checked.errors.length && mode === 'learn') {
    learnedExperience = buildSuccessfulExperience({ task, result });
    memoryWrite = appendExperience(memoryFile, learnedExperience);
  }

  const finalErrors = [...checked.errors];
  if (mode === 'learn' && !memoryWrite) finalErrors.push('self_experience_not_written');

  return {
    ok: finalErrors.length === 0,
    result: finalErrors.length === 0 ? 'PASS' : 'FAIL',
    gate: 'offline-strategy-self-experience',
    mode,
    task: instruction,
    provider: strategy.provider,
    memoryFile,
    memoryWrite,
    learnedExperience: learnedExperience ? {
      experienceId: learnedExperience.experienceId,
      source: learnedExperience.source,
      sequence: learnedExperience.sequence.map(step => ({ type: step.type, targetLabel: step.targetLabel })),
      terminalReason: learnedExperience.terminal.reasonCode,
      verification: learnedExperience.verification
    } : null,
    steps: result.steps.map(step => ({
      stepIndex: step.stepIndex,
      action: step.action ? { type: step.action.type, targetRef: step.action.targetRef } : null,
      decisionSource: step?.decision?.metadata?.prototypeSource || null,
      reasonCode: step?.decision?.reasonCode || null,
      beforeTitle: step?.before?.title || null,
      afterTitle: step?.after?.title || null,
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
    expectedSequence: EXPECTED_SEQUENCE,
    actualSequence: checked.actions,
    decisionSources: checked.sources,
    errors: finalErrors
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.model) throw new Error('--model is required');
  const mode = String(args.mode || 'learn');
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
      mode,
      instruction: args.task || 'Play the media, then pause it',
      expectedTitle: args['expected-title'] || 'PAUSE PASS',
      memoryFile: args.memory || DEFAULT_MEMORY_FILE,
      resetMemory: args['reset-memory'] === true,
      minimumConfidence: args['minimum-confidence'] == null ? 0 : Number(args['minimum-confidence']),
      minimumRecallSimilarity: args['minimum-recall-similarity'] == null ? 0.8 : Number(args['minimum-recall-similarity'])
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
      gate: 'offline-strategy-self-experience',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED_SEQUENCE,
  DEFAULT_MEMORY_FILE,
  makeTask,
  resultErrors,
  runGate,
  main
};
