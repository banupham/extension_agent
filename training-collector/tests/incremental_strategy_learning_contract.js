'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  prepareIncrementalStrategyLearning,
  INCREMENTAL_STRATEGY_LEARNING_VERSION
} = require('../tools/prepare_incremental_strategy_learning.js');
const { verifyDigest } = require('../tools/prepare_strategy_approval_candidates.js');

function observation(id, label) {
  return {
    observationId: id,
    capturedAt: '2026-08-27T00:00:00.000Z',
    url: 'http://incremental.test/',
    title: 'Incremental Test',
    viewport: { width: 1200, height: 800 },
    scroll: { x: 0, y: 0 },
    focusedElement: null,
    interactiveElements: [{
      ref: 'e1',
      tag: 'button',
      role: 'button',
      label,
      editable: false,
      enabled: true,
      rendered: true,
      inViewport: true,
      interactable: true,
      visible: true,
      rect: { x: 100, y: 100, width: 120, height: 40 }
    }],
    pageSignals: {},
    privacy: { redacted: true, selectorsStored: false, tabIdStored: false }
  };
}

function reviewExport(episodeId, label, options = {}) {
  const unsafe = options.unsafe === true;
  return {
    reviewExportVersion: '0.1.0',
    exportedAt: '2026-08-27T00:00:01.000Z',
    episodeSchemaVersion: '0.6.0',
    episodeId,
    task: { instruction: `Click ${label}`, type: 'generic', args: {} },
    transitions: [{
      transitionId: `${episodeId}:t1`,
      status: 'complete',
      startedAtMs: 1000,
      endedAtMs: 1100,
      rawAction: { actionVersion: '0.1.0', kind: 'click', targetRef: 'e1', t: 1050 },
      strategyObservationBefore: observation(`${episodeId}:before`, label),
      strategyObservationAfter: observation(`${episodeId}:after`, label),
      outcome: { actionSucceeded: true, partial: false }
    }],
    finalOutcome: { status: 'success' },
    strategyReady: true,
    privacy: {
      sourcePolicyVersion: '0.3.0',
      rawTextValuesStored: unsafe,
      passwordValuesStored: false,
      cookiesStored: false,
      storageSecretsStored: false,
      authorizationDataStored: false,
      selectorsExported: false,
      tabIdExported: false,
      rawActionCoordinatesExported: false
    }
  };
}

function writeReview(dir, name, review) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${JSON.stringify(review, null, 2)}\n`, 'utf8');
  return file;
}

function allFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const name of fs.readdirSync(current)) {
      const child = path.join(current, name);
      const stat = fs.statSync(child);
      if (stat.isDirectory()) stack.push(child);
      else out.push(child);
    }
  }
  return out.sort();
}

function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'incremental-strategy-learning-'));
  const reviews = path.join(temp, 'reviews');
  const approved = path.join(temp, 'approved');
  const out = path.join(temp, 'out');
  fs.mkdirSync(reviews, { recursive: true });
  fs.mkdirSync(approved, { recursive: true });

  try {
    const processedId = 'ep-already-approved';
    const newId = 'ep-new-safe';
    const unsafeId = 'ep-privacy-unsafe';

    writeReview(reviews, '01-processed.task-episode-review.json', reviewExport(processedId, 'Processed Action'));
    writeReview(reviews, '02-new-a.task-episode-review.json', reviewExport(newId, 'Launch Beacon'));
    writeReview(reviews, '03-new-duplicate.task-episode-review.json', reviewExport(newId, 'Launch Beacon'));
    writeReview(reviews, '04-unsafe.task-episode-review.json', reviewExport(unsafeId, 'Unsafe Action', { unsafe: true }));

    fs.writeFileSync(path.join(approved, `${processedId}.strategy-review.approved.json`), `${JSON.stringify({
      contractVersion: '0.1.1',
      episodeId: processedId
    }, null, 2)}\n`, 'utf8');

    const prepared = prepareIncrementalStrategyLearning({
      reviewRoot: reviews,
      excludeApprovedDir: approved,
      outputDir: out
    });

    const bundle = prepared.bundle;
    assert.equal(bundle.incrementalStrategyLearningVersion, INCREMENTAL_STRATEGY_LEARNING_VERSION);
    assert.equal(bundle.status, 'awaiting-explicit-human-approval');
    assert.equal(bundle.sourceReviewFileCount, 4);
    assert.equal(bundle.retainedReviewFileCount, 2);
    assert.equal(bundle.readyForHumanReviewCount, 1);
    assert.equal(bundle.excludedPreviouslyProcessedCount, 1);
    assert.equal(bundle.duplicateCurrentEpisodeCount, 1);
    assert.equal(bundle.candidateEpisodeCount, 1);
    assert.equal(bundle.blockedEpisodeCount, 0);
    assert.equal(bundle.unresolvedHumanReviewCount, 0);
    assert.equal(bundle.fullyResolvedEpisodeCount, 1);

    assert.equal(prepared.candidates.result.candidateEpisodeCount, 1);
    assert.equal(prepared.candidates.result.candidates[0].episodeId, newId);
    assert.equal(prepared.candidates.result.candidates.some(item => item.episodeId === processedId), false);
    assert.equal(prepared.candidates.result.candidates.some(item => item.episodeId === unsafeId), false);
    assert.equal(verifyDigest(prepared.candidates.result), true);
    assert.equal(bundle.digestHash, prepared.candidates.result.digestHash);

    assert.equal(bundle.invariants.rawInteractionAutoPromotedToStrategyTraining, false);
    assert.equal(bundle.invariants.privacyBatchAppliedBeforeStrategyCandidate, true);
    assert.equal(bundle.invariants.previouslyProcessedEpisodesExcludedBeforeReviewPack, true);
    assert.equal(bundle.invariants.duplicateCurrentEpisodeExportsDeduplicated, true);
    assert.equal(bundle.invariants.resolverOutputsAreReviewAidsOnly, true);
    assert.equal(bundle.invariants.candidateDigestVerified, true);
    assert.equal(bundle.invariants.explicitHumanDigestApprovalRequired, true);
    assert.equal(bundle.invariants.approvalApplied, false);
    assert.equal(bundle.invariants.datasetBuilt, false);
    assert.equal(bundle.invariants.trainingPerformed, false);
    assert.equal(bundle.invariants.autoTrainEligible, false);
    assert.equal(bundle.invariants.approvalApplicatorImported, false);
    assert.equal(bundle.invariants.datasetBuilderImported, false);
    assert.equal(bundle.invariants.fitterImported, false);

    const cacheFiles = Object.keys(require.cache);
    assert.equal(cacheFiles.some(file => /apply_strategy_approval_candidates\.js$/i.test(file)), false);
    assert.equal(cacheFiles.some(file => /build_strategy_dataset_from_approvals\.js$/i.test(file)), false);
    assert.equal(cacheFiles.some(file => /fit_strategy_offline_baseline\.js$/i.test(file)), false);

    const outputs = allFiles(out).map(file => path.basename(file));
    assert.equal(outputs.some(name => /\.strategy-review\.approved\.json$/i.test(name)), false);
    assert.equal(outputs.some(name => /^model\.json$/i.test(name)), false);
    assert.equal(outputs.some(name => /approval-receipt\.json$/i.test(name)), false);
    assert.equal(outputs.some(name => /^train\.jsonl$/i.test(name) || /^validation\.jsonl$/i.test(name) || /^test\.jsonl$/i.test(name)), false);

    const filteredManifest = JSON.parse(fs.readFileSync(path.join(out, '02-incremental-filter', 'incremental-manifest.json'), 'utf8'));
    assert.deepEqual(filteredManifest.strategy.queue.map(item => item.episodeId).sort(), [newId, unsafeId].sort());
    assert.equal(filteredManifest.strategy.queue.find(item => item.episodeId === unsafeId).queueStatus, 'blocked-before-review');

    console.log('Incremental Strategy learning contract: PASS');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error('Incremental Strategy learning contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { observation, reviewExport, writeReview, allFiles, main };
