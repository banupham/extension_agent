'use strict';

const fs = require('fs');
const path = require('path');
const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { executeBoundedEpisodeLoop } = require('../manager/agent/bounded_episode_loop.js');
const {
  executeRecoveryExplorationLearningEpisode
} = require('../manager/agent/recovery_exploration_learning.js');
const { createStrategy } = require('../manager/strategy/index.js');
const {
  createRecoveryExplorationProvider
} = require('../manager/strategy/recovery_exploration_provider.js');
const {
  createRecoveryPolicyProvider,
  readRecoveryMemory
} = require('../manager/strategy/recovery_policy_memory.js');
const { readRecoveryOutcomeMemory } = require('../manager/strategy/recovery_outcome_memory.js');
const { parseArgs, discoverRuntimeAgent, resolveCommandTabId } = require('./agent_one_action.js');

const DEFAULT_MEMORY_FILE = path.join('training-collector', 'strategy-data', 'recovery-self-learning-v01', 'memory.jsonl');
const DEFAULT_OUTCOME_MEMORY_FILE = path.join('training-collector', 'strategy-data', 'recovery-self-learning-v01', 'outcomes.jsonl');
const LEARN_SEQUENCE = ['click', 'waitAndObserve', 'scrollVertical', 'click'];
const RECALL_SEQUENCE = ['click', 'scrollVertical', 'click'];
const RELEARN_SEQUENCE = ['click', 'scrollVertical', 'click'];

function makeTask(instruction = 'Complete the recovery self-learning challenge') {
  return {
    taskId: `recovery-self-learning-${Date.now()}`,
    type: 'controlled-recovery-self-learning',
    instruction,
    args: {},
    successCriteria: [{ type: 'page', field: 'title', operator: 'equals', value: 'RECOVERY LEARNING PASS' }],
    constraints: {},
    metadata: { gate: 'offline-strategy-recovery-self-learning' }
  };
}

function findVisible(observation, label) {
  return (Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [])
    .find(element => String(element?.label || '').trim() === label && element.visible !== false && element.enabled !== false) || null;
}

function createBaseProvider() {
  return {
    name: 'recovery-native-base',
    version: '0.1.0',
    async decide({ observation, history = [] }) {
      if (!history.length) {
        const probe = findVisible(observation, 'Recovery Probe');
        if (!probe) return { status: 'blocked', confidence: 0, reasonCode: 'recovery_probe_missing', recovery: {}, metadata: { prototypeSource: 'base' } };
        return {
          status: 'act',
          action: { type: 'click', targetRef: probe.ref, args: {} },
          confidence: 0.5,
          reasonCode: 'probe_challenge',
          expectedOutcome: {},
          recovery: {},
          metadata: { prototypeSource: 'base' }
        };
      }

      const next = findVisible(observation, 'Recovery Continue');
      if (next) {
        return {
          status: 'act',
          action: { type: 'click', targetRef: next.ref, args: {} },
          confidence: 0.8,
          reasonCode: 'complete_revealed_control',
          expectedOutcome: {},
          recovery: {},
          metadata: { prototypeSource: 'base' }
        };
      }

      return {
        status: 'blocked',
        confidence: 0,
        reasonCode: 'base_has_no_recovery_mapping',
        recovery: {},
        metadata: { prototypeSource: 'base' }
      };
    }
  };
}

function budgets() {
  return {
    maxSteps: 8,
    maxDurationMs: 120000,
    maxConsecutiveFailures: 4,
    maxReplans: 7,
    maxStalledSteps: 4
  };
}

function commonErrors(result) {
  const errors = [];
  if (result?.finalOutcome?.taskSucceeded !== true) errors.push('final_goal_not_satisfied');
  if (result?.finalControl?.status !== 'done') errors.push(`final_control:${result?.finalControl?.status || '<missing>'}`);
  if (result?.finalBudget?.terminal !== true) errors.push('final_budget_not_terminal');
  if (result?.finalBudget?.reasonCode !== 'goal_satisfied') errors.push(`final_budget:${result?.finalBudget?.reasonCode || '<missing>'}`);
  if (result?.invariant?.oneStrategyCallPerLoop !== true) errors.push('strategy_call_per_loop_invariant_failed');
  if (result?.invariant?.strategyCallsMatchExecutedActions !== true) errors.push('strategy_action_count_mismatch');
  if (result?.invariant?.noActionAfterTerminalBudget !== true) errors.push('action_after_terminal_budget');
  if (result?.invariant?.selectorUsedByStrategy !== false) errors.push('selector_boundary_failed');
  return errors;
}

async function runGate(options = {}) {
  if (!options.runtime) throw new Error('runtime_required');
  const mode = String(options.mode || 'learn').trim().toLowerCase();
  if (!['learn', 'recall', 'relearn'].includes(mode)) throw new Error('mode must be learn, recall, or relearn');
  const memoryFile = path.resolve(options.memoryFile || DEFAULT_MEMORY_FILE);
  const outcomeMemoryFile = path.resolve(options.outcomeMemoryFile || DEFAULT_OUTCOME_MEMORY_FILE);
  if (options.resetMemory === true) {
    if (fs.existsSync(memoryFile)) fs.rmSync(memoryFile, { force: true });
    if (fs.existsSync(outcomeMemoryFile)) fs.rmSync(outcomeMemoryFile, { force: true });
  }

  const task = makeTask(options.instruction);
  const baseProvider = createBaseProvider();
  let result;

  if (mode === 'learn') {
    const provider = createRecoveryExplorationProvider({
      baseProvider,
      actionTypes: ['waitAndObserve', 'scrollVertical', 'scrollHorizontal'],
      outcomeMemoryFile
    });
    result = await executeRecoveryExplorationLearningEpisode({
      runtime: options.runtime,
      strategy: createStrategy({ provider }),
      task,
      recoveryMemoryFile: memoryFile,
      recoveryOutcomeMemoryFile: outcomeMemoryFile,
      budgets: budgets(),
      postActionSettle: {
        pollMs: 80,
        minWindowMs: 320,
        maxWindowMs: 1000,
        stableSamples: 2
      }
    });
  } else if (mode === 'recall') {
    const records = readRecoveryMemory(memoryFile);
    if (!records.length) throw new Error(`recovery_memory_empty:${memoryFile}`);
    const provider = createRecoveryPolicyProvider({
      baseProvider,
      memoryFile,
      minimumScore: options.minimumScore ?? 0.55
    });
    result = await executeBoundedEpisodeLoop({
      runtime: options.runtime,
      strategy: createStrategy({ provider }),
      task,
      budgets: budgets()
    });
  } else {
    const outcomes = readRecoveryOutcomeMemory(outcomeMemoryFile);
    if (!outcomes.length) throw new Error(`recovery_outcome_memory_empty:${outcomeMemoryFile}`);
    const provider = createRecoveryExplorationProvider({
      baseProvider,
      actionTypes: ['waitAndObserve', 'scrollVertical', 'scrollHorizontal'],
      outcomeMemoryFile
    });
    result = await executeBoundedEpisodeLoop({
      runtime: options.runtime,
      strategy: createStrategy({ provider }),
      task,
      budgets: budgets()
    });
  }

  const errors = commonErrors(result);
  const actualSequence = (result.steps || []).map(step => step?.action?.type || null);
  const expectedSequence = mode === 'learn' ? LEARN_SEQUENCE : (mode === 'recall' ? RECALL_SEQUENCE : RELEARN_SEQUENCE);
  if (JSON.stringify(actualSequence) !== JSON.stringify(expectedSequence)) {
    errors.push(`sequence:${actualSequence.join(',')}`);
  }

  const sources = (result.steps || []).map(step => step?.decision?.metadata?.prototypeSource || null);
  if (mode === 'learn') {
    if (sources[1] !== 'recoveryExploration' || sources[2] !== 'recoveryExploration') {
      errors.push(`learn_sources:${sources.join(',')}`);
    }
    if (result?.recoveryLearning?.learned !== true) errors.push('recovery_not_learned');
    const rootRecord = (result?.recoveryLearning?.records || []).find(record => record?.trigger?.actionType === 'click');
    if (!rootRecord || rootRecord?.recovery?.type !== 'scrollVertical') errors.push('root_recovery_not_credited_to_scroll');
    const outcomeRecords = result?.recoveryOutcomeLearning?.records || [];
    const waitOutcome = outcomeRecords.find(record => record?.recovery?.type === 'waitAndObserve');
    const scrollOutcome = outcomeRecords.find(record => record?.recovery?.type === 'scrollVertical');
    if (!waitOutcome || waitOutcome?.outcome?.usefulEffect !== false) errors.push('negative_wait_outcome_missing');
    if (!scrollOutcome || scrollOutcome?.outcome?.usefulEffect !== true) errors.push('positive_scroll_outcome_missing');
  } else if (mode === 'recall') {
    if (sources[1] !== 'recoveryPolicy') errors.push(`recall_source:${sources[1] || '<missing>'}`);
  } else {
    if (sources[1] !== 'recoveryExploration') errors.push(`relearn_source:${sources[1] || '<missing>'}`);
    const metadata = result?.steps?.[1]?.decision?.metadata || {};
    if (metadata.explorationActionType !== 'scrollVertical') errors.push(`relearn_action:${metadata.explorationActionType || '<missing>'}`);
    const candidateHistory = Array.isArray(metadata.candidateHistory) ? metadata.candidateHistory : [];
    const failedWait = candidateHistory.find(candidate => candidate?.type === 'waitAndObserve');
    if (!failedWait || failedWait.attempts < 1 || failedWait.failures < 1 || !(failedWait.confidence < 0.5)) {
      errors.push('relearn_negative_wait_history_missing');
    }
  }

  return {
    ok: errors.length === 0,
    result: errors.length === 0 ? 'PASS' : 'FAIL',
    gate: 'offline-strategy-recovery-self-learning',
    mode,
    task: task.instruction,
    memoryFile,
    outcomeMemoryFile,
    actualSequence,
    expectedSequence,
    decisionSources: sources,
    recoveryLearning: result.recoveryLearning || null,
    recoveryOutcomeLearning: result.recoveryOutcomeLearning || null,
    effects: (result.steps || []).map((step, index) => ({
      index,
      actionType: step?.action?.type || null,
      status: step?.effect?.status || null,
      codes: step?.effect?.codes || [],
      meaningfulCodes: step?.effect?.meaningfulCodes || [],
      incidentalCodes: step?.effect?.incidentalCodes || [],
      historicalAttempts: step?.decision?.metadata?.historicalAttempts ?? null,
      historicalSuccesses: step?.decision?.metadata?.historicalSuccesses ?? null,
      historicalFailures: step?.decision?.metadata?.historicalFailures ?? null,
      historicalConfidence: step?.decision?.metadata?.historicalConfidence ?? null,
      candidateHistory: step?.decision?.metadata?.candidateHistory || null
    })),
    finalOutcome: result.finalOutcome,
    finalControl: result.finalControl,
    finalBudget: result.finalBudget ? {
      status: result.finalBudget.status,
      terminal: result.finalBudget.terminal,
      reasonCode: result.finalBudget.reasonCode,
      usage: result.finalBudget.usage
    } : null,
    invariant: result.invariant,
    errors
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const agentId = args.agent || await discoverRuntimeAgent(args['health-base'] || 'http://127.0.0.1:3000');
  const client = createBrokerRuntimeClient({
    url: args.broker || 'ws://127.0.0.1:3000',
    agentId,
    timeoutMs: Number(args.timeout || 10000)
  });

  try {
    const tabId = await resolveCommandTabId(client, {
      ...args,
      'url-includes': args['url-includes'] || '127.0.0.1:8091/recovery'
    });
    const runtime = {
      observe: () => client.observe(tabId),
      listTabs: scope => client.listTabs(scope),
      executePlan: payload => client.executePlan({ ...payload, tabId }),
      executeBrowserAction: payload => client.executeBrowserAction({ ...payload, tabId })
    };
    const result = await runGate({
      runtime,
      mode: args.mode || 'learn',
      instruction: args.task || 'Complete the recovery self-learning challenge',
      memoryFile: args.memory || DEFAULT_MEMORY_FILE,
      outcomeMemoryFile: args['outcome-memory'] || DEFAULT_OUTCOME_MEMORY_FILE,
      resetMemory: args['reset-memory'] === true,
      minimumScore: args['minimum-score'] == null ? 0.55 : Number(args['minimum-score'])
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
      gate: 'offline-strategy-recovery-self-learning',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_MEMORY_FILE,
  DEFAULT_OUTCOME_MEMORY_FILE,
  LEARN_SEQUENCE,
  RECALL_SEQUENCE,
  RELEARN_SEQUENCE,
  makeTask,
  findVisible,
  createBaseProvider,
  budgets,
  commonErrors,
  runGate,
  main
};
