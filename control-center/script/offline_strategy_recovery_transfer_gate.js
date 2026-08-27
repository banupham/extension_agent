'use strict';

const path = require('path');
const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { executeBoundedEpisodeLoop } = require('../manager/agent/bounded_episode_loop.js');
const { createStrategy } = require('../manager/strategy/index.js');
const { createRecoveryTransferProvider } = require('../manager/strategy/recovery_transfer_provider.js');
const { parseArgs, discoverRuntimeAgent, resolveCommandTabId } = require('./agent_one_action.js');

const DEFAULT_MEMORY_FILE = path.join('training-collector', 'strategy-data', 'recovery-self-learning-v01', 'memory.jsonl');
const DEFAULT_OUTCOME_MEMORY_FILE = path.join('training-collector', 'strategy-data', 'recovery-self-learning-v01', 'outcomes.jsonl');
const DEFAULT_SUMMARY_FILE = path.join('training-collector', 'strategy-data', 'recovery-self-learning-v01', 'outcomes.summary.jsonl');
const EXPECTED_SEQUENCE = ['click', 'scrollHorizontal', 'click'];

function makeTask(instruction = 'Advance a different concealed interface') {
  return {
    taskId: `recovery-transfer-${Date.now()}`,
    type: 'controlled-generalized-recovery-transfer',
    instruction,
    args: {},
    successCriteria: [{ type: 'page', field: 'title', operator: 'equals', value: 'RECOVERY TRANSFER PASS' }],
    constraints: {},
    metadata: { gate: 'offline-strategy-recovery-transfer' }
  };
}

function findVisible(observation, label) {
  return (Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [])
    .find(element => String(element?.label || '').trim() === label && element.visible !== false && element.enabled !== false) || null;
}

function createTransferBaseProvider() {
  return {
    name: 'recovery-transfer-base',
    version: '0.1.0',
    async decide({ observation, history = [] }) {
      if (!history.length) {
        const probe = findVisible(observation, 'Transfer Probe');
        if (!probe) {
          return { status: 'blocked', confidence: 0, reasonCode: 'transfer_probe_missing', recovery: {}, metadata: { prototypeSource: 'base' } };
        }
        return {
          status: 'act',
          action: { type: 'click', targetRef: probe.ref, args: {} },
          confidence: 0.5,
          reasonCode: 'probe_transfer_challenge',
          expectedOutcome: {},
          recovery: {},
          metadata: { prototypeSource: 'base' }
        };
      }

      const next = findVisible(observation, 'Transfer Continue');
      if (next) {
        return {
          status: 'act',
          action: { type: 'click', targetRef: next.ref, args: {} },
          confidence: 0.8,
          reasonCode: 'complete_transfer_control',
          expectedOutcome: {},
          recovery: {},
          metadata: { prototypeSource: 'base' }
        };
      }

      return {
        status: 'blocked',
        confidence: 0,
        reasonCode: 'base_has_no_transfer_recovery',
        recovery: {},
        metadata: { prototypeSource: 'base' }
      };
    }
  };
}

function budgets() {
  return {
    maxSteps: 6,
    maxDurationMs: 120000,
    maxConsecutiveFailures: 3,
    maxReplans: 5,
    maxStalledSteps: 3
  };
}

async function runGate(options = {}) {
  if (!options.runtime) throw new Error('runtime_required');
  const task = makeTask(options.instruction);
  const provider = createRecoveryTransferProvider({
    fallbackProvider: createTransferBaseProvider(),
    policyMemoryFile: path.resolve(options.memoryFile || DEFAULT_MEMORY_FILE),
    rawMemoryFile: path.resolve(options.outcomeMemoryFile || DEFAULT_OUTCOME_MEMORY_FILE),
    summaryMemoryFile: path.resolve(options.summaryFile || DEFAULT_SUMMARY_FILE),
    minimumTransferScore: options.minimumTransferScore ?? 0.70,
    minimumSourceConfidence: options.minimumSourceConfidence ?? 0.55,
    minimumEffectiveEvidence: options.minimumEffectiveEvidence ?? 0.5
  });

  const result = await executeBoundedEpisodeLoop({
    runtime: options.runtime,
    strategy: createStrategy({ provider }),
    task,
    budgets: budgets(),
    postActionSettle: {
      pollMs: 80,
      minWindowMs: 320,
      maxWindowMs: 1000,
      stableSamples: 2
    }
  });

  const actualSequence = (result.steps || []).map(step => step?.action?.type || null);
  const decisionSources = (result.steps || []).map(step => step?.decision?.metadata?.prototypeSource || null);
  const transferMetadata = result?.steps?.[1]?.decision?.metadata || {};
  const errors = [];
  if (JSON.stringify(actualSequence) !== JSON.stringify(EXPECTED_SEQUENCE)) errors.push(`sequence:${actualSequence.join(',')}`);
  if (JSON.stringify(decisionSources) !== JSON.stringify(['base', 'recoveryTransfer', 'base'])) {
    errors.push(`sources:${decisionSources.join(',')}`);
  }
  if (transferMetadata.crossTaskTransfer !== true) errors.push('cross_task_transfer_not_proven');
  if (!(Number(transferMetadata.sourceTaskSimilarity) < 0.55)) errors.push('source_task_similarity_not_low');
  if (transferMetadata.sourceSummaryBacked !== true) errors.push('source_summary_not_used');
  if (!(Number(transferMetadata.sourceOutcomeConfidence) >= 0.55)) errors.push('source_confidence_too_low');
  if (result?.finalOutcome?.taskSucceeded !== true) errors.push('final_goal_not_satisfied');
  if (result?.finalControl?.status !== 'done') errors.push(`final_control:${result?.finalControl?.status || '<missing>'}`);
  if (result?.finalBudget?.reasonCode !== 'goal_satisfied') errors.push(`final_budget:${result?.finalBudget?.reasonCode || '<missing>'}`);
  if (result?.invariant?.oneStrategyCallPerLoop !== true) errors.push('strategy_call_per_loop_invariant_failed');
  if (result?.invariant?.strategyCallsMatchExecutedActions !== true) errors.push('strategy_action_count_mismatch');
  if (result?.invariant?.noActionAfterTerminalBudget !== true) errors.push('action_after_terminal_budget');
  if (result?.invariant?.selectorUsedByStrategy !== false) errors.push('selector_boundary_failed');

  return {
    ok: errors.length === 0,
    result: errors.length === 0 ? 'PASS' : 'FAIL',
    gate: 'offline-strategy-recovery-transfer',
    task: task.instruction,
    actualSequence,
    expectedSequence: EXPECTED_SEQUENCE,
    decisionSources,
    transfer: {
      sourceRecoveryId: transferMetadata.sourceRecoveryId || null,
      recoveryType: transferMetadata.recoveryType || null,
      transferScore: transferMetadata.transferScore ?? null,
      structuralTriggerScore: transferMetadata.structuralTriggerScore ?? null,
      sourceTaskSimilarity: transferMetadata.sourceTaskSimilarity ?? null,
      triggerTargetSimilarity: transferMetadata.triggerTargetSimilarity ?? null,
      sourceOutcomeAttempts: transferMetadata.sourceOutcomeAttempts ?? null,
      sourceOutcomeSuccesses: transferMetadata.sourceOutcomeSuccesses ?? null,
      sourceOutcomeFailures: transferMetadata.sourceOutcomeFailures ?? null,
      sourceOutcomeConfidence: transferMetadata.sourceOutcomeConfidence ?? null,
      sourceEffectiveEvidence: transferMetadata.sourceEffectiveEvidence ?? null,
      sourceSummaryBacked: transferMetadata.sourceSummaryBacked ?? null,
      crossTaskTransfer: transferMetadata.crossTaskTransfer ?? null
    },
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
      'url-includes': args['url-includes'] || '127.0.0.1:8091/recovery-transfer?variant=horizontal'
    });
    const runtime = {
      observe: () => client.observe(tabId),
      listTabs: scope => client.listTabs(scope),
      executePlan: payload => client.executePlan({ ...payload, tabId }),
      executeBrowserAction: payload => client.executeBrowserAction({ ...payload, tabId })
    };
    const result = await runGate({
      runtime,
      instruction: args.task || 'Advance a different concealed interface',
      memoryFile: args.memory || DEFAULT_MEMORY_FILE,
      outcomeMemoryFile: args['outcome-memory'] || DEFAULT_OUTCOME_MEMORY_FILE,
      summaryFile: args['summary-memory'] || DEFAULT_SUMMARY_FILE,
      minimumTransferScore: args['minimum-transfer-score'] == null ? 0.70 : Number(args['minimum-transfer-score']),
      minimumSourceConfidence: args['minimum-source-confidence'] == null ? 0.55 : Number(args['minimum-source-confidence']),
      minimumEffectiveEvidence: args['minimum-effective-evidence'] == null ? 0.5 : Number(args['minimum-effective-evidence'])
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
      gate: 'offline-strategy-recovery-transfer',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_MEMORY_FILE,
  DEFAULT_OUTCOME_MEMORY_FILE,
  DEFAULT_SUMMARY_FILE,
  EXPECTED_SEQUENCE,
  makeTask,
  findVisible,
  createTransferBaseProvider,
  budgets,
  runGate,
  main
};
