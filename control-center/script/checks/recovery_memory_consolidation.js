'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  appendRecoveryOutcomeRecord,
  readRecoveryOutcomeMemory
} = require('../../manager/strategy/recovery_outcome_memory.js');
const {
  readRecoverySummaryMemory,
  recoverySummaryStats,
  combinedRecoveryOutcomeStats,
  consolidateRecoveryOutcomeMemory
} = require('../../manager/strategy/recovery_memory_consolidation.js');

function record({ id, observedAt, task, trigger, recoveryType, useful }) {
  return {
    memoryVersion: '0.1.0',
    kind: 'strategy-recovery-outcome',
    source: 'agent-self-experience',
    outcomeId: id,
    observedAt,
    task: { instruction: task.instruction },
    trigger: { ...trigger },
    recovery: { type: recoveryType, targetLabel: null },
    outcome: {
      usefulEffect: useful,
      taskSucceeded: false,
      progressDelta: 0,
      effectStatus: useful ? 'effect_observed' : 'no_effect',
      effectCodes: useful ? ['elements_added'] : []
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-consolidation-'));
  const rawFile = path.join(dir, 'outcomes.jsonl');
  const summaryFile = path.join(dir, 'outcomes.summary.jsonl');
  const halfLifeMs = 1000;
  const nowMs = Date.parse('2026-01-10T00:00:00.000Z');
  const task = { instruction: 'Recover from an opaque UI state' };
  const trigger = {
    actionType: 'click',
    targetLabel: 'Recovery Probe',
    reasonCode: 'action_no_observable_effect',
    effectStatus: 'no_effect',
    effectCodes: ['focus_changed']
  };

  appendRecoveryOutcomeRecord(rawFile, record({
    id: 'old-success',
    observedAt: new Date(nowMs - 4000).toISOString(),
    task,
    trigger,
    recoveryType: 'scrollVertical',
    useful: true
  }));
  appendRecoveryOutcomeRecord(rawFile, record({
    id: 'recent-failure',
    observedAt: new Date(nowMs).toISOString(),
    task,
    trigger,
    recoveryType: 'scrollVertical',
    useful: false
  }));
  appendRecoveryOutcomeRecord(rawFile, record({
    id: 'reinforce-1',
    observedAt: new Date(nowMs - 100).toISOString(),
    task,
    trigger,
    recoveryType: 'scrollHorizontal',
    useful: true
  }));
  appendRecoveryOutcomeRecord(rawFile, record({
    id: 'reinforce-2',
    observedAt: new Date(nowMs).toISOString(),
    task,
    trigger,
    recoveryType: 'scrollHorizontal',
    useful: true
  }));

  const first = consolidateRecoveryOutcomeMemory({
    rawFile,
    summaryFile,
    nowMs,
    halfLifeMs,
    consumeRaw: true
  });
  assert.equal(first.rawRecordCount, 4);
  assert.equal(first.summaryRecordCount, 2);
  assert.equal(readRecoveryOutcomeMemory(rawFile).length, 0);

  const summaries = readRecoverySummaryMemory(summaryFile);
  const vertical = recoverySummaryStats(summaries, {
    task,
    trigger,
    recovery: { type: 'scrollVertical', targetLabel: null }
  }, { nowMs, halfLifeMs });
  assert.equal(vertical.attempts, 2);
  assert.equal(vertical.successes, 1);
  assert.equal(vertical.failures, 1);
  assert.ok(vertical.confidence < 0.5, `recent failure should outweigh stale success: ${vertical.confidence}`);

  const horizontal = recoverySummaryStats(summaries, {
    task,
    trigger,
    recovery: { type: 'scrollHorizontal', targetLabel: null }
  }, { nowMs, halfLifeMs });
  assert.equal(horizontal.attempts, 2);
  assert.equal(horizontal.successes, 2);
  assert.equal(horizontal.failures, 0);
  assert.equal(horizontal.reinforcements, 1);
  assert.ok(horizontal.confidence > 0.5);

  const laterMs = nowMs + 1000;
  appendRecoveryOutcomeRecord(rawFile, record({
    id: 'recent-recovery-success',
    observedAt: new Date(laterMs).toISOString(),
    task,
    trigger,
    recoveryType: 'scrollVertical',
    useful: true
  }));
  const second = consolidateRecoveryOutcomeMemory({
    rawFile,
    summaryFile,
    nowMs: laterMs,
    halfLifeMs,
    consumeRaw: true
  });
  assert.equal(second.rawRecordCount, 1);
  assert.equal(readRecoveryOutcomeMemory(rawFile).length, 0);

  const after = recoverySummaryStats(readRecoverySummaryMemory(summaryFile), {
    task,
    trigger,
    recovery: { type: 'scrollVertical', targetLabel: null }
  }, { nowMs: laterMs, halfLifeMs });
  assert.equal(after.attempts, 3);
  assert.equal(after.successes, 2);
  assert.equal(after.failures, 1);
  assert.equal(after.reinforcements, 1);
  assert.ok(after.confidence > vertical.confidence);
  assert.ok(after.confidence > 0.5);

  appendRecoveryOutcomeRecord(rawFile, record({
    id: 'pending-failure',
    observedAt: new Date(laterMs).toISOString(),
    task,
    trigger,
    recoveryType: 'scrollVertical',
    useful: false
  }));
  const combined = combinedRecoveryOutcomeStats({
    summaryRecords: readRecoverySummaryMemory(summaryFile),
    rawRecords: readRecoveryOutcomeMemory(rawFile),
    task,
    trigger,
    recovery: { type: 'scrollVertical', targetLabel: null },
    nowMs: laterMs,
    halfLifeMs
  });
  assert.equal(combined.attempts, 4);
  assert.equal(combined.successes, 2);
  assert.equal(combined.failures, 2);
  assert.equal(combined.summaryBacked, true);
  assert.ok(combined.confidence < after.confidence);

  const storedText = fs.readFileSync(summaryFile, 'utf8');
  for (const forbidden of ['"selector":', '"selectors":', '"targetRef":', '"tabId":', '"rawCdp":', '"privateReasoning":']) {
    assert.equal(storedText.includes(forbidden), false, `forbidden summary memory field: ${forbidden}`);
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Recovery memory consolidation contract: PASS');
}

main().catch(error => {
  console.error('Recovery memory consolidation contract: FAIL');
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
