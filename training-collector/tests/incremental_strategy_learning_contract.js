'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  prepareIncrementalStrategyLearning,
  finalizeIncrementalStrategyLearning,
  resolveReviewInput,
  nextPatchVersion,
  INCREMENTAL_STRATEGY_LEARNING_VERSION
} = require('../tools/prepare_incremental_strategy_learning.js');
const {
  verifyDigest,
  HUMAN_CONFIRMATION_PHRASE
} = require('../tools/prepare_strategy_approval_candidates.js');
const {
  verifyTaskOutcome,
  MACHINE_TRAINING_ELIGIBILITY_VERSION
} = require('../tools/evaluate_machine_training_eligibility.js');

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

function teachingReview(episodeId = 'ep-teaching-tl01') {
  const review = reviewExport(episodeId, 'Xác nhận báo cáo');
  review.task.instruction = 'Mở báo cáo rồi xác nhận báo cáo.';
  review.transitions[0].strategyObservationBefore.url = 'http://127.0.0.1:8791/teaching/TL01';
  review.transitions[0].strategyObservationBefore.title = 'TL01 · Delayed target';
  review.transitions[0].strategyObservationAfter.url = 'http://127.0.0.1:8791/teaching/TL01';
  review.transitions[0].strategyObservationAfter.title = 'PASS_TL01';
  return review;
}

function datasetEpisode(id, splitGroup, split) {
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
      instruction: 'Click Semantic Target',
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
          ref: 'e1',
          role: 'button',
          tag: 'button',
          label: 'Semantic Target',
          rect: { x: 10, y: 20, width: 100, height: 40 },
          visible: true,
          enabled: true
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

function writeReview(dir, name, review) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${JSON.stringify(review, null, 2)}\n`, 'utf8');
  return file;
}

function writeBaseDataset(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const records = {
    'train.jsonl': datasetEpisode('base-train', 'base-group-train', 'train'),
    'validation.jsonl': datasetEpisode('base-validation', 'base-group-validation', 'validation'),
    'test.jsonl': datasetEpisode('base-test', 'base-group-test', 'test')
  };
  for (const [name, record] of Object.entries(records)) {
    fs.writeFileSync(path.join(dir, name), `${JSON.stringify(record)}\n`, 'utf8');
  }
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
    assert.equal(nextPatchVersion('0.3.5'), '0.3.6');
    assert.throws(() => nextPatchVersion('candidate'), /base_model_semver_required/);
    const resolvedDirectory = resolveReviewInput(reviews, out);
    assert.equal(resolvedDirectory.kind, 'directory');
    assert.equal(resolvedDirectory.reviewRoot, path.resolve(reviews));

    const explicitVerified = reviewExport('ep-machine-verified', 'Machine Verified');
    explicitVerified.task.successCriteria = [{ type: 'page', field: 'title', operator: 'equals', value: 'PASS_MACHINE' }];
    explicitVerified.transitions[0].strategyObservationAfter.title = 'PASS_MACHINE';
    const verifiedOutcome = verifyTaskOutcome(explicitVerified);
    assert.equal(verifiedOutcome.status, 'verified');
    assert.equal(verifiedOutcome.source, 'explicit-success-criteria');

    const explicitContradicted = reviewExport('ep-machine-contradicted', 'Machine Contradicted');
    explicitContradicted.task.successCriteria = [{ type: 'page', field: 'title', operator: 'equals', value: 'PASS_EXPECTED' }];
    const contradictedOutcome = verifyTaskOutcome(explicitContradicted);
    assert.equal(contradictedOutcome.status, 'contradicted');

    const genericOnly = reviewExport('ep-machine-generic', 'Generic Evidence');
    genericOnly.transitions[0].strategyObservationAfter.title = 'Changed But Not Goal Verified';
    const genericOutcome = verifyTaskOutcome(genericOnly);
    assert.equal(genericOutcome.status, 'supported');

    const teachingOutcome = verifyTaskOutcome(teachingReview('ep-machine-teaching'));
    assert.equal(teachingOutcome.status, 'verified');
    assert.equal(teachingOutcome.source, 'teaching-lab-deterministic-signal');
    assert.equal(teachingOutcome.scenarioId, 'TL01');

    const ambiguityTeaching = teachingReview('ep-machine-ambiguity');
    ambiguityTeaching.task.instruction = 'Chọn Control Node.';
    ambiguityTeaching.transitions[0].strategyObservationBefore.url = 'http://127.0.0.1:8791/teaching/TL03';
    ambiguityTeaching.transitions[0].strategyObservationAfter.url = 'http://127.0.0.1:8791/teaching/TL03';
    ambiguityTeaching.transitions[0].strategyObservationAfter.title = 'TL03 · Indistinguishable targets';
    const ambiguityOutcome = verifyTaskOutcome(ambiguityTeaching);
    assert.equal(ambiguityOutcome.status, 'unverified');
    assert.equal(ambiguityOutcome.reasons.includes('teaching_lab_ambiguity_is_not_positive_action_training'), true);

    const processedId = 'ep-already-approved';
    const newId = 'ep-new-safe';
    const unsafeId = 'ep-privacy-unsafe';
    const teachingId = 'ep-teaching-safe';

    writeReview(reviews, '01-processed.task-episode-review.json', reviewExport(processedId, 'Processed Action'));
    writeReview(reviews, '02-new-a.task-episode-review.json', reviewExport(newId, 'Launch Beacon'));
    writeReview(reviews, '03-new-duplicate.task-episode-review.json', reviewExport(newId, 'Launch Beacon'));
    writeReview(reviews, '04-unsafe.task-episode-review.json', reviewExport(unsafeId, 'Unsafe Action', { unsafe: true }));
    writeReview(reviews, '05-teaching.task-episode-review.json', teachingReview(teachingId));

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
    assert.equal(bundle.sourceReviewFileCount, 5);
    assert.equal(bundle.retainedReviewFileCount, 3);
    assert.equal(bundle.readyForHumanReviewCount, 2);
    assert.equal(bundle.baseDatasetEpisodeCount, 0);
    assert.equal(bundle.excludedPreviouslyProcessedCount, 1);
    assert.equal(bundle.duplicateCurrentEpisodeCount, 1);
    assert.equal(bundle.candidateEpisodeCount, 2);
    assert.equal(bundle.blockedEpisodeCount, 0);
    assert.equal(bundle.unresolvedHumanReviewCount, 0);
    assert.equal(prepared.machineEligibility.machineTrainingEligibilityVersion, MACHINE_TRAINING_ELIGIBILITY_VERSION);
    assert.equal(bundle.machineAcceptEpisodeCount, 1);
    assert.equal(bundle.machineQuarantineEpisodeCount, 1);
    assert.equal(bundle.machineRejectEpisodeCount, 1);
    assert.deepEqual(prepared.machineEligibility.machineAcceptEpisodeIds, [teachingId]);
    assert.deepEqual(prepared.machineEligibility.quarantineEpisodeIds, [newId]);
    assert.deepEqual(prepared.machineEligibility.rejectEpisodeIds, [unsafeId]);

    assert.equal(prepared.candidates.result.candidateEpisodeCount, 2);
    assert.equal(prepared.candidates.result.candidates.some(item => item.episodeId === newId), true);
    assert.equal(prepared.candidates.result.candidates.some(item => item.episodeId === teachingId), true);
    assert.equal(prepared.candidates.result.candidates.some(item => item.episodeId === processedId), false);
    assert.equal(prepared.candidates.result.candidates.some(item => item.episodeId === unsafeId), false);
    assert.equal(verifyDigest(prepared.candidates.result), true);
    assert.equal(bundle.digestHash, prepared.candidates.result.digestHash);

    assert.equal(bundle.invariants.rawInteractionAutoPromotedToStrategyTraining, false);
    assert.equal(bundle.invariants.privacyBatchAppliedBeforeStrategyCandidate, true);
    assert.equal(bundle.invariants.previouslyProcessedEpisodesExcludedBeforeReviewPack, true);
    assert.equal(bundle.invariants.baseDatasetEpisodesExcludedBeforeReviewPack, null);
    assert.equal(bundle.invariants.duplicateCurrentEpisodeExportsDeduplicated, true);
    assert.equal(bundle.invariants.resolverOutputsAreReviewAidsOnly, true);
    assert.equal(bundle.invariants.candidateDigestVerified, true);
    assert.equal(bundle.invariants.machineEligibilityGateApplied, true);
    assert.equal(bundle.invariants.machineEligibilityFailClosed, true);
    assert.equal(bundle.invariants.machineAcceptedEpisodesAutoTrained, false);
    assert.equal(bundle.invariants.explicitHumanDigestApprovalRequired, true);
    assert.equal(bundle.invariants.approvalApplied, false);
    assert.equal(bundle.invariants.datasetBuilt, false);
    assert.equal(bundle.invariants.trainingPerformed, false);
    assert.equal(bundle.invariants.autoTrainEligible, false);
    assert.equal(bundle.invariants.approvalApplicatorImported, false);
    assert.equal(bundle.invariants.datasetBuilderImported, false);
    assert.equal(bundle.invariants.fitterImported, false);
    assert.equal(fs.existsSync(prepared.machineEligibilityFile), true);

    const cacheFiles = Object.keys(require.cache);
    assert.equal(cacheFiles.some(file => /apply_strategy_approval_candidates\.js$/i.test(file)), false);
    assert.equal(cacheFiles.some(file => /build_(?:incremental_)?strategy_dataset.*\.js$/i.test(file)), false);
    assert.equal(cacheFiles.some(file => /fit_strategy_offline_baseline\.js$/i.test(file)), false);

    const outputs = allFiles(out).map(file => path.basename(file));
    assert.equal(outputs.some(name => /\.strategy-review\.approved\.json$/i.test(name)), false);
    assert.equal(outputs.some(name => /^model\.json$/i.test(name)), false);
    assert.equal(outputs.some(name => /approval-receipt\.json$/i.test(name)), false);
    assert.equal(outputs.some(name => /^train\.jsonl$/i.test(name) || /^validation\.jsonl$/i.test(name) || /^test\.jsonl$/i.test(name)), false);

    const filteredManifest = JSON.parse(fs.readFileSync(path.join(out, '02-incremental-filter', 'incremental-manifest.json'), 'utf8'));
    assert.deepEqual(filteredManifest.strategy.queue.map(item => item.episodeId).sort(), [newId, unsafeId, teachingId].sort());
    assert.equal(filteredManifest.strategy.queue.find(item => item.episodeId === unsafeId).queueStatus, 'blocked-before-review');

    const e2eReviews = path.join(temp, 'e2e-reviews');
    const baseDataset = path.join(temp, 'base-dataset');
    const baseModelFile = path.join(temp, 'base-model.json');
    const e2eOut = path.join(temp, 'e2e-out');
    fs.mkdirSync(e2eReviews, { recursive: true });
    writeReview(e2eReviews, '01-new.task-episode-review.json', reviewExport('ep-e2e-new', 'Semantic Target'));
    writeBaseDataset(baseDataset);
    fs.writeFileSync(baseModelFile, `${JSON.stringify({ modelVersion: '0.3.5', kind: 'test-base-model' }, null, 2)}\n`, 'utf8');
    const baseModelBefore = fs.readFileSync(baseModelFile, 'utf8');

    const e2ePrepared = prepareIncrementalStrategyLearning({
      reviewRoot: e2eReviews,
      baseDatasetDir: baseDataset,
      outputDir: e2eOut
    });
    assert.equal(e2ePrepared.bundle.baseDatasetEpisodeCount, 3);
    assert.equal(e2ePrepared.bundle.candidateEpisodeCount, 1);
    assert.equal(e2ePrepared.bundle.machineAcceptEpisodeCount, 0);
    assert.equal(e2ePrepared.bundle.machineQuarantineEpisodeCount, 1);
    assert.equal(e2ePrepared.bundle.invariants.baseDatasetEpisodesExcludedBeforeReviewPack, true);

    const finalized = finalizeIncrementalStrategyLearning(e2ePrepared, {
      baseDatasetDir: baseDataset,
      baseModelFile,
      confirmationPhrase: HUMAN_CONFIRMATION_PHRASE
    });
    assert.equal(finalized.finalManifest.status, 'candidate-awaiting-runtime-protection');
    assert.equal(finalized.finalManifest.approvedEpisodeCount, 1);
    assert.equal(finalized.finalManifest.baseModel.modelVersion, '0.3.5');
    assert.equal(finalized.finalManifest.baseModel.mutated, false);
    assert.equal(finalized.finalManifest.candidateModel.modelVersion, '0.3.6');
    assert.equal(finalized.finalManifest.candidateModel.heldOutPass, true);
    assert.equal(finalized.finalManifest.dataset.baseSplitAssignmentsPreserved, true);
    assert.equal(finalized.finalManifest.promotion.applied, false);
    assert.equal(finalized.finalManifest.promotion.runtimeRegressionPerformed, false);
    assert.equal(finalized.finalManifest.promotion.freshUnseenPerformed, false);
    assert.equal(fs.readFileSync(baseModelFile, 'utf8'), baseModelBefore);
    assert.equal(fs.existsSync(finalized.candidate.modelFile), true);
    assert.equal(fs.existsSync(finalized.dataset.manifestFile), true);
    assert.equal(fs.existsSync(finalized.finalManifestFile), true);

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

module.exports = { observation, reviewExport, teachingReview, datasetEpisode, writeReview, writeBaseDataset, allFiles, main };
