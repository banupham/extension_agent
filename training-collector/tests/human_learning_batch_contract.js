'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  sanitizeBehaviorFeatures,
  reviewQueueItem,
  prepareBatch
} = require('../tools/prepare_human_learning_batch.js');

function reviewFixture(overrides = {}) {
  return {
    reviewExportVersion: '0.1.0',
    episodeId: 'ep-human-1',
    strategyReady: true,
    transitions: [
      { transitionId: 't1', status: 'complete' },
      { transitionId: 't2', status: 'complete' }
    ],
    finalOutcome: { status: 'success' },
    privacy: {
      rawTextValuesStored: false,
      passwordValuesStored: false,
      cookiesStored: false,
      storageSecretsStored: false,
      authorizationDataStored: false,
      selectorsExported: false,
      tabIdExported: false,
      rawActionCoordinatesExported: false
    },
    ...overrides
  };
}

function main() {
  const safeFeatures = sanitizeBehaviorFeatures({
    behaviorFeatureVersion: '0.2.0',
    sourceActionWindowVersion: '0.1.4',
    counts: { click: 1 },
    rows: [{
      actionType: 'click',
      context: {
        tabId: 123,
        frameId: 0,
        pageInstanceId: 'page-secret-local-id',
        selector: '#private',
        hostClass: 'video-site',
        nested: { documentId: 'doc-1', safeSignal: 'feed' }
      },
      features: { family: 'pointer-click', printableContentStored: false }
    }]
  });
  assert.equal(safeFeatures.rows.length, 1);
  assert.deepEqual(safeFeatures.rows[0].context, {
    hostClass: 'video-site',
    nested: { safeSignal: 'feed' }
  });
  const serialized = JSON.stringify(safeFeatures);
  for (const forbidden of ['"tabId"', '"frameId"', '"pageInstanceId"', '"documentId"', '"selector"', '#private', 'page-secret-local-id']) {
    assert.equal(serialized.includes(forbidden), false, `forbidden behavior context leaked: ${forbidden}`);
  }

  const ready = reviewQueueItem('/tmp/demo.task-episode-review.json', reviewFixture());
  assert.equal(ready.strategyReady, true);
  assert.equal(ready.privacySafe, true);
  assert.equal(ready.queueStatus, 'ready-for-human-review');
  assert.equal(ready.humanReviewRequired, true);
  assert.equal(ready.strategyAutoTrainEligible, false);
  assert.equal(ready.semanticLabelsVerified, false);
  assert.equal(ready.outcomeProgressReviewed, false);
  assert.equal(ready.splitAssigned, false);

  const unsafe = reviewQueueItem('/tmp/unsafe.task-episode-review.json', reviewFixture({
    privacy: { ...reviewFixture().privacy, passwordValuesStored: true }
  }));
  assert.equal(unsafe.privacySafe, false);
  assert.equal(unsafe.queueStatus, 'blocked-before-review');
  assert.equal(unsafe.strategyAutoTrainEligible, false);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'human-learning-batch-'));
  try {
    const reviews = path.join(temp, 'reviews');
    const out = path.join(temp, 'out');
    fs.mkdirSync(reviews, { recursive: true });
    fs.writeFileSync(
      path.join(reviews, 'training-collector-ep-human-1.task-episode-review.json'),
      `${JSON.stringify(reviewFixture(), null, 2)}\n`,
      'utf8'
    );
    const batch = prepareBatch({ reviewRoot: reviews, outputDir: out });
    assert.equal(batch.manifest.behavior.sourceSessionCount, 0);
    assert.equal(batch.manifest.strategy.reviewFileCount, 1);
    assert.equal(batch.manifest.strategy.readyForHumanReviewCount, 1);
    assert.equal(batch.manifest.strategy.autoTrainEligibleCount, 0);
    assert.equal(batch.manifest.invariants.rawRandomTelemetryAutoPromotedToStrategyTraining, false);
    assert.equal(batch.manifest.invariants.strategyStillRequiresHumanReview, true);
    assert.equal(fs.existsSync(batch.manifestFile), true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }

  console.log('Human learning batch contract: PASS');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('Human learning batch contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { reviewFixture, main };
