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
const {
  DEFAULT_RECOVERY_HALF_LIFE_MS,
  readRecoverySummaryMemory
} = require('../manager/strategy/recovery_memory_consolidation.js');
const { createAdaptiveRecoveryProvider } = require('../manager/strategy/adaptive_recovery_provider.js');
const { parseArgs, discoverRuntimeAgent, resolveCommandTabId } = require('./agent_one_action.js');

const DEFAULT_MEMORY_FILE = path.join('training-collector', 'strategy-data', 'recovery-self-learning-v01', 'memory.jsonl');
const DEFAULT_OUTCOME_MEMORY_FILE = path.join('training-collector', 'strategy-data', 'recovery-self-learning-v01', 'outcomes.jsonl');
const DEFAULT_OUTCOME_SUMMARY_FILE = path.join('training-collector', 'strategy-data', 'recovery-self-learning-v01', 'outcomes.summary.jsonl');
const LEARN_SEQUENCE = ['click', 'waitAndObserve', 'scrollVertical', 'click'];
const RECALL_SEQUENCE = ['click', 'scrollVertical', 'click'];
const RELEARN_SEQUENCE = ['click', 'scrollVertical', 'click'];
const ADAPT_DRIFT_SEQUENCE = ['click', 'scrollVertical', 'scrollHorizontal', 'click'];
const ADAPT_STABLE_SEQUENCE = ['click', 'scrollHorizontal', 'click'];

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

function settlePolicy() {
  return {
    pollMs: 80,
    minWindowMs: 320,
    maxWindowMs: 1000,
    stableSamples: 2
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

function hasHorizontalRootPolicy(records) {
  return (Array.isArray(records) ? records : []).some(record =>
    record?.trigger?.actionType === 'click' && record?.recovery?.type === 'scrollHorizontal'
  );
}

function hasOutcomeKnowledge(outcomes, summaries) {
  return (Array.isArray(outcomes) && outcomes.length > 0) || (Array.isArray(summaries) && summaries.length > 0);
}

async function runGate(options = {}) {
  if (!options.runtime) throw new Error('runtime_required');
  const mode = String(options.mode || 'learn').trim().toLowerCase();
  if (!['learn', 'recall', 'relearn', 'adapt'].includes(mode)) throw new Error('mode must be learn, recall, relearn, or adapt');
  const memoryFile = path.resolve(options.memoryFile || DEFAULT_MEMORY_FILE);
  const outcomeMemoryFile = path.resolve(options.outcomeMemoryFile || DEFAULT_OUTCOME_MEMORY_FILE);
  const outcomeSummaryFile = path.resolve(options.outcomeSummaryFile || `${outcomeMemoryFile}.summary.jsonl`);
  const outcomeHalfLifeMs = Number.isFinite(Number(options.outcomeHalfLifeMs)) && Number(options.outcomeHalfLifeMs) > 0
    ? Number(options.outcomeHalfLifeMs)
    : DEFAULT_RECOVERY_HALF_LIFE_MS;
  if (options.resetMemory === true) {
    if (fs.existsSync(memoryFile)) fs.rmSync(memoryFile, { force: true });
    if (fs.existsSync(outcomeMemoryFile)) fs.rmSync(outcomeMemoryFile, { force: true });
    if (fs.existsSync(outcomeSummaryFile)) fs.rmSync(outcomeSummaryFile, { force: true });
  }

  const task = makeTask(options.instruction);
  const baseProvider = createBaseProvider();
  let result;
  let adaptivePhase = null;

  if (mode === 'learn') {
    const provider = createRecoveryExplorationProvider({
      baseProvider,
      actionTypes: ['waitAndObserve', 'scrollVertical', 'scrollHorizontal'],
      outcomeMemoryFile,
      outcomeSummaryFile,
      outcomeHalfLifeMs
    });
    result = await executeRecoveryExplorationLearningEpisode({
      runtime: options.runtime,
      strategy: createStrategy({ provider }),
      task,
      recoveryMemoryFile: memoryFile,
      recoveryOutcomeMemoryFile: outcomeMemoryFile,
      recoveryOutcomeSummaryFile: outcomeSummaryFile,
      recoveryOutcomeHalfLifeMs: outcomeHalfLifeMs,
      budgets: budgets(),
      postActionSettle: settlePolicy()
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
  } else if (mode === 'relearn') {
    const outcomes = readRecoveryOutcomeMemory(outcomeMemoryFile);
    const summaries = readRecoverySummaryMemory(outcomeSummaryFile);
    if (!hasOutcomeKnowledge(outcomes, summaries)) throw new Error(`recovery_outcome_memory_empty:${outcomeMemoryFile}`);
    const provider = createRecoveryExplorationProvider({
      baseProvider,
      actionTypes: ['waitAndObserve', 'scrollVertical', 'scrollHorizontal'],
      outcomeMemoryFile,
      outcomeSummaryFile,
      outcomeHalfLifeMs
    });
    result = await executeBoundedEpisodeLoop({
      runtime: options.runtime,
      strategy: createStrategy({ provider }),
      task,
      budgets: budgets()
    });
  } else {
    const policyRecords = readRecoveryMemory(memoryFile);
    const outcomes = readRecoveryOutcomeMemory(outcomeMemoryFile);
    const summaries = readRecoverySummaryMemory(outcomeSummaryFile);
    if (!policyRecords.length) throw new Error(`recovery_memory_empty:${memoryFile}`);
    if (!hasOutcomeKnowledge(outcomes, summaries)) throw new Error(`recovery_outcome_memory_empty:${outcomeMemoryFile}`);
    adaptivePhase = hasHorizontalRootPolicy(policyRecords) ? 'stabilized' : 'drift-relearn';
    const explorationProvider = createRecoveryExplorationProvider({
      baseProvider,
      actionTypes: ['waitAndObserve', 'scrollVertical', 'scrollHorizontal'],
      outcomeMemoryFile,
      outcomeSummaryFile,
      outcomeHalfLifeMs
    });
    const provider = createAdaptiveRecoveryProvider({
      explorationProvider,
      policyMemoryFile: memoryFile,
      outcomeMemoryFile,
      outcomeSummaryFile,
      outcomeHalfLifeMs,
      minimumPolicyScore: options.minimumScore ?? 0.55,
      minimumOutcomeConfidence: options.minimumOutcomeConfidence ?? 0.55
    });
    result = await executeRecoveryExplorationLearningEpisode({
      runtime: options.runtime,
      strategy: createStrategy({ provider }),
      task,
      recoveryMemoryFile: memoryFile,
      recoveryOutcomeMemoryFile: outcomeMemoryFile,
      recoveryOutcomeSummaryFile: outcomeSummaryFile,
      recoveryOutcomeHalfLifeMs: outcomeHalfLifeMs,
      budgets: budgets(),
      postActionSettle: settlePolicy()
    });
  }

  const errors = commonErrors(result);
  const actualSequence = (result.steps || []).map(step => step?.action?.type || null);
  const expectedSequence = mode === 'learn'
    ? LEARN_SEQUENCE
    : mode === 'recall'
      ? RECALL_SEQUENCE
      : mode === 'relearn'
        ? RELEARN_SEQUENCE
        : adaptivePhase === 'stabilized'
          ? ADAPT_STABLE_SEQUENCE
          : ADAPT_DRIFT_SEQUENCE;
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
    if (!result?.recoveryMemoryMaintenance || result.recoveryMemoryMaintenance.consumedRaw !== true) errors.push('recovery_memory_not_consolidated');
  } else if (mode === 'recall') {
    if (sources[1] !== 'recoveryPolicy') errors.push(`recall_source:${sources[1] || '<missing>'}`);
  } else if (mode === 'relearn') {
    if (sources[1] !== 'recoveryExploration') errors.push(`relearn_source:${sources[1] || '<missing>'}`);
    const metadata = result?.steps?.[1]?.decision?.metadata || {};
    if (metadata.explorationActionType !== 'scrollVertical') errors.push(`relearn_action:${metadata.explorationActionType || '<missing>'}`);
    const candidateHistory = Array.isArray(metadata.candidateHistory) ? metadata.candidateHistory : [];
    const failedWait = candidateHistory.find(candidate => candidate?.type === 'waitAndObserve');
    if (!failedWait || failedWait.attempts < 1 || failedWait.failures < 1 || !(failedWait.confidence < 0.5)) {
      errors.push('relearn_negative_wait_history_missing');
    }
  } else if (adaptivePhase === 'drift-relearn') {
    if (sources[1] !== 'recoveryPolicy' || sources[2] !== 'recoveryExploration') {
      errors.push(`adapt_drift_sources:${sources.join(',')}`);
    }
    if (result?.steps?.[1]?.effect?.status !== 'no_effect') errors.push('stale_vertical_policy_not_failed');
    if (result?.steps?.[2]?.action?.type !== 'scrollHorizontal') errors.push('horizontal_recovery_not_discovered');
    if (result?.steps?.[2]?.decision?.metadata?.policyRejectedByOutcomeHistory !== true) {
      errors.push('stale_policy_not_rejected_online');
    }
    const learnedHorizontal = (result?.recoveryLearning?.records || []).some(record =>
      record?.trigger?.actionType === 'click' && record?.recovery?.type === 'scrollHorizontal'
    );
    if (!learnedHorizontal) errors.push('horizontal_policy_not_learned');
  } else {
    if (sources[1] !== 'recoveryPolicy') errors.push(`adapt_stable_source:${sources[1] || '<missing>'}`);
    if (result?.steps?.[1]?.action?.type !== 'scrollHorizontal') errors.push('stabilized_policy_not_horizontal');
    if (result?.steps?.[1]?.decision?.metadata?.policyRejectedByOutcomeHistory !== false) {
      errors.push('healthy_horizontal_policy_rejected');
    }
    if (result?.recoveryLearning?.newlyLearned !== false || result?.recoveryLearning?.reinforced !== true) {
      errors.push('stabilized_policy_reinforcement_semantics_invalid');
    }
  }

  return {
    ok: errors.length === 0,
    result: errors.length === 0 ? 'PASS' : 'FAIL',
    gate: 'offline-strategy-recovery-self-learning',
    mode,
    adaptivePhase,
    task: task.instruction,
    memoryFile,
    outcomeMemoryFile,
    outcomeSummaryFile,
    outcomeHalfLifeMs,
    actualSequence,
    expectedSequence,
    decisionSources: sources,
    recoveryLearning: result.recoveryLearning || null,
    recoveryOutcomeLearning: result.recoveryOutcomeLearning || null,
    recoveryMemoryMaintenance: result.recoveryMemoryMaintenance || null,
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
      historicalWeightedSuccessRate: step?.decision?.metadata?.historicalWeightedSuccessRate ?? null,
      historicalEffectiveEvidence: step?.decision?.metadata?.historicalEffectiveEvidence ?? null,
      policyOutcomeAttempts: step?.decision?.metadata?.policyOutcomeAttempts ?? null,
      policyOutcomeSuccesses: step?.decision?.metadata?.policyOutcomeSuccesses ?? null,
      policyOutcomeFailures: step?.decision?.metadata?.policyOutcomeFailures ?? null,
      policyOutcomeConfidence: step?.decision?.metadata?.policyOutcomeConfidence ?? null,
      policyOutcomeWeightedSuccessRate: step?.decision?.metadata?.policyOutcomeWeightedSuccessRate ?? null,
      policyOutcomeEffectiveEvidence: step?.decision?.metadata?.policyOutcomeEffectiveEvidence ?? null,
      policyOutcomeSummaryBacked: step?.decision?.metadata?.policyOutcomeSummaryBacked ?? null,
      policyRejectedByOutcomeHistory: step?.decision?.metadata?.policyRejectedByOutcomeHistory ?? null,
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
      outcomeSummaryFile: args['outcome-summary'] || DEFAULT_OUTCOME_SUMMARY_FILE,
      outcomeHalfLifeMs: args['outcome-half-life-ms'] == null ? DEFAULT_RECOVERY_HALF_LIFE_MS : Number(args['outcome-half-life-ms']),
      resetMemory: args['reset-memory'] === true,
      minimumScore: args['minimum-score'] == null ? 0.55 : Number(args['minimum-score']),
      minimumOutcomeConfidence: args['minimum-outcome-confidence'] == null ? 0.55 : Number(args['minimum-outcome-confidence'])
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
  DEFAULT_OUTCOME_SUMMARY_FILE,
  LEARN_SEQUENCE,
  RECALL_SEQUENCE,
  RELEARN_SEQUENCE,
  ADAPT_DRIFT_SEQUENCE,
  ADAPT_STABLE_SEQUENCE,
  makeTask,
  findVisible,
  createBaseProvider,
  budgets,
  settlePolicy,
  commonErrors,
  hasHorizontalRootPolicy,
  hasOutcomeKnowledge,
  runGate,
  main
};
