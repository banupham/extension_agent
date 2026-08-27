'use strict';

const fs = require('fs');
const path = require('path');
const {
  candidateFingerprint,
  readRecoveryOutcomeMemory,
  recoveryOutcomeStats,
  validateRecoveryOutcomeRecord
} = require('./recovery_outcome_memory.js');
const { assertNoForbiddenKeys } = require('./self_experience_memory.js');

const RECOVERY_SUMMARY_VERSION = '0.1.0';
const RECOVERY_SUMMARY_KIND = 'strategy-recovery-outcome-summary';
const DEFAULT_RECOVERY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

function finitePositive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isoAt(value, fallbackMs = Date.now()) {
  const ms = Date.parse(String(value || ''));
  return new Date(Number.isFinite(ms) ? ms : fallbackMs).toISOString();
}

function recencyWeight(observedAt, nowMs = Date.now(), halfLifeMs = DEFAULT_RECOVERY_HALF_LIFE_MS) {
  const halfLife = finitePositive(halfLifeMs, DEFAULT_RECOVERY_HALF_LIFE_MS);
  const observedMs = Date.parse(String(observedAt || ''));
  if (!Number.isFinite(observedMs)) return 1;
  const ageMs = Math.max(0, Number(nowMs) - observedMs);
  return Math.pow(0.5, ageMs / halfLife);
}

function validateRecoverySummaryRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('recovery_summary_record_required');
  if (record.memoryVersion !== RECOVERY_SUMMARY_VERSION) throw new Error('recovery_summary_version_unsupported');
  if (record.kind !== RECOVERY_SUMMARY_KIND) throw new Error('recovery_summary_kind_invalid');
  if (record.source !== 'agent-self-experience') throw new Error('recovery_summary_source_invalid');
  if (typeof record.summaryId !== 'string' || !record.summaryId.trim()) throw new Error('recovery_summary_id_required');
  if (typeof record?.task?.instruction !== 'string' || !record.task.instruction.trim()) throw new Error('recovery_summary_task_required');
  if (typeof record?.trigger?.actionType !== 'string' || !record.trigger.actionType.trim()) throw new Error('recovery_summary_trigger_required');
  if (!Array.isArray(record?.trigger?.effectCodes)) throw new Error('recovery_summary_trigger_codes_required');
  if (typeof record?.recovery?.type !== 'string' || !record.recovery.type.trim()) throw new Error('recovery_summary_recovery_required');
  const evidence = record.evidence || {};
  for (const key of ['attempts', 'successes', 'failures', 'weightedSuccesses', 'weightedFailures']) {
    if (!Number.isFinite(Number(evidence[key])) || Number(evidence[key]) < 0) throw new Error(`recovery_summary_evidence_${key}_invalid`);
  }
  if (Number(evidence.successes) + Number(evidence.failures) !== Number(evidence.attempts)) {
    throw new Error('recovery_summary_attempt_balance_invalid');
  }
  if (record?.verification?.privacyRedacted !== true) throw new Error('recovery_summary_privacy_required');
  assertNoForbiddenKeys(record);
  return record;
}

function readRecoverySummaryMemory(file) {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) return [];
  const out = [];
  for (const [index, line] of fs.readFileSync(resolved, 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      out.push(validateRecoverySummaryRecord(JSON.parse(line)));
    } catch (error) {
      throw new Error(`recovery_summary_memory_invalid_line:${index + 1}:${String(error?.message || error)}`);
    }
  }
  return out;
}

function writeRecoverySummaryMemory(file, records) {
  const resolved = path.resolve(file);
  const validated = (Array.isArray(records) ? records : []).map(validateRecoverySummaryRecord);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const tmp = `${resolved}.tmp`;
  const text = validated.length ? `${validated.map(record => JSON.stringify(record)).join('\n')}\n` : '';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, resolved);
  return { file: resolved, recordCount: validated.length };
}

function summaryStatsAt(record, options = {}) {
  if (!record) {
    return {
      exists: false,
      attempts: 0,
      successes: 0,
      failures: 0,
      successRate: null,
      weightedSuccessRate: null,
      effectiveSuccesses: 0,
      effectiveFailures: 0,
      effectiveEvidence: 0,
      confidence: 0.5,
      reinforcements: 0,
      lastObservedAt: null
    };
  }
  const summary = validateRecoverySummaryRecord(record);
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const halfLifeMs = finitePositive(options.halfLifeMs, Number(summary.halfLifeMs) || DEFAULT_RECOVERY_HALF_LIFE_MS);
  const decay = recencyWeight(summary.consolidatedAt, nowMs, halfLifeMs);
  const effectiveSuccesses = Number(summary.evidence.weightedSuccesses) * decay;
  const effectiveFailures = Number(summary.evidence.weightedFailures) * decay;
  const effectiveEvidence = effectiveSuccesses + effectiveFailures;
  return {
    exists: true,
    attempts: Number(summary.evidence.attempts),
    successes: Number(summary.evidence.successes),
    failures: Number(summary.evidence.failures),
    successRate: Number(summary.evidence.attempts) ? Number(summary.evidence.successes) / Number(summary.evidence.attempts) : null,
    weightedSuccessRate: effectiveEvidence ? effectiveSuccesses / effectiveEvidence : null,
    effectiveSuccesses,
    effectiveFailures,
    effectiveEvidence,
    confidence: (effectiveSuccesses + 1) / (effectiveEvidence + 2),
    reinforcements: Number(summary?.reinforcement?.successfulConfirmations || 0),
    firstObservedAt: summary.firstObservedAt || null,
    lastObservedAt: summary.lastObservedAt || null,
    consolidatedAt: summary.consolidatedAt,
    halfLifeMs
  };
}

function recoverySummaryStats(records, query = {}, options = {}) {
  const fingerprint = candidateFingerprint(query);
  const hit = (Array.isArray(records) ? records : [])
    .map(validateRecoverySummaryRecord)
    .find(record => candidateFingerprint(record) === fingerprint) || null;
  return summaryStatsAt(hit, options);
}

function combineOutcomeStats(summaryStats, rawStats) {
  const summary = summaryStats || summaryStatsAt(null);
  const raw = rawStats || { attempts: 0, successes: 0, failures: 0, successRate: null, confidence: 0.5 };
  const attempts = Number(summary.attempts || 0) + Number(raw.attempts || 0);
  const successes = Number(summary.successes || 0) + Number(raw.successes || 0);
  const failures = Number(summary.failures || 0) + Number(raw.failures || 0);
  const effectiveSuccesses = Number(summary.effectiveSuccesses || 0) + Number(raw.successes || 0);
  const effectiveFailures = Number(summary.effectiveFailures || 0) + Number(raw.failures || 0);
  const effectiveEvidence = effectiveSuccesses + effectiveFailures;
  return {
    attempts,
    successes,
    failures,
    successRate: attempts ? successes / attempts : null,
    weightedSuccessRate: effectiveEvidence ? effectiveSuccesses / effectiveEvidence : null,
    effectiveSuccesses,
    effectiveFailures,
    effectiveEvidence,
    confidence: (effectiveSuccesses + 1) / (effectiveEvidence + 2),
    reinforcements: Number(summary.reinforcements || 0),
    summaryBacked: summary.exists === true,
    rawAttempts: Number(raw.attempts || 0)
  };
}

function combinedRecoveryOutcomeStats({ summaryRecords = [], rawRecords = [], task, trigger, recovery, nowMs, halfLifeMs } = {}) {
  const query = { task, trigger, recovery };
  return combineOutcomeStats(
    recoverySummaryStats(summaryRecords, query, { nowMs, halfLifeMs }),
    recoveryOutcomeStats(rawRecords, query)
  );
}

function groupRawRecords(records) {
  const groups = new Map();
  for (const raw of Array.isArray(records) ? records : []) {
    const record = validateRecoveryOutcomeRecord(raw);
    const key = candidateFingerprint(record);
    const bucket = groups.get(key) || [];
    bucket.push(record);
    groups.set(key, bucket);
  }
  return groups;
}

function latestRecord(records) {
  return [...records].sort((a, b) => Date.parse(String(a.observedAt || 0)) - Date.parse(String(b.observedAt || 0))).pop() || null;
}

function consolidateRecoveryOutcomeMemory(options = {}) {
  if (!options.rawFile) throw new Error('recovery_consolidation_raw_file_required');
  if (!options.summaryFile) throw new Error('recovery_consolidation_summary_file_required');
  const rawFile = path.resolve(options.rawFile);
  const summaryFile = path.resolve(options.summaryFile);
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const halfLifeMs = finitePositive(options.halfLifeMs, DEFAULT_RECOVERY_HALF_LIFE_MS);
  const consolidatedAt = new Date(nowMs).toISOString();
  const existing = readRecoverySummaryMemory(summaryFile);
  const rawRecords = readRecoveryOutcomeMemory(rawFile);
  const rawGroups = groupRawRecords(rawRecords);
  const existingByKey = new Map(existing.map(record => [candidateFingerprint(record), record]));
  const keys = new Set([...existingByKey.keys(), ...rawGroups.keys()]);
  const summaries = [];

  for (const key of keys) {
    const previous = existingByKey.get(key) || null;
    const fresh = rawGroups.get(key) || [];
    const previousStats = summaryStatsAt(previous, { nowMs, halfLifeMs });
    const freshSuccesses = fresh.filter(record => record.outcome.usefulEffect === true).length;
    const freshFailures = fresh.length - freshSuccesses;
    const weightedFreshSuccesses = fresh
      .filter(record => record.outcome.usefulEffect === true)
      .reduce((sum, record) => sum + recencyWeight(record.observedAt, nowMs, halfLifeMs), 0);
    const weightedFreshFailures = fresh
      .filter(record => record.outcome.usefulEffect !== true)
      .reduce((sum, record) => sum + recencyWeight(record.observedAt, nowMs, halfLifeMs), 0);
    const semantic = latestRecord(fresh) || previous;
    if (!semantic) continue;
    const totalAttempts = Number(previousStats.attempts || 0) + fresh.length;
    const totalSuccesses = Number(previousStats.successes || 0) + freshSuccesses;
    const totalFailures = Number(previousStats.failures || 0) + freshFailures;
    const allObserved = [
      previous?.firstObservedAt,
      previous?.lastObservedAt,
      ...fresh.map(record => record.observedAt)
    ].filter(Boolean).map(value => isoAt(value, nowMs));
    const firstObservedAt = allObserved.length ? allObserved.slice().sort()[0] : consolidatedAt;
    const lastObservedAt = allObserved.length ? allObserved.slice().sort().pop() : consolidatedAt;
    const latest = latestRecord(fresh);
    const base = {
      memoryVersion: RECOVERY_SUMMARY_VERSION,
      kind: RECOVERY_SUMMARY_KIND,
      source: 'agent-self-experience',
      summaryId: `recovery-summary-${key.slice(0, 20)}`,
      consolidatedAt,
      halfLifeMs,
      task: { instruction: semantic.task.instruction },
      trigger: {
        actionType: semantic.trigger.actionType,
        targetLabel: semantic.trigger.targetLabel || null,
        reasonCode: semantic.trigger.reasonCode || '',
        effectStatus: semantic.trigger.effectStatus || null,
        effectCodes: Array.isArray(semantic.trigger.effectCodes) ? [...semantic.trigger.effectCodes] : []
      },
      recovery: {
        type: semantic.recovery.type,
        targetLabel: semantic.recovery.targetLabel || null
      },
      evidence: {
        attempts: totalAttempts,
        successes: totalSuccesses,
        failures: totalFailures,
        weightedSuccesses: Number(previousStats.effectiveSuccesses || 0) + weightedFreshSuccesses,
        weightedFailures: Number(previousStats.effectiveFailures || 0) + weightedFreshFailures,
        lastUsefulEffect: latest ? latest.outcome.usefulEffect === true : previous?.evidence?.lastUsefulEffect === true,
        lastEffectStatus: latest?.outcome?.effectStatus || previous?.evidence?.lastEffectStatus || null,
        lastEffectCodes: latest ? [...latest.outcome.effectCodes] : [...(previous?.evidence?.lastEffectCodes || [])]
      },
      reinforcement: {
        successfulConfirmations: Math.max(0, totalSuccesses - 1),
        negativeRevisions: totalFailures,
        lastReinforcedAt: totalSuccesses > 1 && lastObservedAt ? lastObservedAt : null
      },
      firstObservedAt,
      lastObservedAt,
      verification: {
        privacyRedacted: true,
        selectorsStored: false,
        rawCoordinatesStored: false,
        observationLocalRefsStored: false,
        privateReasoningStored: false
      }
    };
    summaries.push(validateRecoverySummaryRecord(base));
  }

  summaries.sort((a, b) => a.summaryId.localeCompare(b.summaryId));
  const write = writeRecoverySummaryMemory(summaryFile, summaries);
  const consumeRaw = options.consumeRaw !== false;
  if (consumeRaw) {
    fs.mkdirSync(path.dirname(rawFile), { recursive: true });
    fs.writeFileSync(rawFile, '', 'utf8');
  }
  return {
    version: RECOVERY_SUMMARY_VERSION,
    rawFile,
    summaryFile,
    consumedRaw: consumeRaw,
    rawRecordCount: rawRecords.length,
    summaryRecordCount: summaries.length,
    halfLifeMs,
    consolidatedAt,
    summaries,
    write
  };
}

module.exports = {
  RECOVERY_SUMMARY_VERSION,
  RECOVERY_SUMMARY_KIND,
  DEFAULT_RECOVERY_HALF_LIFE_MS,
  recencyWeight,
  validateRecoverySummaryRecord,
  readRecoverySummaryMemory,
  writeRecoverySummaryMemory,
  summaryStatsAt,
  recoverySummaryStats,
  combineOutcomeStats,
  combinedRecoveryOutcomeStats,
  consolidateRecoveryOutcomeMemory
};
