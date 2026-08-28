'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  appendRecoveryOutcomeRecord,
  readRecoveryOutcomeMemory,
  recoveryOutcomeStats
} = require('../../manager/strategy/recovery_outcome_memory.js');
const { createRecoveryExplorationProvider } = require('../../manager/strategy/recovery_exploration_provider.js');

function observation() {
  return {
    observationId: 'obs-confidence',
    capturedAt: new Date().toISOString(),
    url: 'http://127.0.0.1:8091/recovery',
    title: 'RECOVERY LEARNING READY',
    viewport: { width: 800, height: 600 },
    scroll: { x: 0, y: 0 },
    focusedRef: null,
    interactiveElements: [],
    pageSignals: {},
    privacy: { redacted: true }
  };
}

function record({ id, task, trigger, recoveryType, useful }) {
  return {
    memoryVersion: '0.1.0',
    kind: 'strategy-recovery-outcome',
    source: 'agent-self-experience',
    outcomeId: id,
    observedAt: new Date().toISOString(),
    task: { instruction: task.instruction },
    trigger: { ...trigger },
    recovery: { type: recoveryType, targetLabel: null },
    outcome: {
      usefulEffect: useful,
      taskSucceeded: false,
      progressDelta: 0,
      effectStatus: useful ? 'effect_observed' : 'no_effect',
      effectCodes: useful ? ['scroll_changed', 'elements_added'] : []
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

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-outcomes-'));
  const file = path.join(dir, 'outcomes.jsonl');
  const task = { instruction: 'Complete the recovery self-learning challenge' };
  const trigger = {
    actionType: 'click',
    targetLabel: 'Recovery Probe',
    reasonCode: 'action_no_observable_effect',
    effectStatus: 'no_effect',
    effectCodes: ['focus_changed']
  };

  appendRecoveryOutcomeRecord(file, record({ id: 'negative-wait', task, trigger, recoveryType: 'waitAndObserve', useful: false }));
  appendRecoveryOutcomeRecord(file, record({ id: 'positive-scroll', task, trigger, recoveryType: 'scrollVertical', useful: true }));

  const records = readRecoveryOutcomeMemory(file);
  assert.equal(records.length, 2);

  const waitStats = recoveryOutcomeStats(records, { task, trigger, recovery: { type: 'waitAndObserve', targetLabel: null } });
  const scrollStats = recoveryOutcomeStats(records, { task, trigger, recovery: { type: 'scrollVertical', targetLabel: null } });
  assert.deepEqual({ attempts: waitStats.attempts, successes: waitStats.successes, failures: waitStats.failures }, { attempts: 1, successes: 0, failures: 1 });
  assert.deepEqual({ attempts: scrollStats.attempts, successes: scrollStats.successes, failures: scrollStats.failures }, { attempts: 1, successes: 1, failures: 0 });
  assert.ok(waitStats.confidence < 0.5);
  assert.ok(scrollStats.confidence > 0.5);
  assert.ok(scrollStats.confidence > waitStats.confidence);

  const baseProvider = {
    name: 'confidence-base',
    version: '0.1.0',
    async decide() {
      return { status: 'blocked', confidence: 0, reasonCode: 'base_no_recovery', recovery: {}, metadata: { prototypeSource: 'base' } };
    }
  };
  const provider = createRecoveryExplorationProvider({
    baseProvider,
    actionTypes: ['waitAndObserve', 'scrollVertical'],
    outcomeMemoryFile: file
  });
  const history = [{
    stepIndex: 0,
    actionType: 'click',
    actionTargetLabel: 'Recovery Probe',
    controlStatus: 'failed',
    reasonCode: 'action_no_observable_effect',
    effectStatus: 'no_effect',
    effectCodes: ['focus_changed']
  }];

  const learnedDecision = await provider.decide({ task, observation: observation(), history });
  assert.equal(learnedDecision.action.type, 'scrollVertical');
  assert.equal(learnedDecision.metadata.historicalAttempts, 1);
  assert.equal(learnedDecision.metadata.historicalSuccesses, 1);
  assert.equal(learnedDecision.metadata.historicalFailures, 0);
  assert.ok(learnedDecision.metadata.historicalConfidence > 0.5);

  const secondDecision = await provider.decide({ task, observation: observation(), history });
  assert.equal(secondDecision.action.type, 'waitAndObserve');
  assert.equal(secondDecision.metadata.historicalFailures, 1);
  assert.ok(secondDecision.metadata.historicalConfidence < 0.5);

  const unknownProvider = createRecoveryExplorationProvider({
    baseProvider,
    actionTypes: ['waitAndObserve', 'scrollVertical'],
    outcomeMemoryFile: file
  });
  const unknownDecision = await unknownProvider.decide({
    task: { instruction: 'Unrelated recovery task' },
    observation: observation(),
    history
  });
  assert.equal(unknownDecision.action.type, 'waitAndObserve');
  assert.equal(unknownDecision.metadata.historicalAttempts, 0);

  const storedText = fs.readFileSync(file, 'utf8');
  for (const forbidden of ['"selector":', '"selectors":', '"targetRef":', '"tabId":', '"rawCdp":', '"privateReasoning":']) {
    assert.equal(storedText.includes(forbidden), false, `forbidden outcome memory field: ${forbidden}`);
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Recovery outcome confidence contract: PASS');
}

main().catch(error => {
  console.error('Recovery outcome confidence contract: FAIL');
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
