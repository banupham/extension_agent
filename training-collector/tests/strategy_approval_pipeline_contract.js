'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  prepareApprovalCandidates,
  HUMAN_CONFIRMATION_PHRASE,
  verifyDigest,
  candidateBlockReasons,
  candidateForItem
} = require('../tools/prepare_strategy_approval_candidates.js');
const {
  applyApprovalCandidates,
  annotationForCandidate
} = require('../tools/apply_strategy_approval_candidates.js');
const {
  buildApprovedStrategyDataset
} = require('../tools/build_strategy_dataset_from_approvals.js');
const {
  loadDataset
} = require('../tools/check_strategy_baseline_readiness.js');
const {
  fitBaseline,
  evaluateHeldOut
} = require('../tools/fit_strategy_offline_baseline.js');

function observation(id, label) {
  return {
    observationId: id,
    capturedAt: '2026-08-27T00:00:00.000Z',
    url: 'http://review.test/',
    title: 'Review Test',
    viewport: { width: 1200, height: 800 },
    scroll: { x: 0, y: 0 },
    focusedElement: null,
    interactiveElements: [{
      ref: 'e1', tag: 'button', role: 'button', label,
      editable: false, enabled: true, rendered: true, inViewport: true,
      interactable: true, visible: true,
      rect: { x: 100, y: 100, width: 120, height: 40 }
    }],
    pageSignals: {},
    privacy: { redacted: true, selectorsStored: false, tabIdStored: false }
  };
}

function reviewExport(episodeId, label) {
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
      rawTextValuesStored: false,
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

function draft(episodeId, label, fast = true) {
  return {
    reviewDraftVersion: '0.1.0',
    contractVersion: '0.1.1',
    episodeId,
    task: { instruction: `Click ${label}`, type: 'generic' },
    finalOutcomeStatus: 'success',
    steps: [{
      transitionId: `${episodeId}:t1`,
      include: null,
      action: null,
      outcome: null,
      reviewerAid: {
        reviewClass: fast ? 'fast-label-review' : 'ambiguous-label-review',
        labelConfidence: fast ? 0.95 : 0.35,
        reasons: fast ? [] : ['ambiguous_action_type_hint'],
        semanticTarget: { label, role: 'button', tag: 'button', editable: false, enabled: true, visible: true },
        capturedActionSucceeded: true,
        suggestedAction: fast ? {
          contractVersion: '0.1.0', type: 'click', targetRef: 'e1', args: {}, intent: null, expectedOutcome: {}
        } : null,
        suggestedActionReadyForCopy: fast
      }
    }],
    policy: { autoTrainEligible: false }
  };
}

function mediaStep(episodeId, index, type, label) {
  return {
    transitionId: `${episodeId}:t${index + 1}`,
    include: null,
    action: null,
    outcome: null,
    reviewerAid: {
      reviewClass: 'fast-label-review',
      labelConfidence: type === 'focus' ? 0.85 : 0.95,
      reasons: [],
      semanticTarget: { label, role: 'button', tag: 'button', editable: false, enabled: true, visible: true },
      capturedActionSucceeded: true,
      suggestedAction: {
        contractVersion: '0.1.0', type, targetRef: `e${index + 1}`, args: {}, intent: null, expectedOutcome: {}
      },
      suggestedActionReadyForCopy: true
    }
  };
}

function mediaDraft(episodeId, instruction) {
  const sequence = [
    ['focus', 'Media Play'], ['click', 'Media Play'],
    ['focus', 'Media Mute'], ['click', 'Media Mute'],
    ['focus', 'Media Unmute'], ['click', 'Media Unmute']
  ];
  return {
    reviewDraftVersion: '0.1.0',
    contractVersion: '0.1.1',
    episodeId,
    task: { instruction, type: 'generic' },
    finalOutcomeStatus: 'success',
    steps: sequence.map(([type, label], index) => mediaStep(episodeId, index, type, label)),
    policy: { autoTrainEligible: false }
  };
}

function mediaItem(episodeId, instruction) {
  const draftValue = mediaDraft(episodeId, instruction);
  return {
    episodeId,
    task: { instruction, type: 'generic' },
    finalOutcomeStatus: 'success',
    transitionCount: draftValue.steps.length,
    fastLabelReviewCount: draftValue.steps.length,
    ambiguousLabelReviewCount: 0,
    draftFile: `${episodeId}.draft.json`,
    transitions: draftValue.steps.map(step => ({
      transitionId: step.transitionId,
      reviewClass: 'fast-label-review',
      capturedActionSucceeded: true
    }))
  };
}

function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-approval-pipeline-'));
  const oldCwd = process.cwd();
  try {
    process.chdir(temp);
    const draftsDir = path.join(temp, 'drafts');
    fs.mkdirSync(draftsDir, { recursive: true });
    const items = [];
    const packItems = [];

    for (const [index, label] of ['Alpha', 'Beta', 'Gamma', 'Ambiguous'].entries()) {
      const episodeId = `ep-${index + 1}`;
      const reviewFile = path.join(temp, `${episodeId}.task-episode-review.json`);
      fs.writeFileSync(reviewFile, `${JSON.stringify(reviewExport(episodeId, label), null, 2)}\n`, 'utf8');
      const draftFile = path.join(draftsDir, `${episodeId}.strategy-review.draft.json`);
      const isFast = index < 3;
      fs.writeFileSync(draftFile, `${JSON.stringify(draft(episodeId, label, isFast), null, 2)}\n`, 'utf8');
      items.push({
        episodeId,
        task: { instruction: `Click ${label}`, type: 'generic' },
        finalOutcomeStatus: 'success',
        transitionCount: 1,
        fastLabelReviewCount: isFast ? 1 : 0,
        ambiguousLabelReviewCount: isFast ? 0 : 1,
        draftFile,
        transitions: [{
          transitionId: `${episodeId}:t1`,
          reviewClass: isFast ? 'fast-label-review' : 'ambiguous-label-review',
          actionTypeHint: isFast ? 'click' : 'form-control-review-required',
          targetLabel: label,
          targetRole: 'button',
          targetTag: 'button',
          labelConfidence: isFast ? 0.95 : 0.35,
          capturedActionSucceeded: true,
          suggestedActionReadyForCopy: isFast,
          reasons: isFast ? [] : ['ambiguous_action_type_hint']
        }]
      });
      packItems.push({
        episodeId,
        sourceFile: reviewFile,
        status: 'awaiting-human-review',
        task: { instruction: `Click ${label}`, type: 'generic' },
        finalOutcomeStatus: 'success'
      });
    }

    const draftDigestFile = path.join(temp, 'approval-digest.json');
    fs.writeFileSync(draftDigestFile, `${JSON.stringify({
      reviewDraftVersion: '0.1.0', sourcePack: 'review-pack.json', episodeCount: 4,
      transitionCount: 4, fastLabelReviewCount: 3, ambiguousLabelReviewCount: 1,
      policy: { autoTrainEligible: false }, items
    }, null, 2)}\n`, 'utf8');
    const packFile = path.join(temp, 'review-pack.json');
    fs.writeFileSync(packFile, `${JSON.stringify({ reviewPackVersion: '0.1.0', items: packItems }, null, 2)}\n`, 'utf8');

    const prepared = prepareApprovalCandidates(draftDigestFile, path.join(temp, 'candidates'));
    assert.equal(prepared.result.approvalCandidateVersion, '0.2.0');
    assert.equal(prepared.result.candidateEpisodeCount, 3);
    assert.equal(prepared.result.blockedEpisodeCount, 1);
    assert.equal(prepared.result.policy.autoTrainEligible, false);
    assert.equal(verifyDigest(prepared.result), true);
    assert.equal(prepared.result.candidates.every(item => item.proposedSteps[0].proposedOutcome.metadata.requiresHumanConfirmation === true), true);

    assert.throws(() => applyApprovalCandidates(prepared.jsonFile, path.join(temp, 'bad-annotations'), {
      confirmDigest: prepared.result.digestHash,
      confirmationPhrase: 'YES'
    }), /explicit_human_confirmation_phrase_required/);

    const applied = applyApprovalCandidates(prepared.jsonFile, path.join(temp, 'annotations'), {
      confirmDigest: prepared.result.digestHash,
      confirmationPhrase: HUMAN_CONFIRMATION_PHRASE
    });
    assert.equal(applied.receipt.approvedEpisodeCount, 3);
    assert.equal(applied.receipt.approvedTransitionCount, 3);
    assert.equal(applied.receipt.approvedStrategyStepCount, 3);
    assert.equal(applied.receipt.excludedCaptureNoiseCount, 0);
    assert.equal(applied.receipt.blockedEpisodeCount, 1);
    assert.equal(applied.receipt.explicitHumanConfirmationVerified, true);

    const built = buildApprovedStrategyDataset(packFile, path.join(temp, 'annotations'), path.join(temp, 'strategy-dataset'));
    assert.equal(built.manifest.datasetBuilt, true);
    assert.equal(built.manifest.adaptedEpisodeCount, 3);
    assert.equal(built.manifest.distinctSplitGroupCount, 3);
    assert.equal(built.manifest.baselineReady, true);
    assert.deepEqual(built.manifest.splitCounts, { train: 1, validation: 1, test: 1 });

    const splits = loadDataset(path.join(temp, 'strategy-dataset', 'dataset'));
    assert.equal(splits.train.length, 1);
    assert.equal(splits.validation.length, 1);
    assert.equal(splits.test.length, 1);
    assert.equal([...splits.train, ...splits.validation, ...splits.test].every(record => record.source.kind === 'human-demonstration'), true);
    assert.equal(splits.train[0].trainingEligibility.eligible, true);
    assert.equal(splits.validation[0].trainingEligibility.eligible, false);
    assert.equal(splits.test[0].trainingEligibility.eligible, false);

    const model = fitBaseline(splits.train);
    const evaluation = evaluateHeldOut(model, splits.validation, splits.test);
    assert.equal(model.fitSource, 'train-only');
    assert.equal(model.heldOutUsedForFit, false);
    assert.equal(evaluation.pass, true);
    assert.equal(evaluation.fitPolicy.validationUsedForFit, false);
    assert.equal(evaluation.fitPolicy.testUsedForFit, false);

    // Critical WHAT/HOW boundary: human focus acquisition is capture noise for this task,
    // and clicks on semantic media controls become play/mute/unmute Strategy actions.
    const mediaInstructions = [
      'Start media playback, mute it, then unmute it',
      'Play the media, mute it, and then unmute it',
      'Begin playback, mute the media, then restore sound'
    ];
    const mediaCandidates = mediaInstructions.map((instruction, index) => {
      const episodeId = `media-${index + 1}`;
      const item = mediaItem(episodeId, instruction);
      const draftValue = mediaDraft(episodeId, instruction);
      assert.deepEqual(candidateBlockReasons(item, draftValue), []);
      return candidateForItem(item, draftValue);
    });
    for (const candidate of mediaCandidates) {
      assert.deepEqual(candidate.proposedSteps.map(step => step.proposedInclude), [false, true, false, true, false, true]);
      assert.deepEqual(candidate.proposedSteps.filter(step => step.proposedInclude).map(step => step.proposedAction.type), ['play', 'mute', 'unmute']);
      assert.deepEqual(candidate.proposedSteps.filter(step => step.proposedInclude).map(step => step.proposedOutcome.progress), [1 / 3, 2 / 3, 1]);
      assert.equal(candidate.includedStrategyStepCount, 3);
      assert.equal(candidate.excludedCaptureNoiseCount, 3);
      const annotation = annotationForCandidate(candidate, { digestHash: 'test-digest' });
      assert.deepEqual(annotation.steps.map(step => step.include), [false, true, false, true, false, true]);
      assert.deepEqual(annotation.steps.filter(step => step.include).map(step => step.action.type), ['play', 'mute', 'unmute']);
    }
    assert.equal(new Set(mediaCandidates.map(candidate => candidate.splitGroup)).size, 1);
    assert.equal(mediaCandidates[0].splitGroup, 'semantic-sequence:play:media-play>mute:media-mute>unmute:media-unmute');

    console.log('Strategy approval pipeline contract: PASS');
  } finally {
    process.chdir(oldCwd);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error('Strategy approval pipeline contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { observation, reviewExport, draft, mediaDraft, mediaItem, main };
