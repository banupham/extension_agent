'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildBehaviorBatchBaseline } = require('../tools/build_behavior_batch_baseline.js');
const { buildReviewPack } = require('../tools/prepare_strategy_review_pack.js');

function featureSet(actionType, n) {
  const features = actionType === 'scrollVertical'
    ? { family: 'scroll-vertical', timing: { durationMs: 100, gapMedianMs: 20 }, eventCount: 3, absolutePrimaryDelta: 300 + n, primaryDeltaP90: 120, correctionRatio: 0 }
    : { family: 'pointer-click', approach: { durationMs: 120 + n, straightness: 0.9, meanSpeedPxS: 500, meanAbsTurnDeg: 10, correctionCount45Deg: 0 }, acquisitionPauseMs: 30, press: { holdMs: 70 }, acquisition: { endToCenterNormalized: 0.2 }, target: { areaPx2: 5000 } };
  return {
    behaviorFeatureVersion: '0.2.0',
    sourceActionWindowVersion: '0.1.4',
    privacy: { printableHumanKeyContentStored: false, credentialValuesExpected: false, observationLocalIdsStored: false, selectorsStored: false },
    counts: { [actionType]: 1 },
    rows: [{ actionType, context: { hostClass: 'fixture' }, features }]
  };
}

function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'human-next-stage-'));
  const oldCwd = process.cwd();
  try {
    process.chdir(temp);
    const batchDir = path.join(temp, 'batch');
    const behaviorDir = path.join(batchDir, 'behavior');
    const reviewsDir = path.join(temp, 'reviews');
    fs.mkdirSync(behaviorDir, { recursive: true });
    fs.mkdirSync(reviewsDir, { recursive: true });

    const sessions = [];
    for (let i = 0; i < 10; i += 1) {
      const output = path.join(behaviorDir, `s${i}.json`);
      fs.writeFileSync(output, `${JSON.stringify(featureSet(i % 2 ? 'click' : 'scrollVertical', i), null, 2)}\n`, 'utf8');
      sessions.push({ file: `raw/s${i}.raw.jsonl`, status: 'behavior-features-ready', featureRows: 1, output });
    }

    const reviewFile = path.join(reviewsDir, 'one.task-episode-review.json');
    fs.writeFileSync(reviewFile, `${JSON.stringify({
      reviewExportVersion: '0.1.0', episodeId: 'ep-review-1', task: { instruction: 'Open item', type: 'fixture' }, strategyReady: true,
      transitions: [{ transitionId: 't1', status: 'complete', rawAction: { kind: 'dom-click', targetRef: 'e1' }, strategyObservationBefore: { interactiveElements: [{ ref: 'e1', label: 'Item', role: 'button', tag: 'button' }] }, strategyObservationAfter: { interactiveElements: [] }, outcome: { actionSucceeded: true, partial: false } }],
      finalOutcome: { status: 'success' }
    }, null, 2)}\n`, 'utf8');

    const manifestFile = path.join(batchDir, 'manifest.json');
    fs.writeFileSync(manifestFile, `${JSON.stringify({
      batchVersion: '0.2.0',
      behavior: { sourceSessionCount: 10, readySessionCount: 10, featureRowCount: 10, sessions },
      strategy: { reviewFileCount: 1, readyForHumanReviewCount: 1, autoTrainEligibleCount: 0, queue: [{ file: reviewFile, episodeId: 'ep-review-1', queueStatus: 'ready-for-human-review' }] }
    }, null, 2)}\n`, 'utf8');

    const baseline = buildBehaviorBatchBaseline(manifestFile);
    assert.equal(baseline.sourceReadySessionCount, 10);
    assert.equal(baseline.sourceFeatureRowCount, 10);
    assert.ok(baseline.splits.train.sessionCount > 0);
    assert.ok(baseline.splits.validation.sessionCount > 0);
    assert.ok(baseline.splits.test.sessionCount > 0);
    assert.equal(baseline.splitPolicy.trainOnlyUsedForFit, true);
    assert.equal(baseline.privacy.rawTelemetryStored, false);

    const pack = buildReviewPack(manifestFile, path.join(batchDir, 'review-pack'));
    assert.equal(pack.pack.sourceReadyForReviewCount, 1);
    assert.equal(pack.pack.awaitingHumanReviewCount, 1);
    assert.equal(pack.pack.policy.autoTrainEligible, false);
    assert.equal(pack.pack.items[0].proposals[0].proposal.actionTypeHint, 'click');
    assert.equal(pack.pack.items[0].proposals[0].evidence.targetBefore.label, 'Item');
    const template = JSON.parse(fs.readFileSync(path.resolve(pack.pack.items[0].templateFile), 'utf8'));
    assert.equal(template.review.semanticLabelsVerified, false);
    assert.equal(template.steps[0].include, null);

    console.log('Human learning next-stage contract: PASS');
  } finally {
    process.chdir(oldCwd);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error('Human learning next-stage contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { featureSet, main };
