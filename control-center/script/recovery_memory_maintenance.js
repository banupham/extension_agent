'use strict';

const path = require('path');
const { parseArgs } = require('./agent_one_action.js');
const {
  DEFAULT_RECOVERY_HALF_LIFE_MS,
  recoverySummaryStats,
  consolidateRecoveryOutcomeMemory
} = require('../manager/strategy/recovery_memory_consolidation.js');

const DEFAULT_OUTCOME_MEMORY_FILE = path.join('training-collector', 'strategy-data', 'recovery-self-learning-v01', 'outcomes.jsonl');
const DEFAULT_OUTCOME_SUMMARY_FILE = path.join('training-collector', 'strategy-data', 'recovery-self-learning-v01', 'outcomes.summary.jsonl');

function compactSummary(record, nowMs, halfLifeMs) {
  const stats = recoverySummaryStats([record], {
    task: record.task,
    trigger: record.trigger,
    recovery: record.recovery
  }, { nowMs, halfLifeMs });
  return {
    summaryId: record.summaryId,
    taskInstruction: record.task.instruction,
    triggerActionType: record.trigger.actionType,
    triggerTargetLabel: record.trigger.targetLabel || null,
    recoveryType: record.recovery.type,
    recoveryTargetLabel: record.recovery.targetLabel || null,
    attempts: stats.attempts,
    successes: stats.successes,
    failures: stats.failures,
    reinforcements: stats.reinforcements,
    confidence: stats.confidence,
    weightedSuccessRate: stats.weightedSuccessRate,
    effectiveEvidence: stats.effectiveEvidence,
    lastObservedAt: stats.lastObservedAt
  };
}

function runMaintenance(options = {}) {
  const rawFile = path.resolve(options.rawFile || DEFAULT_OUTCOME_MEMORY_FILE);
  const summaryFile = path.resolve(options.summaryFile || DEFAULT_OUTCOME_SUMMARY_FILE);
  const halfLifeMs = Number.isFinite(Number(options.halfLifeMs)) && Number(options.halfLifeMs) > 0
    ? Number(options.halfLifeMs)
    : DEFAULT_RECOVERY_HALF_LIFE_MS;
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const result = consolidateRecoveryOutcomeMemory({
    rawFile,
    summaryFile,
    halfLifeMs,
    nowMs,
    consumeRaw: options.consumeRaw !== false
  });
  return {
    ok: true,
    result: 'PASS',
    gate: 'recovery-memory-maintenance',
    rawFile,
    summaryFile,
    consumedRaw: result.consumedRaw,
    rawRecordCount: result.rawRecordCount,
    summaryRecordCount: result.summaryRecordCount,
    halfLifeMs,
    consolidatedAt: result.consolidatedAt,
    summaries: result.summaries.map(record => compactSummary(record, nowMs, halfLifeMs))
  };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = runMaintenance({
    rawFile: args['outcome-memory'] || DEFAULT_OUTCOME_MEMORY_FILE,
    summaryFile: args['outcome-summary'] || DEFAULT_OUTCOME_SUMMARY_FILE,
    halfLifeMs: args['half-life-ms'] == null ? DEFAULT_RECOVERY_HALF_LIFE_MS : Number(args['half-life-ms']),
    consumeRaw: args['keep-raw'] !== true
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      result: 'FAIL',
      gate: 'recovery-memory-maintenance',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_OUTCOME_MEMORY_FILE,
  DEFAULT_OUTCOME_SUMMARY_FILE,
  compactSummary,
  runMaintenance,
  main
};
