'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeInstruction, targetLabelForStep, assertNoForbiddenKeys } = require('./self_experience_memory.js');

const RECOVERY_OUTCOME_VERSION = '0.1.0';
const RECOVERY_OUTCOME_KIND = 'strategy-recovery-outcome';

function normalizeCodes(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(Boolean))].sort();
}

function normalizeLabel(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function validateRecoveryOutcomeRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('recovery_outcome_record_required');
  if (record.memoryVersion !== RECOVERY_OUTCOME_VERSION) throw new Error('recovery_outcome_version_unsupported');
  if (record.kind !== RECOVERY_OUTCOME_KIND) throw new Error('recovery_outcome_kind_invalid');
  if (record.source !== 'agent-self-experience') throw new Error('recovery_outcome_source_invalid');
  if (typeof record.outcomeId !== 'string' || !record.outcomeId.trim()) throw new Error('recovery_outcome_id_required');
  if (typeof record?.task?.instruction !== 'string' || !record.task.instruction.trim()) throw new Error('recovery_outcome_task_required');
  if (typeof record?.trigger?.actionType !== 'string' || !record.trigger.actionType.trim()) throw new Error('recovery_outcome_trigger_action_required');
  if (!Array.isArray(record?.trigger?.effectCodes)) throw new Error('recovery_outcome_trigger_codes_required');
  if (typeof record?.recovery?.type !== 'string' || !record.recovery.type.trim()) throw new Error('recovery_outcome_recovery_type_required');
  if (typeof record?.outcome?.usefulEffect !== 'boolean') throw new Error('recovery_outcome_useful_required');
  if (typeof record?.outcome?.taskSucceeded !== 'boolean') throw new Error('recovery_outcome_task_success_required');
  if (!Array.isArray(record?.outcome?.effectCodes)) throw new Error('recovery_outcome_effect_codes_required');
  if (record?.verification?.privacyRedacted !== true) throw new Error('recovery_outcome_privacy_required');
  assertNoForbiddenKeys(record);
  return record;
}

function candidateFingerprint({ task, trigger, recovery } = {}) {
  return crypto.createHash('sha256').update(JSON.stringify({
    task: normalizeInstruction(task?.instruction),
    trigger: {
      actionType: String(trigger?.actionType || '').trim(),
      targetLabel: normalizeInstruction(trigger?.targetLabel),
      reasonCode: String(trigger?.reasonCode || '').trim(),
      effectStatus: String(trigger?.effectStatus || '').trim(),
      effectCodes: normalizeCodes(trigger?.effectCodes)
    },
    recovery: {
      type: String(recovery?.type || '').trim(),
      targetLabel: normalizeInstruction(recovery?.targetLabel)
    }
  })).digest('hex');
}

function appendRecoveryOutcomeRecord(file, record) {
  const validated = validateRecoveryOutcomeRecord(record);
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.appendFileSync(resolved, `${JSON.stringify(validated)}\n`, 'utf8');
  return { appended: true, outcomeId: validated.outcomeId, file: resolved };
}

function readRecoveryOutcomeMemory(file) {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) return [];
  const records = [];
  for (const [index, line] of fs.readFileSync(resolved, 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      records.push(validateRecoveryOutcomeRecord(JSON.parse(line)));
    } catch (error) {
      throw new Error(`recovery_outcome_memory_invalid_line:${index + 1}:${String(error?.message || error)}`);
    }
  }
  return records;
}

function recoveryOutcomeStats(records, { task, trigger, recovery } = {}) {
  const fingerprint = candidateFingerprint({ task, trigger, recovery });
  const matching = (Array.isArray(records) ? records : [])
    .map(validateRecoveryOutcomeRecord)
    .filter(record => candidateFingerprint(record) === fingerprint);
  const attempts = matching.length;
  const successes = matching.filter(record => record.outcome.usefulEffect === true).length;
  const failures = attempts - successes;
  const successRate = attempts ? successes / attempts : null;
  const confidence = (successes + 1) / (attempts + 2); // Beta(1,1) posterior mean.
  return { attempts, successes, failures, successRate, confidence };
}

function decisionTrigger(step) {
  const metadata = step?.decision?.metadata || {};
  const actionType = String(metadata.triggerActionType || '').trim();
  if (!actionType) return null;
  return {
    actionType,
    targetLabel: normalizeLabel(metadata.triggerTargetLabel),
    reasonCode: String(metadata.triggerReasonCode || '').trim(),
    effectStatus: String(metadata.triggerEffectStatus || '').trim() || null,
    effectCodes: normalizeCodes(metadata.triggerEffectCodes)
  };
}

function isRecoveryDecision(step) {
  const source = String(step?.decision?.metadata?.prototypeSource || '').trim();
  return source === 'recoveryExploration' || source === 'recoveryPolicy';
}

function usefulRecoveryStep(step) {
  if (step?.outcome?.taskSucceeded === true) return true;
  if (Number(step?.outcome?.metadata?.progressDelta || 0) > 0) return true;
  const meaningful = Array.isArray(step?.effect?.meaningfulCodes) ? step.effect.meaningfulCodes : [];
  if (meaningful.length > 0) return true;
  return step?.effect?.status === 'effect_observed' && !Array.isArray(step?.effect?.meaningfulCodes);
}

function buildRecoveryOutcomeRecords({ task, result, observedAt = new Date().toISOString() } = {}) {
  if (!task || typeof task.instruction !== 'string' || !task.instruction.trim()) throw new Error('recovery_outcome_task_required');
  if (!result || typeof result !== 'object') throw new Error('recovery_outcome_result_required');
  const records = [];
  for (const step of Array.isArray(result.steps) ? result.steps : []) {
    if (!isRecoveryDecision(step)) continue;
    const trigger = decisionTrigger(step);
    if (!trigger) continue;
    const recovery = {
      type: String(step?.action?.type || step?.decision?.action?.type || '').trim(),
      targetLabel: normalizeLabel(targetLabelForStep(step) || step?.decision?.metadata?.explorationTargetLabel)
    };
    if (!recovery.type) continue;
    const usefulEffect = usefulRecoveryStep(step);
    const base = {
      memoryVersion: RECOVERY_OUTCOME_VERSION,
      kind: RECOVERY_OUTCOME_KIND,
      source: 'agent-self-experience',
      observedAt,
      task: { instruction: task.instruction.trim() },
      trigger,
      recovery,
      outcome: {
        usefulEffect,
        taskSucceeded: step?.outcome?.taskSucceeded === true,
        progressDelta: Number(step?.outcome?.metadata?.progressDelta || 0),
        effectStatus: String(step?.effect?.status || '').trim() || null,
        effectCodes: normalizeCodes(step?.effect?.codes)
      },
      verification: {
        privacyRedacted: true,
        selectorsStored: false,
        rawCoordinatesStored: false,
        observationLocalRefsStored: false,
        privateReasoningStored: false
      }
    };
    const outcomeId = `recovery-outcome-${crypto.createHash('sha256').update(JSON.stringify({
      candidate: candidateFingerprint(base), observedAt, outcome: base.outcome
    })).digest('hex').slice(0, 20)}`;
    records.push(validateRecoveryOutcomeRecord({ ...base, outcomeId }));
  }
  return records;
}

function recordRecoveryOutcomes({ file, task, result, observedAt = new Date().toISOString() } = {}) {
  if (!file) throw new Error('recovery_outcome_memory_file_required');
  const records = buildRecoveryOutcomeRecords({ task, result, observedAt });
  const writes = records.map(record => appendRecoveryOutcomeRecord(file, record));
  return {
    file: path.resolve(file),
    attempted: records.length,
    appended: writes.length,
    records,
    writes
  };
}

module.exports = {
  RECOVERY_OUTCOME_VERSION,
  RECOVERY_OUTCOME_KIND,
  normalizeCodes,
  validateRecoveryOutcomeRecord,
  candidateFingerprint,
  appendRecoveryOutcomeRecord,
  readRecoveryOutcomeMemory,
  recoveryOutcomeStats,
  decisionTrigger,
  isRecoveryDecision,
  usefulRecoveryStep,
  buildRecoveryOutcomeRecords,
  recordRecoveryOutcomes
};
