'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStrategy } = require('../../manager/strategy/index.js');
const {
  createRecoveryExplorationProvider
} = require('../../manager/strategy/recovery_exploration_provider.js');
const {
  createRecoveryPolicyProvider,
  readRecoveryMemory
} = require('../../manager/strategy/recovery_policy_memory.js');
const {
  executeRecoveryExplorationLearningEpisode
} = require('../../manager/agent/recovery_exploration_learning.js');
const { executeBoundedEpisodeLoop } = require('../../manager/agent/bounded_episode_loop.js');

function button(ref, label) {
  return {
    ref,
    tag: 'button',
    role: 'button',
    label,
    visible: true,
    enabled: true,
    editable: false,
    rect: { x: 100, y: 100, width: 120, height: 40 }
  };
}

function createRuntime() {
  let observationCount = 0;
  let scrollY = 0;
  let continueVisible = false;
  let title = 'READY';
  return {
    async observe() {
      observationCount += 1;
      const interactiveElements = [button('e0', 'Probe')];
      if (continueVisible) interactiveElements.push(button('e1', 'Continue'));
      return {
        observationId: `obs-${observationCount}`,
        capturedAt: new Date().toISOString(),
        url: 'http://127.0.0.1:8091/',
        title,
        viewport: { width: 800, height: 600 },
        scroll: { x: 0, y: scrollY },
        focusedRef: null,
        interactiveElements,
        pageSignals: {},
        privacy: { redacted: true }
      };
    },
    async executePlan({ plan }) {
      if (plan.actionType === 'waitAndObserve') return { ok: true };
      if (plan.actionType === 'scrollVertical') {
        scrollY = 500;
        continueVisible = true;
        return { ok: true };
      }
      if (plan.actionType === 'scrollHorizontal') return { ok: true };
      if (plan.actionType === 'click' && continueVisible) {
        title = 'RECOVERY EXPLORATION PASS';
        continueVisible = false;
        return { ok: true };
      }
      if (plan.actionType === 'click') return { ok: true };
      return { ok: true };
    }
  };
}

function task() {
  return {
    taskId: 'recovery-self-exploration-contract',
    type: 'controlled',
    instruction: 'Reveal the hidden continue control without a predefined recovery mapping',
    args: {},
    successCriteria: [
      { type: 'page', field: 'title', operator: 'equals', value: 'RECOVERY EXPLORATION PASS' }
    ],
    constraints: {},
    metadata: {}
  };
}

function baseProvider() {
  return {
    name: 'recovery-exploration-base',
    version: '0.1.0',
    async decide({ observation, history }) {
      if (!history.length) {
        return {
          status: 'act',
          action: { type: 'click', targetRef: 'e0', args: {} },
          reasonCode: 'probe_first',
          expectedOutcome: {},
          recovery: {},
          metadata: { prototypeSource: 'base' }
        };
      }
      const next = (observation.interactiveElements || []).find(element => element.label === 'Continue');
      if (next) {
        return {
          status: 'act',
          action: { type: 'click', targetRef: next.ref, args: {} },
          reasonCode: 'continue_visible',
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
    maxSteps: 7,
    maxDurationMs: 120000,
    maxConsecutiveFailures: 4,
    maxReplans: 6,
    maxStalledSteps: 4
  };
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-exploration-learning-'));
  const memoryFile = path.join(dir, 'recovery.jsonl');

  const explorationProvider = createRecoveryExplorationProvider({
    baseProvider: baseProvider(),
    actionTypes: ['waitAndObserve', 'scrollVertical', 'scrollHorizontal']
  });
  const learned = await executeRecoveryExplorationLearningEpisode({
    runtime: createRuntime(),
    strategy: createStrategy({ provider: explorationProvider }),
    task: task(),
    recoveryMemoryFile: memoryFile,
    postActionSettle: false,
    budgets: budgets()
  });

  assert.equal(learned.finalOutcome.taskSucceeded, true);
  assert.equal(learned.finalBudget.reasonCode, 'goal_satisfied');
  assert.deepEqual(learned.steps.map(step => step.action.type), [
    'click', 'waitAndObserve', 'scrollVertical', 'click'
  ]);
  assert.equal(learned.steps[1].decision.metadata.prototypeSource, 'recoveryExploration');
  assert.equal(learned.steps[2].decision.metadata.prototypeSource, 'recoveryExploration');
  assert.equal(learned.steps[1].effect.status, 'no_effect');
  assert.ok(learned.steps[2].effect.codes.includes('scroll_changed'));
  assert.ok(learned.steps[2].effect.codes.includes('elements_added'));
  assert.equal(learned.recoveryLearning.learned, true);
  assert.equal(learned.recoveryLearning.write.appended, 2);

  const stored = readRecoveryMemory(memoryFile);
  assert.equal(stored.length, 2);
  const rootRecovery = stored.find(record => record.trigger.actionType === 'click');
  assert.ok(rootRecovery);
  assert.equal(rootRecovery.trigger.targetLabel, 'Probe');
  assert.equal(rootRecovery.trigger.effectStatus, 'no_effect');
  assert.equal(rootRecovery.recovery.type, 'scrollVertical');
  assert.equal(rootRecovery.verification.exploratoryRetriesSkipped, 1);

  const recallProvider = createRecoveryPolicyProvider({
    baseProvider: baseProvider(),
    memoryFile,
    minimumScore: 0.55
  });
  const recalled = await executeBoundedEpisodeLoop({
    runtime: createRuntime(),
    strategy: createStrategy({ provider: recallProvider }),
    task: task(),
    postActionSettle: false,
    budgets: budgets()
  });

  assert.equal(recalled.finalOutcome.taskSucceeded, true);
  assert.equal(recalled.finalBudget.reasonCode, 'goal_satisfied');
  assert.deepEqual(recalled.steps.map(step => step.action.type), ['click', 'scrollVertical', 'click']);
  assert.equal(recalled.steps[1].decision.reasonCode, 'learned_recovery_policy');
  assert.equal(recalled.steps[1].decision.metadata.prototypeSource, 'recoveryPolicy');
  assert.equal(recalled.steps[1].decision.metadata.persistentMemory, true);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Recovery self-exploration learning contract: PASS');
}

main().catch(error => {
  console.error('Recovery self-exploration learning contract: FAIL');
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
