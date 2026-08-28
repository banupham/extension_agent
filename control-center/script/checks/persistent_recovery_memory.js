'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStrategy } = require('../../manager/strategy/index.js');
const {
  readRecoveryMemory,
  createRecoveryPolicyProvider
} = require('../../manager/strategy/recovery_policy_memory.js');
const {
  executeSelfLearningEpisode
} = require('../../manager/agent/self_learning_episode.js');
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
  let observeCount = 0;
  let scrollY = 0;
  let continueVisible = false;
  let title = 'READY';
  return {
    async observe() {
      observeCount += 1;
      const interactiveElements = [button('e0', 'Probe')];
      if (continueVisible) interactiveElements.push(button('e1', 'Continue'));
      return {
        observationId: `obs-${observeCount}`,
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
      if (plan.actionType === 'scrollVertical') {
        scrollY = 500;
        continueVisible = true;
        return { ok: true };
      }
      if (plan.actionType === 'click' && continueVisible) {
        title = 'PERSISTENT RECOVERY PASS';
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
    taskId: 'persistent-recovery-contract',
    type: 'controlled',
    instruction: 'Reveal the hidden continue control',
    args: {},
    successCriteria: [
      { type: 'page', field: 'title', operator: 'equals', value: 'PERSISTENT RECOVERY PASS' }
    ],
    constraints: {},
    metadata: {}
  };
}

function baseProvider() {
  return {
    name: 'persistent-recovery-base',
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
        status: 'act',
        action: { type: 'waitAndObserve', targetRef: null, args: {} },
        reasonCode: 'base_does_not_know_recovery',
        expectedOutcome: {},
        recovery: {},
        metadata: { prototypeSource: 'base' }
      };
    }
  };
}

function assertStoredMemoryPrivacy(value) {
  const forbidden = new Set([
    'selector', 'selectors', 'targetRef', 'rect', 'x', 'y',
    'cdpPlan', 'cdpPacket', 'rawCdp', 'cdpMethod', 'tabId'
  ]);
  function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      assert.equal(forbidden.has(key), false, `forbidden recovery memory key: ${key}`);
      walk(child);
    }
  }
  walk(value);
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-recovery-memory-'));
  const memoryFile = path.join(dir, 'recovery.jsonl');

  const learningProvider = {
    name: 'recovery-explorer-fixture',
    version: '0.1.0',
    async decide({ observation, history }) {
      if (!history.length) {
        return {
          status: 'act',
          action: { type: 'click', targetRef: 'e0', args: {} },
          reasonCode: 'explore_probe',
          expectedOutcome: {},
          recovery: {},
          metadata: { prototypeSource: 'selfExploration' }
        };
      }
      if (history.length === 1) {
        assert.equal(history[0].effectStatus, 'no_effect');
        assert.equal(history[0].actionTargetLabel, 'Probe');
        return {
          status: 'act',
          action: { type: 'scrollVertical', targetRef: null, args: {} },
          reasonCode: 'explore_alternative_action',
          expectedOutcome: {},
          recovery: {},
          metadata: { prototypeSource: 'selfExploration' }
        };
      }
      const next = (observation.interactiveElements || []).find(element => element.label === 'Continue');
      assert.ok(next);
      return {
        status: 'act',
        action: { type: 'click', targetRef: next.ref, args: {} },
        reasonCode: 'complete_after_discovery',
        expectedOutcome: {},
        recovery: {},
        metadata: { prototypeSource: 'selfExploration' }
      };
    }
  };

  const learned = await executeSelfLearningEpisode({
    runtime: createRuntime(),
    strategy: createStrategy({ provider: learningProvider }),
    task: task(),
    recoveryMemoryFile: memoryFile,
    postActionSettle: false,
    budgets: {
      maxSteps: 5,
      maxDurationMs: 120000,
      maxConsecutiveFailures: 3,
      maxReplans: 4,
      maxStalledSteps: 3
    }
  });

  assert.equal(learned.finalOutcome.taskSucceeded, true);
  assert.equal(learned.recoveryLearning.attempted, true);
  assert.equal(learned.recoveryLearning.learned, true);
  assert.equal(learned.recoveryLearning.write.appended, 1);
  assert.deepEqual(learned.steps.map(step => step.action.type), ['click', 'scrollVertical', 'click']);

  const stored = readRecoveryMemory(memoryFile);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].source, 'agent-self-experience');
  assert.equal(stored[0].trigger.actionType, 'click');
  assert.equal(stored[0].trigger.targetLabel, 'Probe');
  assert.equal(stored[0].trigger.effectStatus, 'no_effect');
  assert.equal(stored[0].recovery.type, 'scrollVertical');
  assertStoredMemoryPrivacy(stored[0]);

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
    budgets: {
      maxSteps: 5,
      maxDurationMs: 120000,
      maxConsecutiveFailures: 3,
      maxReplans: 4,
      maxStalledSteps: 3
    }
  });

  assert.equal(recalled.finalOutcome.taskSucceeded, true);
  assert.equal(recalled.finalBudget.reasonCode, 'goal_satisfied');
  assert.deepEqual(recalled.steps.map(step => step.action.type), ['click', 'scrollVertical', 'click']);
  assert.equal(recalled.steps[1].decision.reasonCode, 'learned_recovery_policy');
  assert.equal(recalled.steps[1].decision.metadata.prototypeSource, 'recoveryPolicy');
  assert.equal(recalled.steps[1].decision.metadata.persistentMemory, true);
  assert.equal(recalled.steps[0].effect.status, 'no_effect');
  assert.ok(recalled.steps[1].effect.codes.includes('scroll_changed'));
  assert.ok(recalled.steps[1].effect.codes.includes('elements_added'));

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Persistent recovery self-learning contract: PASS');
}

main().catch(error => {
  console.error('Persistent recovery self-learning contract: FAIL');
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
