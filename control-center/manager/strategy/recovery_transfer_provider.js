'use strict';

const path = require('path');
const { validateAgentAction } = require('./agent_action_contract.js');
const {
  readRecoveryMemory,
  triggerFromHistory,
  validateRecoveryRecord
} = require('./recovery_policy_memory.js');
const { readRecoveryOutcomeMemory } = require('./recovery_outcome_memory.js');
const {
  readRecoverySummaryMemory,
  combinedRecoveryOutcomeStats
} = require('./recovery_memory_consolidation.js');
const { normalizeInstruction } = require('./self_experience_memory.js');
const { tokens, jaccard } = require('./offline_baseline_provider.js');

const RECOVERY_TRANSFER_VERSION = '0.1.0';
const TRANSFER_SAFE_RECOVERY_TYPES = new Set([
  'waitAndObserve',
  'scrollVertical',
  'scrollHorizontal',
  'reload',
  'back',
  'forward'
]);
const INCIDENTAL_TRIGGER_CODES = new Set(['focus_changed', 'scroll_changed']);

function clamp01(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

function normalizeCodes(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(Boolean))].sort();
}

function structuralCodes(values) {
  return normalizeCodes(values).filter(code => !INCIDENTAL_TRIGGER_CODES.has(code));
}

function labelSimilarity(a, b) {
  const aa = normalizeInstruction(a);
  const bb = normalizeInstruction(b);
  if (!aa && !bb) return 1;
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;
  return jaccard(tokens(aa), tokens(bb));
}

function reasonClass(value) {
  const reason = String(value || '').trim().toLowerCase();
  if (!reason) return '';
  if (reason === 'action_no_observable_effect' || reason.includes('no_observable_effect')) return 'no_effect';
  if (reason.includes('execution') || reason.includes('runtime') || reason.includes('transport')) return 'execution_failed';
  if (reason.includes('blocked') || reason.includes('blocker')) return 'blocked';
  if (reason.includes('target') && reason.includes('missing')) return 'target_missing';
  return reason;
}

function codeSimilarity(a, b) {
  const aa = new Set(structuralCodes(a));
  const bb = new Set(structuralCodes(b));
  if (!aa.size && !bb.size) return 1;
  return jaccard(aa, bb);
}

function generalizedTriggerScore(record, task, trigger) {
  const source = validateRecoveryRecord(record);
  if (!trigger?.actionType || trigger.actionType !== source.trigger.actionType) return null;

  const sourceStatus = String(source.trigger.effectStatus || '').trim();
  const targetStatus = String(trigger.effectStatus || '').trim();
  if (sourceStatus && targetStatus && sourceStatus !== targetStatus) return null;

  const sourceReasonClass = reasonClass(source.trigger.reasonCode);
  const targetReasonClass = reasonClass(trigger.reasonCode);
  if (sourceReasonClass && targetReasonClass && sourceReasonClass !== targetReasonClass) return null;

  const statusScore = sourceStatus && targetStatus && sourceStatus === targetStatus ? 1 : 0.5;
  const reasonScore = sourceReasonClass && targetReasonClass && sourceReasonClass === targetReasonClass ? 1 : 0.5;
  const effectCodeScore = codeSimilarity(source.trigger.effectCodes, trigger.effectCodes);
  const controlScore = String(source.trigger.controlStatus || '').trim() === String(trigger.controlStatus || '').trim() ? 1 : 0;
  const targetScore = labelSimilarity(source.trigger.targetLabel, trigger.targetLabel);
  const structuralScore = (
    statusScore * 0.35 +
    reasonScore * 0.25 +
    effectCodeScore * 0.15 +
    controlScore * 0.10 +
    targetScore * 0.15
  );
  const taskScore = jaccard(tokens(task?.instruction), tokens(source.task.instruction));
  const score = structuralScore * 0.85 + taskScore * 0.15;

  return {
    score,
    structuralScore,
    taskScore,
    statusScore,
    reasonScore,
    effectCodeScore,
    controlScore,
    targetScore
  };
}

function sourceOutcomeStats(record, summaryRecords, rawRecords, options = {}) {
  return combinedRecoveryOutcomeStats({
    summaryRecords,
    rawRecords,
    task: record.task,
    trigger: record.trigger,
    recovery: record.recovery,
    nowMs: options.nowMs,
    halfLifeMs: options.halfLifeMs
  });
}

function selectGeneralizedRecovery(records, task, history = [], options = {}) {
  const trigger = triggerFromHistory(history);
  if (!trigger) return null;
  const minimumTransferScore = clamp01(options.minimumTransferScore, 0.70);
  const minimumSourceConfidence = clamp01(options.minimumSourceConfidence, 0.55);
  const minimumEffectiveEvidence = Number.isFinite(Number(options.minimumEffectiveEvidence))
    ? Math.max(0, Number(options.minimumEffectiveEvidence))
    : 0.5;
  const summaryRecords = Array.isArray(options.summaryRecords) ? options.summaryRecords : [];
  const rawRecords = Array.isArray(options.rawRecords) ? options.rawRecords : [];

  const candidates = [];
  for (const rawRecord of Array.isArray(records) ? records : []) {
    const record = validateRecoveryRecord(rawRecord);
    if (!TRANSFER_SAFE_RECOVERY_TYPES.has(record.recovery.type)) continue;
    const similarity = generalizedTriggerScore(record, task, trigger);
    if (!similarity || similarity.score < minimumTransferScore) continue;
    const historical = sourceOutcomeStats(record, summaryRecords, rawRecords, options);
    if (historical.effectiveEvidence < minimumEffectiveEvidence) continue;
    if (historical.confidence < minimumSourceConfidence) continue;
    const utility = similarity.score * historical.confidence;
    candidates.push({ record, trigger, similarity, historical, utility });
  }

  candidates.sort((a, b) =>
    b.utility - a.utility ||
    b.similarity.score - a.similarity.score ||
    b.historical.confidence - a.historical.confidence ||
    String(b.record.learnedAt || '').localeCompare(String(a.record.learnedAt || ''))
  );
  return candidates[0] || null;
}

function createRecoveryTransferProvider(options = {}) {
  const fallbackProvider = options.fallbackProvider;
  if (!fallbackProvider || typeof fallbackProvider.decide !== 'function') {
    throw new Error('recovery_transfer_fallback_provider_required');
  }

  const staticPolicyRecords = Array.isArray(options.policyRecords) ? options.policyRecords.map(validateRecoveryRecord) : null;
  const policyMemoryFile = options.policyMemoryFile ? path.resolve(options.policyMemoryFile) : null;
  const staticSummaryRecords = Array.isArray(options.summaryRecords) ? options.summaryRecords : null;
  const summaryMemoryFile = options.summaryMemoryFile ? path.resolve(options.summaryMemoryFile) : null;
  const staticRawRecords = Array.isArray(options.rawRecords) ? options.rawRecords : null;
  const rawMemoryFile = options.rawMemoryFile ? path.resolve(options.rawMemoryFile) : null;

  function currentPolicyRecords() {
    return staticPolicyRecords || (policyMemoryFile ? readRecoveryMemory(policyMemoryFile) : []);
  }

  function currentSummaryRecords() {
    return staticSummaryRecords || (summaryMemoryFile ? readRecoverySummaryMemory(summaryMemoryFile) : []);
  }

  function currentRawRecords() {
    return staticRawRecords || (rawMemoryFile ? readRecoveryOutcomeMemory(rawMemoryFile) : []);
  }

  return {
    name: 'generalized-recovery-transfer',
    version: RECOVERY_TRANSFER_VERSION,

    async decide({ task, observation, history = [] }) {
      const selected = selectGeneralizedRecovery(currentPolicyRecords(), task, history, {
        summaryRecords: currentSummaryRecords(),
        rawRecords: currentRawRecords(),
        minimumTransferScore: options.minimumTransferScore,
        minimumSourceConfidence: options.minimumSourceConfidence,
        minimumEffectiveEvidence: options.minimumEffectiveEvidence,
        nowMs: options.nowMs,
        halfLifeMs: options.halfLifeMs
      });

      if (!selected) return fallbackProvider.decide({ task, observation, history });

      const action = validateAgentAction({
        contractVersion: '0.1.0',
        type: selected.record.recovery.type,
        targetRef: null,
        args: {},
        intent: `generalized-recovery-transfer:${selected.record.recovery.type}`,
        expectedOutcome: {}
      });

      return {
        status: 'act',
        action,
        targetRef: null,
        confidence: Math.min(selected.similarity.score, selected.historical.confidence),
        reasonCode: 'generalized_recovery_transfer',
        expectedOutcome: {},
        recovery: {},
        metadata: {
          prototypeSource: 'recoveryTransfer',
          sourceRecoveryId: selected.record.recoveryId,
          recoveryType: selected.record.recovery.type,
          transferScore: selected.similarity.score,
          structuralTriggerScore: selected.similarity.structuralScore,
          sourceTaskSimilarity: selected.similarity.taskScore,
          triggerTargetSimilarity: selected.similarity.targetScore,
          sourceOutcomeAttempts: selected.historical.attempts,
          sourceOutcomeSuccesses: selected.historical.successes,
          sourceOutcomeFailures: selected.historical.failures,
          sourceOutcomeConfidence: selected.historical.confidence,
          sourceEffectiveEvidence: selected.historical.effectiveEvidence,
          sourceSummaryBacked: selected.historical.summaryBacked === true,
          crossTaskTransfer: selected.similarity.taskScore < 0.55
        }
      };
    }
  };
}

module.exports = {
  RECOVERY_TRANSFER_VERSION,
  TRANSFER_SAFE_RECOVERY_TYPES,
  INCIDENTAL_TRIGGER_CODES,
  normalizeCodes,
  structuralCodes,
  labelSimilarity,
  reasonClass,
  codeSimilarity,
  generalizedTriggerScore,
  sourceOutcomeStats,
  selectGeneralizedRecovery,
  createRecoveryTransferProvider
};
