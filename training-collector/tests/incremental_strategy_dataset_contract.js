'use strict';

const assert = require('assert');
const {
  DEFAULT_SPLIT_SEED,
  stableNewGroupSplit,
  mergeRecordsPreservingBaseSplits
} = require('../tools/build_incremental_strategy_dataset.js');
const { buildDatasetFromRecords } = require('../tools/build_strategy_episode_dataset.js');

function episode(id, splitGroup, split = 'unassigned') {
  const action = { type: 'click', targetRef: 'e1', args: {} };
  return {
    episodeId: id,
    source: {
      kind: 'human-demonstration',
      labelVerified: true,
      outcomeVerified: true,
      provenanceId: `prov-${id}`
    },
    task: {
      taskId: `task-${id}`,
      type: 'test',
      instruction: 'Click the semantic target',
      args: {},
      successCriteria: [],
      constraints: {},
      metadata: {}
    },
    steps: [{
      stepIndex: 0,
      observation: {
        observationId: `obs-${id}`,
        capturedAt: '2026-08-27T00:00:00.000Z',
        url: 'https://incremental.test/lab',
        title: 'Incremental Lab',
        viewport: { width: 1000, height: 700 },
        scroll: { x: 0, y: 0 },
        focusedElement: null,
        interactiveElements: [{
          ref: 'e1', role: 'button', tag: 'button', label: 'Semantic Target',
          rect: { x: 10, y: 20, width: 100, height: 40 }, visible: true, enabled: true
        }],
        pageSignals: {},
        privacy: { redacted: true }
      },
      decision: { status: 'act', reasonCode: 'verified_click', action },
      action,
      outcome: {
        actionSucceeded: true,
        taskSucceeded: true,
        progress: 1,
        evidence: [],
        errorCode: null,
        metadata: { progressBefore: 0, progressDelta: 1 }
      },
      control: {
        status: 'done', terminal: true, shouldReplan: false,
        reasonCode: 'goal_satisfied', errorCode: null
      },
      budget: {
        status: 'done', terminal: true, shouldReplan: false,
        reasonCode: 'goal_satisfied',
        usage: { steps: 1, replansRequested: 0, consecutiveFailures: 0, stalledSteps: 0, elapsedMs: 50 }
      },
      progress: { before: 0, after: 1, delta: 1 }
    }],
    terminalResult: {
      status: 'done', reasonCode: 'goal_satisfied',
      taskSucceeded: true, finalProgress: 1, verified: true
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

function splitMap(records) {
  return Object.fromEntries(records.map(record => [record.episodeId, record.split]));
}

function main() {
  const base = [
    episode('base-train', 'group-existing-train', 'train'),
    episode('base-validation', 'group-existing-validation', 'validation'),
    episode('base-test', 'group-existing-test', 'test')
  ];
  const initialBaseSplits = splitMap(base);

  const firstNew = [
    episode('new-inherit-validation', 'group-existing-validation'),
    episode('new-independent-a', 'group-independent-a')
  ];
  const first = mergeRecordsPreservingBaseSplits(base, firstNew, { seed: DEFAULT_SPLIT_SEED });

  assert.equal(first.baseSplitAssignmentsPreserved, true);
  assert.deepStrictEqual(splitMap(first.records.slice(0, base.length)), initialBaseSplits);
  assert.equal(first.assignedNewRecords[0].split, 'validation', 'existing semantic group must inherit base split');
  assert.equal(
    first.assignedNewRecords[1].split,
    stableNewGroupSplit('group-independent-a', { seed: DEFAULT_SPLIT_SEED }),
    'new semantic group must use independent stable hash threshold'
  );
  assert.equal(first.inheritedGroupRecordCount, 1);
  assert.equal(first.newGroupRecordCount, 1);

  const firstAssignedSplits = splitMap(first.records);
  const secondNew = [
    episode('new-independent-b', 'group-independent-b'),
    episode('new-inherit-train', 'group-existing-train')
  ];
  const second = mergeRecordsPreservingBaseSplits(first.records, secondNew, { seed: DEFAULT_SPLIT_SEED });

  for (const [episodeId, split] of Object.entries(firstAssignedSplits)) {
    assert.equal(splitMap(second.records)[episodeId], split, `future append must not move ${episodeId}`);
  }
  assert.equal(second.assignedNewRecords[1].split, 'train');
  assert.equal(
    second.assignedNewRecords[0].split,
    stableNewGroupSplit('group-independent-b', { seed: DEFAULT_SPLIT_SEED })
  );

  const packaged = buildDatasetFromRecords(second.records, { createdAt: '2026-08-27T00:00:00.000Z' });
  assert.equal(packaged.state, 'assigned');
  assert.ok(packaged.package.train.length >= 1);
  assert.ok(packaged.package.validation.length >= 1);
  assert.ok(packaged.package.test.length >= 1);
  assert.equal(packaged.package.train.every(record => record.trainingEligibility.eligible === true), true);
  assert.equal(packaged.package.validation.every(record => record.trainingEligibility.eligible === false), true);
  assert.equal(packaged.package.test.every(record => record.trainingEligibility.eligible === false), true);

  assert.throws(
    () => mergeRecordsPreservingBaseSplits(base, [episode('base-train', 'another-group')]),
    /incremental_duplicate_episode_id/
  );

  assert.equal(
    stableNewGroupSplit('group-independent-a', { seed: DEFAULT_SPLIT_SEED }),
    stableNewGroupSplit('group-independent-a', { seed: DEFAULT_SPLIT_SEED }),
    'stable new-group split must not depend on dataset size'
  );

  console.log('Incremental Strategy dataset contract: PASS');
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error('Incremental Strategy dataset contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { episode, splitMap, main };
