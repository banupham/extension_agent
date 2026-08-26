'use strict';

const assert = require('assert');
const { validateDataset } = require('../../manager/training/episode_outcome_dataset.js');
const {
  assignDeterministicSplits,
  evaluateDatasetReadiness,
  buildOfflineBaselinePackage
} = require('../../manager/training/episode_dataset_export.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function episode({
  id,
  split = 'unassigned',
  splitGroup,
  sourceKind = 'approved-controller'
}) {
  const action = { type: 'submit', targetRef: 'e1', args: {} };
  return {
    episodeId: id,
    source: {
      kind: sourceKind,
      labelVerified: true,
      outcomeVerified: true,
      provenanceId: `prov-${id}`,
      collectedAt: '2026-08-27T00:00:00.000Z'
    },
    task: {
      taskId: `task-${id}`,
      type: 'controlled-test',
      instruction: 'Reach SUBMIT PASS',
      args: {},
      successCriteria: [{ type: 'page', field: 'title', operator: 'equals', value: 'SUBMIT PASS' }],
      constraints: {},
      metadata: {}
    },
    steps: [
      {
        stepIndex: 0,
        observation: {
          observationId: `obs-${id}`,
          capturedAt: '2026-08-27T00:00:00.000Z',
          url: 'https://example.test/lab?private=value#fragment',
          title: 'PAGE_CDP Batch Lab',
          viewport: { width: 1200, height: 800 },
          scroll: { x: 0, y: 0 },
          focusedElement: null,
          interactiveElements: [
            {
              ref: 'e1',
              role: 'button',
              label: 'Submit Target',
              rect: { x: 100, y: 200, width: 120, height: 40 },
              visible: true,
              enabled: true
            }
          ],
          pageSignals: {},
          privacy: { redacted: true }
        },
        decision: {
          status: 'act',
          reasonCode: 'verified_submit',
          action: clone(action)
        },
        action: clone(action),
        outcome: {
          actionSucceeded: true,
          taskSucceeded: true,
          progress: 1,
          evidence: [],
          errorCode: null,
          metadata: { progressBefore: 0, progressDelta: 1 }
        },
        control: {
          status: 'done',
          terminal: true,
          shouldReplan: false,
          reasonCode: 'goal_satisfied',
          errorCode: null
        },
        budget: {
          status: 'done',
          terminal: true,
          shouldReplan: false,
          reasonCode: 'goal_satisfied',
          usage: {
            steps: 1,
            replansRequested: 0,
            consecutiveFailures: 0,
            stalledSteps: 0,
            elapsedMs: 100
          }
        },
        progress: { before: 0, after: 1, delta: 1 }
      }
    ],
    terminalResult: {
      status: 'done',
      reasonCode: 'goal_satisfied',
      taskSucceeded: true,
      finalProgress: 1,
      verified: true
    },
    split,
    splitGroup,
    privacy: {
      redacted: true,
      credentialsExcluded: true,
      secretsExcluded: true,
      policyVersion: '0.1.0-test'
    }
  };
}

function mustThrow(fn, expectedText) {
  let error = null;
  try { fn(); } catch (caught) { error = caught; }
  assert.ok(error, `expected error containing ${expectedText}`);
  assert.ok(String(error.message || error).includes(expectedText), String(error.message || error));
}

function main() {
  const raw = Array.from({ length: 10 }, (_, index) => episode({
    id: `ep-${index}`,
    splitGroup: `site-task-group-${index}`
  }));

  const assignedA = assignDeterministicSplits(raw, { seed: 'contract-seed' });
  const assignedB = assignDeterministicSplits(raw, { seed: 'contract-seed' });
  assert.deepEqual(assignedA.assignments, assignedB.assignments);
  assert.equal(assignedA.validation.ok, true);
  assert.equal(assignedA.validation.summary.splitCounts.unassigned, 0);
  assert.equal(assignedA.validation.summary.splitCounts.train, 8);
  assert.equal(assignedA.validation.summary.splitCounts.validation, 1);
  assert.equal(assignedA.validation.summary.splitCounts.test, 1);
  assert.equal(Object.keys(assignedA.assignments).length, 10);

  const readiness = evaluateDatasetReadiness(assignedA.validation);
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.reasons, []);

  const pkg = buildOfflineBaselinePackage(assignedA.validation, {
    createdAt: '2026-08-27T00:00:00.000Z'
  });
  assert.equal(pkg.manifest.splitCounts.train, 8);
  assert.equal(pkg.manifest.splitCounts.validation, 1);
  assert.equal(pkg.manifest.splitCounts.test, 1);
  assert.equal(pkg.train.length, 8);
  assert.equal(pkg.validation.length, 1);
  assert.equal(pkg.test.length, 1);
  assert.equal(pkg.trainJsonl.trim().split('\n').length, 8);
  assert.equal(pkg.validationJsonl.trim().split('\n').length, 1);
  assert.equal(pkg.testJsonl.trim().split('\n').length, 1);
  assert.equal(pkg.train.every(record => record.trainingEligibility.eligible === true), true);
  for (const heldOutId of [...pkg.manifest.episodeIds.validation, ...pkg.manifest.episodeIds.test]) {
    assert.equal(pkg.trainJsonl.includes(heldOutId), false);
  }

  const preassigned = raw.map((record, index) => ({
    ...record,
    split: index === 0 ? 'train' : 'unassigned'
  }));
  mustThrow(() => assignDeterministicSplits(preassigned), 'requires all records to be unassigned');

  const tooFewGroups = raw.slice(0, 2);
  mustThrow(() => assignDeterministicSplits(tooFewGroups), 'at least 3 distinct splitGroup');

  const missingTest = validateDataset([
    episode({ id: 'train-only', split: 'train', splitGroup: 'g-train' }),
    episode({ id: 'validation-only', split: 'validation', splitGroup: 'g-validation' })
  ]);
  const missingTestReadiness = evaluateDatasetReadiness(missingTest);
  assert.equal(missingTestReadiness.ready, false);
  assert.ok(missingTestReadiness.reasons.includes('test_split_missing'));
  mustThrow(() => buildOfflineBaselinePackage(missingTest), 'dataset not ready for offline baseline');

  const untrusted = validateDataset([
    episode({ id: 'unsafe-train', split: 'train', splitGroup: 'u-train', sourceKind: 'controlled-native' }),
    episode({ id: 'safe-validation', split: 'validation', splitGroup: 'u-validation' }),
    episode({ id: 'safe-test', split: 'test', splitGroup: 'u-test' })
  ]);
  assert.equal(untrusted.ok, true);
  const untrustedReadiness = evaluateDatasetReadiness(untrusted);
  assert.equal(untrustedReadiness.ready, false);
  assert.ok(untrustedReadiness.reasons.includes('no_training_eligible_train_record'));
  assert.ok(untrustedReadiness.reasons.some(reason => reason === 'untrusted_or_unverified_record:unsafe-train'));
  mustThrow(() => buildOfflineBaselinePackage(untrusted), 'dataset not ready for offline baseline');

  console.log('Episode dataset split/export contract: PASS');
}

main();
