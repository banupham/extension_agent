'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStrategy } = require('../../manager/strategy/index.js');
const { createRecoveryExplorationProvider } = require('../../manager/strategy/recovery_exploration_provider.js');
const { createAdaptiveRecoveryProvider } = require('../../manager/strategy/adaptive_recovery_provider.js');
const {
  RECOVERY_POLICY_VERSION,
  RECOVERY_POLICY_KIND,
  appendRecoveryRecord,
  readRecoveryMemory
} = require('../../manager/strategy/recovery_policy_memory.js');
const {
  RECOVERY_OUTCOME_VERSION,
  RECOVERY_OUTCOME_KIND,
  appendRecoveryOutcomeRecord,
  readRecoveryOutcomeMemory,
  recoveryOutcomeStats
} = require('../../manager/strategy/recovery_outcome_memory.js');
const {
  executeRecoveryExplorationLearningEpisode
} = require('../../manager/agent/recovery_exploration_learning.js');

function button(ref, label) {
  return {
    ref,
    tag: 'button',
    role: 'button',
    label,
    visible: true,
    enabled: true,
    editable: false,
    rect: { x: 100, y: 100, width: 140, height: 40 }
  };
}

function createHorizontalDriftRuntime() {
  let observeCount = 0;
  let scrollX = 0;
  let continueVisible = false;
  let title = 'RECOVERY DRIFT READY';
  return {
    async observe() {
      observeCount += 1;
      const elements = [button('e0', 'Recovery Probe')];
      if (continueVisible) elements.push(button('e1', 'Recovery Continue'));
      return {
        observationId: `obs-${observeCount}`,
        capturedAt: new Date().toISOString(),
        url: 'http://127.0.0.1:8091/recovery?variant=horizontal',
        title,
        viewport: { width: 800, height: 600 },
        scroll: { x: scrollX, y: 0 },
        focusedRef: null,
        interactiveElements: elements,
        pageSignals: {},
        privacy: { redacted: true }
      };
    },
    async executePlan({ plan }) {
      if (plan.actionType === 'click' && !continueVisible) return { ok: true };
      if (plan.actionType === 'scrollVertical') return { ok: true };
      if (plan.actionType === 'waitAndObserve') return { ok: true };
      if (plan.actionType === 'scrollHorizontal') {
        scrollX = 500;
        continueVisible = true;
        return { ok: true };
      }
      if (plan.actionType === 'click' && continueVisible) {
        title = 'ADAPTIVE RECOVERY PASS';
        continueVisible = false;
        return { ok: true };
      }
      return { ok: true };
    }
  };
}

function task() {
  return {
    taskId: 'adaptive-recovery-drift-contract',
    type: 'controlled',
    instruction: 'Complete the recovery self-learning challenge',
    args: {},
    successCriteria: [{ type: 'page', field: 'title', operator: 'equals', value: 'ADAPTIVE RECOVERY PASS' }],
    constraints: {},
    metadata: {}
  };
}

function baseProvider() {
  return {
    name: 'adaptive-drift-base',
    version: '0.1.0',
    async decide({ observation, history = [] }) {
      if (!history.length) {
        return {
          status: 'act',
          action: { type: 'click', targetRef: 'e0', args: {} },
          confidence: 0.5,
          reasonCode: 'probe_first',
          expectedOutcome: {},
          recovery: {},
          metadata: { prototypeSource: 'base' }
        };
      }
      const next = (observation.interactiveElements || []).find(element => element.label === 'Recovery Continue');
      if (next) {
        return {
          status: 'act',
          action: { type: 'click', targetRef: next.ref, args: {} },
          confidence: 0.8,
          reasonCode: 'continue_visible',
          expectedOutcome: {},
          recovery: {},
          metadata: { prototypeSource: 'base' }
        };
      }
      return {
        status: 'blocked',
        confidence: 0,
        reasonCode: 'base_has_no_recovery',
        recovery: {},
        metadata: { prototypeSource: 'base' }
      };
    }
  };
}

function rootTrigger() {
  return {
    actionType: 'click',
    targetLabel: 'Recovery Probe',
    controlStatus: 'failed',
    reasonCode: 'action_no_observable_effect',
    effectStatus: 'no_effect',
    effectCodes: []
  };
}

function policyRecord() {
  return {
    memoryVersion: RECOVERY_POLICY_VERSION,
    kind: RECOVERY_POLICY_KIND,
    source: 'agent-self-experience',
    recoveryId: 'recovery-old-vertical',
    learnedAt: '2026-01-01T00:00:00.000Z',
    task: { instruction: task().instruction },
    trigger: rootTrigger(),
    recovery: { type: 'scrollVertical', targetLabel: null },
    verification: {
      sourceEpisodeSucceeded: true,
      recoveryStepHadUsefulEffect: true,
      privacyRedacted: true,
      selectorsStored: false,
      rawCoordinatesStored: false,
      observationLocalRefsStored: false,
      privateReasoningStored: false,
      taskPayloadArgsStored: false
    }
  };
}

function outcomeRecord(id, recoveryType, usefulEffect) {
  return {
    memoryVersion: RECOVERY_OUTCOME_VERSION,
    kind: RECOVERY_OUTCOME_KIND,
    source: 'agent-self-experience',
    outcomeId: id,
    observedAt: '2026-01-01T00:00:00.000Z',
    task: { instruction: task().instruction },
    trigger: rootTrigger(),
    recovery: { type: recoveryType, targetLabel: null },
    outcome: {
      usefulEffect,
      taskSucceeded: false,
      progressDelta: 0,
      effectStatus: usefulEffect ? 'effect_observed' : 'no_effect',
      effectCodes: usefulEffect ? ['scroll_changed', 'elements_added'] : []
    },
    verification: {
      privacyRedacted: true,
      selectorsStored: false,
      rawCoordinatesStored: false,
      observationLocalRefsStored: false,
      privateReasoningStored: false
    }
  };
}

function adaptiveProvider(policyFile, outcomeFile) {
  const explorationProvider = createRecoveryExplorationProvider({
    baseProvider: baseProvider(),
    actionTypes: ['waitAndObserve', 'scrollVertical', 'scrollHorizontal'],
    outcomeMemoryFile: outcomeFile
  });
  return createAdaptiveRecoveryProvider({
    explorationProvider,
    policyMemoryFile: policyFile,
    outcomeMemoryFile: outcomeFile,
    minimumPolicyScore: 0.55,
    minimumOutcomeConfidence: 0.55
  });
}

async function runEpisode(policyFile, outcomeFile) {
  return executeRecoveryExplorationLearningEpisode({
    runtime: createHorizontalDriftRuntime(),
    strategy: createStrategy({ provider: adaptiveProvider(policyFile, outcomeFile) }),
    task: task(),
    recoveryMemoryFile: policyFile,
    recoveryOutcomeMemoryFile: outcomeFile,
    postActionSettle: false,
    budgets: {
      maxSteps: 7,
      maxDurationMs: 120000,
      maxConsecutiveFailures: 4,
      maxReplans: 6,
      maxStalledSteps: 4
    }
  });
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adaptive-recovery-drift-'));
  const policyFile = path.join(dir, 'policy.jsonl');
  const outcomeFile = path.join(dir, 'outcomes.jsonl');

  appendRecoveryRecord(policyFile, policyRecord());
  appendRecoveryOutcomeRecord(outcomeFile, outcomeRecord('old-scroll-success', 'scrollVertical', true));
  appendRecoveryOutcomeRecord(outcomeFile, outcomeRecord('old-wait-failure', 'waitAndObserve', false));

  const first = await runEpisode(policyFile, outcomeFile);
  assert.equal(first.finalOutcome.taskSucceeded, true);
  assert.equal(first.finalBudget.reasonCode, 'goal_satisfied');
  assert.deepEqual(first.steps.map(step => step.action.type), ['click', 'scrollVertical', 'scrollHorizontal', 'click']);
  assert.deepEqual(first.steps.map(step => step.decision.metadata.prototypeSource), ['base', 'recoveryPolicy', 'recoveryExploration', 'base']);
  assert.equal(first.steps[1].effect.status, 'no_effect');
  assert.equal(first.steps[2].effect.status, 'effect_observed');
  assert.equal(first.steps[2].decision.metadata.policyRejectedByOutcomeHistory, true);
  assert.equal(first.steps[2].decision.metadata.rejectedRecoveryType, 'scrollVertical');
  assert.equal(first.recoveryOutcomeLearning.appended, 2);
  assert.equal(first.recoveryLearning.learned, true);

  const policiesAfterDrift = readRecoveryMemory(policyFile);
  assert.ok(policiesAfterDrift.some(record => record.trigger.actionType === 'click' && record.recovery.type === 'scrollHorizontal'));

  const outcomesAfterDrift = readRecoveryOutcomeMemory(outcomeFile);
  const verticalStats = recoveryOutcomeStats(outcomesAfterDrift, {
    task: task(), trigger: rootTrigger(), recovery: { type: 'scrollVertical', targetLabel: null }
  });
  const horizontalStats = recoveryOutcomeStats(outcomesAfterDrift, {
    task: task(), trigger: rootTrigger(), recovery: { type: 'scrollHorizontal', targetLabel: null }
  });
  assert.equal(verticalStats.attempts, 2);
  assert.equal(verticalStats.successes, 1);
  assert.equal(verticalStats.failures, 1);
  assert.ok(verticalStats.confidence < 0.55);
  assert.equal(horizontalStats.attempts, 1);
  assert.equal(horizontalStats.successes, 1);
  assert.ok(horizontalStats.confidence > 0.55);

  const second = await runEpisode(policyFile, outcomeFile);
  assert.equal(second.finalOutcome.taskSucceeded, true);
  assert.deepEqual(second.steps.map(step => step.action.type), ['click', 'scrollHorizontal', 'click']);
  assert.deepEqual(second.steps.map(step => step.decision.metadata.prototypeSource), ['base', 'recoveryPolicy', 'base']);
  assert.equal(second.steps[1].decision.metadata.policyRejectedByOutcomeHistory, false);
  assert.equal(second.steps[1].decision.metadata.recoveryId !== 'recovery-old-vertical', true);
  assert.ok(second.steps[1].decision.metadata.policyOutcomeConfidence > 0.55);

  const policyText = fs.readFileSync(policyFile, 'utf8');
  const outcomeText = fs.readFileSync(outcomeFile, 'utf8');
  for (const forbidden of ['"selector":', '"selectors":', '"targetRef":', '"tabId":', '"rawCdp":', '"privateReasoning":']) {
    assert.equal(policyText.includes(forbidden), false, `forbidden policy field: ${forbidden}`);
    assert.equal(outcomeText.includes(forbidden), false, `forbidden outcome field: ${forbidden}`);
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Adaptive recovery drift contract: PASS');
}

main().catch(error => {
  console.error('Adaptive recovery drift contract: FAIL');
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
