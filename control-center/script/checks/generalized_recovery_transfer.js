'use strict';

const assert = require('assert');
const {
  selectRecovery
} = require('../../manager/strategy/recovery_policy_memory.js');
const {
  generalizedTriggerScore,
  selectGeneralizedRecovery,
  createRecoveryTransferProvider
} = require('../../manager/strategy/recovery_transfer_provider.js');

function sourcePolicy(overrides = {}) {
  return {
    memoryVersion: '0.2.0',
    kind: 'strategy-recovery-policy',
    source: 'agent-self-experience',
    recoveryId: overrides.recoveryId || 'recovery-source-vertical',
    learnedAt: '2026-08-27T00:00:00.000Z',
    task: { instruction: overrides.task || 'Reveal the hidden continuation in the recovery lab' },
    trigger: {
      actionType: overrides.triggerActionType || 'click',
      targetLabel: overrides.triggerTargetLabel || 'Source Probe',
      controlStatus: 'failed',
      reasonCode: overrides.reasonCode || 'action_no_observable_effect',
      effectStatus: overrides.effectStatus || 'no_effect',
      effectCodes: overrides.effectCodes || ['focus_changed']
    },
    recovery: {
      type: overrides.recoveryType || 'scrollVertical',
      targetLabel: overrides.recoveryTargetLabel == null ? null : overrides.recoveryTargetLabel
    },
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

function summaryFor(policy, overrides = {}) {
  const successes = overrides.successes == null ? 4 : Number(overrides.successes);
  const failures = overrides.failures == null ? 0 : Number(overrides.failures);
  const attempts = successes + failures;
  return {
    memoryVersion: '0.1.0',
    kind: 'strategy-recovery-outcome-summary',
    source: 'agent-self-experience',
    summaryId: overrides.summaryId || `summary-${policy.recoveryId}`,
    consolidatedAt: '2026-08-27T00:00:00.000Z',
    halfLifeMs: 604800000,
    task: { instruction: policy.task.instruction },
    trigger: {
      actionType: policy.trigger.actionType,
      targetLabel: policy.trigger.targetLabel,
      reasonCode: policy.trigger.reasonCode,
      effectStatus: policy.trigger.effectStatus,
      effectCodes: [...policy.trigger.effectCodes]
    },
    recovery: { ...policy.recovery },
    evidence: {
      attempts,
      successes,
      failures,
      weightedSuccesses: successes,
      weightedFailures: failures,
      lastUsefulEffect: successes > failures,
      lastEffectStatus: successes > failures ? 'effect_observed' : 'no_effect',
      lastEffectCodes: successes > failures ? ['elements_added', 'scroll_changed'] : []
    },
    reinforcement: {
      successfulConfirmations: Math.max(0, successes - 1),
      negativeRevisions: failures,
      lastReinforcedAt: successes > 1 ? '2026-08-27T00:00:00.000Z' : null
    },
    firstObservedAt: '2026-08-27T00:00:00.000Z',
    lastObservedAt: '2026-08-27T00:00:00.000Z',
    verification: {
      privacyRedacted: true,
      selectorsStored: false,
      rawCoordinatesStored: false,
      observationLocalRefsStored: false,
      privateReasoningStored: false
    }
  };
}

function targetTask() {
  return {
    taskId: 'transfer-target',
    type: 'generic',
    instruction: 'Advance a different concealed interface',
    args: {},
    successCriteria: [],
    constraints: {},
    metadata: {}
  };
}

function failedClickHistory(overrides = {}) {
  return [{
    actionType: overrides.actionType || 'click',
    actionTargetLabel: overrides.targetLabel || 'Transfer Probe',
    controlStatus: 'failed',
    reasonCode: overrides.reasonCode || 'action_no_observable_effect',
    effectStatus: overrides.effectStatus || 'no_effect',
    effectCodes: overrides.effectCodes || ['focus_changed']
  }];
}

async function main() {
  const policy = sourcePolicy();
  const summary = summaryFor(policy);
  const task = targetTask();
  const history = failedClickHistory();

  const exact = selectRecovery([policy], task, history, 0.55);
  assert.equal(exact, null, 'task-specific recovery should not match the unrelated target task');

  const similarity = generalizedTriggerScore(policy, task, history[0]);
  assert(similarity && similarity.score >= 0.70, `expected transferable trigger score, got ${similarity?.score}`);
  assert(similarity.taskScore < 0.55, 'contract must prove cross-task transfer rather than task paraphrase recall');

  const transferred = selectGeneralizedRecovery([policy], task, history, {
    summaryRecords: [summary],
    rawRecords: [],
    minimumTransferScore: 0.70,
    minimumSourceConfidence: 0.55,
    minimumEffectiveEvidence: 0.5,
    nowMs: Date.parse('2026-08-27T00:00:01.000Z')
  });
  assert(transferred, 'generalized recovery should transfer from semantic trigger similarity');
  assert.equal(transferred.record.recovery.type, 'scrollVertical');
  assert(transferred.historical.confidence > 0.7);

  let fallbackCalls = 0;
  const fallbackProvider = {
    name: 'fallback',
    version: '0.1.0',
    async decide() {
      fallbackCalls += 1;
      return { status: 'blocked', confidence: 0, reasonCode: 'fallback', recovery: {}, metadata: { prototypeSource: 'fallback' } };
    }
  };
  const provider = createRecoveryTransferProvider({
    fallbackProvider,
    policyRecords: [policy],
    summaryRecords: [summary],
    rawRecords: [],
    minimumTransferScore: 0.70,
    minimumSourceConfidence: 0.55,
    minimumEffectiveEvidence: 0.5,
    nowMs: Date.parse('2026-08-27T00:00:01.000Z')
  });
  const decision = await provider.decide({ task, observation: { interactiveElements: [] }, history });
  assert.equal(decision.status, 'act');
  assert.equal(decision.action.type, 'scrollVertical');
  assert.equal(decision.metadata.prototypeSource, 'recoveryTransfer');
  assert.equal(decision.metadata.crossTaskTransfer, true);
  assert.equal(fallbackCalls, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(decision.action, 'selector'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(decision.action, 'x'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(decision.action, 'y'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(decision.action, 'cdpMethod'), false);

  const weakSummary = summaryFor(policy, { summaryId: 'summary-weak', successes: 0, failures: 4 });
  const weak = selectGeneralizedRecovery([policy], task, history, {
    summaryRecords: [weakSummary],
    minimumTransferScore: 0.70,
    minimumSourceConfidence: 0.55,
    minimumEffectiveEvidence: 0.5,
    nowMs: Date.parse('2026-08-27T00:00:01.000Z')
  });
  assert.equal(weak, null, 'low-confidence source experience must not transfer');

  const executionMismatch = selectGeneralizedRecovery([policy], task, failedClickHistory({
    effectStatus: 'execution_failed',
    reasonCode: 'runtime_execution_failed',
    effectCodes: ['execution_failed']
  }), {
    summaryRecords: [summary],
    nowMs: Date.parse('2026-08-27T00:00:01.000Z')
  });
  assert.equal(executionMismatch, null, 'different failure semantics must not transfer');

  const targetedPolicy = sourcePolicy({
    recoveryId: 'recovery-targeted-dismiss',
    recoveryType: 'dismiss',
    recoveryTargetLabel: 'Dismiss Dialog'
  });
  const targeted = selectGeneralizedRecovery([targetedPolicy], task, history, {
    summaryRecords: [summaryFor(targetedPolicy)],
    nowMs: Date.parse('2026-08-27T00:00:01.000Z')
  });
  assert.equal(targeted, null, 'v0.1 generalized transfer must stay within targetless safe recoveries');

  console.log('Generalized recovery transfer contract: PASS');
}

if (require.main === module) {
  main().catch(error => {
    console.error('Generalized recovery transfer contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { sourcePolicy, summaryFor, targetTask, failedClickHistory, main };
