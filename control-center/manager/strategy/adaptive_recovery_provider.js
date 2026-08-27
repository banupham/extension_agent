'use strict';

const path = require('path');
const {
  createRecoveryPolicyProvider,
  readRecoveryMemory,
  selectRecovery
} = require('./recovery_policy_memory.js');
const {
  readRecoveryOutcomeMemory,
  recoveryOutcomeStats
} = require('./recovery_outcome_memory.js');

const ADAPTIVE_RECOVERY_VERSION = '0.2.0';

function clamp01(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

function recoverySelectionHistory(history = []) {
  if (!Array.isArray(history) || !history.length) return [];
  const last = history[history.length - 1];
  const source = String(last?.decisionSource || '').trim();
  const rootActionType = String(last?.recoveryTriggerActionType || '').trim();
  if ((source !== 'recoveryPolicy' && source !== 'recoveryExploration') || !rootActionType) return history;
  return [
    ...history.slice(0, -1),
    {
      ...last,
      actionType: rootActionType,
      actionTargetLabel: last.recoveryTriggerTargetLabel || null,
      controlStatus: 'failed',
      reasonCode: last.recoveryTriggerReasonCode || 'action_no_observable_effect',
      effectStatus: last.recoveryTriggerEffectStatus || 'no_effect',
      effectCodes: Array.isArray(last.recoveryTriggerEffectCodes) ? [...last.recoveryTriggerEffectCodes] : []
    }
  ];
}

function createAdaptiveRecoveryProvider(options = {}) {
  const explorationProvider = options.explorationProvider;
  if (!explorationProvider || typeof explorationProvider.decide !== 'function') {
    throw new Error('adaptive_recovery_exploration_provider_required');
  }

  const staticPolicyRecords = Array.isArray(options.policyRecords) ? options.policyRecords : null;
  const policyMemoryFile = options.policyMemoryFile ? path.resolve(options.policyMemoryFile) : null;
  const staticOutcomeRecords = Array.isArray(options.outcomeRecords) ? options.outcomeRecords : null;
  const outcomeMemoryFile = options.outcomeMemoryFile ? path.resolve(options.outcomeMemoryFile) : null;
  const minimumPolicyScore = clamp01(options.minimumPolicyScore, 0.55);
  const minimumOutcomeConfidence = clamp01(options.minimumOutcomeConfidence, 0.55);

  function currentPolicyRecords() {
    if (staticPolicyRecords) return staticPolicyRecords;
    return policyMemoryFile ? readRecoveryMemory(policyMemoryFile) : [];
  }

  function currentOutcomeRecords() {
    if (staticOutcomeRecords) return staticOutcomeRecords;
    return outcomeMemoryFile ? readRecoveryOutcomeMemory(outcomeMemoryFile) : [];
  }

  const policyProvider = createRecoveryPolicyProvider({
    baseProvider: explorationProvider,
    ...(staticPolicyRecords ? { records: staticPolicyRecords } : {}),
    ...(policyMemoryFile ? { memoryFile: policyMemoryFile } : {}),
    minimumScore: minimumPolicyScore
  });

  return {
    name: 'adaptive-learned-recovery',
    version: ADAPTIVE_RECOVERY_VERSION,

    async decide({ task, observation, history = [] }) {
      const selectionHistory = recoverySelectionHistory(history);
      const recalled = selectRecovery(currentPolicyRecords(), task, selectionHistory, minimumPolicyScore);
      if (!recalled) return explorationProvider.decide({ task, observation, history });

      const historical = recoveryOutcomeStats(currentOutcomeRecords(), {
        task,
        trigger: recalled.trigger,
        recovery: recalled.record.recovery
      });
      const policyHealthy = historical.attempts === 0 || historical.confidence >= minimumOutcomeConfidence;

      if (policyHealthy) {
        const decision = await policyProvider.decide({ task, observation, history: selectionHistory });
        return {
          ...decision,
          confidence: historical.attempts
            ? Math.min(Number(decision.confidence || 0), historical.confidence)
            : decision.confidence,
          metadata: {
            ...(decision.metadata || {}),
            triggerActionType: recalled.trigger.actionType,
            triggerTargetLabel: recalled.trigger.targetLabel,
            triggerReasonCode: recalled.trigger.reasonCode,
            triggerEffectStatus: recalled.trigger.effectStatus,
            triggerEffectCodes: recalled.trigger.effectCodes,
            adaptiveRecovery: true,
            policyOutcomeAttempts: historical.attempts,
            policyOutcomeSuccesses: historical.successes,
            policyOutcomeFailures: historical.failures,
            policyOutcomeSuccessRate: historical.successRate,
            policyOutcomeConfidence: historical.confidence,
            minimumOutcomeConfidence,
            policyRejectedByOutcomeHistory: false
          }
        };
      }

      const fallback = await explorationProvider.decide({ task, observation, history });
      return {
        ...fallback,
        metadata: {
          ...(fallback.metadata || {}),
          adaptiveRecovery: true,
          rejectedRecoveryId: recalled.record.recoveryId,
          rejectedRecoveryType: recalled.record.recovery.type,
          policyOutcomeAttempts: historical.attempts,
          policyOutcomeSuccesses: historical.successes,
          policyOutcomeFailures: historical.failures,
          policyOutcomeSuccessRate: historical.successRate,
          policyOutcomeConfidence: historical.confidence,
          minimumOutcomeConfidence,
          policyRejectedByOutcomeHistory: true
        }
      };
    }
  };
}

module.exports = {
  ADAPTIVE_RECOVERY_VERSION,
  recoverySelectionHistory,
  createAdaptiveRecoveryProvider
};
