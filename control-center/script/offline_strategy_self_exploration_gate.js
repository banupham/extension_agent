'use strict';

const fs = require('fs');
const path = require('path');
const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { executeBoundedEpisodeLoop } = require('../manager/agent/bounded_episode_loop.js');
const { createStrategy } = require('../manager/strategy/index.js');
const {
  createSelfExplorationProvider,
  progressiveExperienceResult
} = require('../manager/strategy/self_exploration_provider.js');
const {
  buildSuccessfulExperience,
  appendExperience,
  readExperienceMemory,
  createSelfExperienceProvider,
  targetLabelForStep
} = require('../manager/strategy/self_experience_memory.js');
const { parseArgs, discoverRuntimeAgent, resolveCommandTabId } = require('./agent_one_action.js');
const { loadJson } = require('./offline_strategy_bounded_episode_loop_gate.js');

const EXPECTED_LEARNED_LABELS = ['Discovery Beta', 'Discovery Alpha', 'Discovery Gamma'];
const DEFAULT_MEMORY_FILE = path.join('training-collector', 'strategy-data', 'self-exploration-v01', 'memory.jsonl');

function makeTask(instruction = 'Solve the opaque discovery challenge') {
  return {
    taskId: `self-exploration-${Date.now()}`,
    type: 'controlled-self-exploration',
    instruction,
    args: {},
    successCriteria: [{ type: 'page', field: 'title', operator: 'equals', value: 'DISCOVERY PASS' }],
    constraints: {},
    metadata: { gate: 'offline-strategy-self-exploration' }
  };
}

function modelHasClickSkill(model) {
  return (Array.isArray(model?.actionPrototypes) ? model.actionPrototypes : [])
    .some(proto => String(proto?.type || '').trim() === 'click');
}

function modelContainsDiscoveryKnowledge(model) {
  return JSON.stringify(model || {}).toLowerCase().includes('discovery');
}

function stepTargetLabel(step) {
  return targetLabelForStep(step) || step?.decision?.metadata?.targetLabel || null;
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
  if (result?.invariant?.literalTrajectoryReplay !== false) errors.push('trajectory_replay_boundary_failed');
  return errors;
}

async function runGate(options = {}) {
  if (!options.runtime) throw new Error('runtime_required');
  if (!modelHasClickSkill(options.model)) throw new Error('self_exploration_requires_learned_click_skill');
  if (modelContainsDiscoveryKnowledge(options.model)) throw new Error('model_must_not_contain_discovery_demonstration');

  const mode = String(options.mode || 'learn').trim().toLowerCase();
  if (!['learn', 'recall'].includes(mode)) throw new Error('mode must be learn or recall');
  const memoryFile = path.resolve(options.memoryFile || DEFAULT_MEMORY_FILE);
  if (options.resetMemory === true && fs.existsSync(memoryFile)) fs.rmSync(memoryFile, { force: true });

  const explorationProvider = createSelfExplorationProvider({
    actionType: 'click',
    targetLabelPrefix: 'Discovery '
  });
  let provider = explorationProvider;
  if (mode === 'recall') {
    const records = readExperienceMemory(memoryFile);
    if (!records.length) throw new Error(`self_exploration_memory_empty:${memoryFile}`);
    provider = createSelfExperienceProvider({
      baseProvider: explorationProvider,
      memoryFile,
      minimumSimilarity: options.minimumRecallSimilarity ?? 0.9
    });
  }

  const task = makeTask(options.instruction || 'Solve the opaque discovery challenge');
  const strategy = createStrategy({ provider });
  const result = await executeBoundedEpisodeLoop({
    runtime: options.runtime,
    strategy,
    task,
    budgets: {
      maxSteps: 10,
      maxDurationMs: 120000,
      maxConsecutiveFailures: 2,
      maxReplans: 9,
      maxStalledSteps: 8
    },
    startedAtMs: Date.now() - 100
  });

  const errors = commonErrors(result);
  const attemptLabels = (result.steps || []).map(stepTargetLabel);
  const decisionSources = (result.steps || []).map(step => step?.decision?.metadata?.prototypeSource || null);
  const semanticActions = (result.steps || []).map(step => step?.action?.type || null);
  let memoryWrite = null;
  let learnedExperience = null;
  let learnedLabels = [];

  if (mode === 'learn') {
    if (decisionSources.some(source => source !== 'selfExploration')) {
      errors.push(`learn_source:${decisionSources.join(',')}`);
    }
    if (attemptLabels[0] !== 'Discovery Alpha') errors.push(`first_probe:${attemptLabels[0] || '<missing>'}`);
    const progressive = progressiveExperienceResult(result);
    learnedExperience = buildSuccessfulExperience({ task, result: progressive });
    learnedLabels = learnedExperience.sequence.map(step => step.targetLabel);
    if (learnedLabels.join('|') !== EXPECTED_LEARNED_LABELS.join('|')) {
      errors.push(`learned_sequence:${learnedLabels.join('|') || '<empty>'}`);
    }
    if (!errors.length) memoryWrite = appendExperience(memoryFile, learnedExperience);
    if (!memoryWrite) errors.push('self_exploration_memory_not_written');
  } else {
    if (decisionSources.some(source => source !== 'selfExperience')) {
      errors.push(`recall_source:${decisionSources.join(',')}`);
    }
    if (attemptLabels.join('|') !== EXPECTED_LEARNED_LABELS.join('|')) {
      errors.push(`recalled_sequence:${attemptLabels.join('|') || '<empty>'}`);
    }
    if (result.steps.length !== 3) errors.push(`recall_action_count:${result.steps.length}`);
  }

  return {
    ok: errors.length === 0,
    result: errors.length === 0 ? 'PASS' : 'FAIL',
    gate: 'offline-strategy-self-exploration',
    mode,
    task: task.instruction,
    provider: strategy.provider,
    memoryFile,
    memoryWrite,
    learnedExperience: learnedExperience ? {
      experienceId: learnedExperience.experienceId,
      source: learnedExperience.source,
      sequence: learnedExperience.sequence.map(step => ({ type: step.type, targetLabel: step.targetLabel })),
      verification: learnedExperience.verification
    } : null,
    proof: {
      modelHasClickSkill: true,
      modelContainsDiscoveryKnowledge: false,
      taskContainsTargetLabels: EXPECTED_LEARNED_LABELS.some(label => task.instruction.toLowerCase().includes(label.toLowerCase())),
      explorationPrimitive: 'click'
    },
    attempts: (result.steps || []).map((step, index) => ({
      index,
      actionType: step?.action?.type || null,
      targetLabel: stepTargetLabel(step),
      decisionSource: step?.decision?.metadata?.prototypeSource || null,
      beforeTitle: step?.before?.title || null,
      afterTitle: step?.after?.title || null,
      semanticProgress: step?.outcome?.taskSucceeded === true || (
        step?.before && step?.after &&
        JSON.stringify(step.before.interactiveElements || []) !== JSON.stringify(step.after.interactiveElements || [])
      ),
      taskSucceeded: step?.outcome?.taskSucceeded === true
    })),
    actualActions: semanticActions,
    attemptLabels,
    learnedLabels,
    decisionSources,
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
    errors
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.model) throw new Error('--model is required');
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
      mode: args.mode || 'learn',
      instruction: args.task || 'Solve the opaque discovery challenge',
      memoryFile: args.memory || DEFAULT_MEMORY_FILE,
      resetMemory: args['reset-memory'] === true,
      minimumRecallSimilarity: args['minimum-recall-similarity'] == null ? 0.9 : Number(args['minimum-recall-similarity'])
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
      gate: 'offline-strategy-self-exploration',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED_LEARNED_LABELS,
  DEFAULT_MEMORY_FILE,
  makeTask,
  modelHasClickSkill,
  modelContainsDiscoveryKnowledge,
  stepTargetLabel,
  commonErrors,
  runGate,
  main
};
