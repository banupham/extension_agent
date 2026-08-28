'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildReviewPack } = require('../tools/prepare_strategy_review_pack.js');
const { scoreReviewPack } = require('../tools/score_strategy_review_pack.js');
const { prepareReviewDrafts } = require('../tools/prepare_strategy_review_drafts.js');

function observation(id) {
  return {
    observationId: id,
    url: 'http://review.test/',
    title: 'Review',
    viewport: { width: 1200, height: 800 },
    scroll: { x: 0, y: 0 },
    interactiveElements: [
      { ref: 'e1', tag: 'button', role: 'button', label: 'Open Result', visible: true, enabled: true },
      { ref: 'e2', tag: 'input', role: 'textbox', label: 'Search', visible: true, enabled: true, editable: true }
    ],
    privacy: { redacted: true }
  };
}

function review() {
  return {
    reviewExportVersion: '0.1.0',
    episodeId: 'ep-draft-1',
    task: { instruction: 'Open the result then inspect the page', type: 'generic', args: {} },
    transitions: [
      {
        transitionId: 't-fast',
        status: 'complete',
        rawAction: { kind: 'click', targetRef: 'e1' },
        strategyObservationBefore: observation('before-fast'),
        strategyObservationAfter: observation('after-fast'),
        outcome: { actionSucceeded: true }
      },
      {
        transitionId: 't-ambiguous',
        status: 'complete',
        rawAction: { kind: 'wheel' },
        strategyObservationBefore: observation('before-wheel'),
        strategyObservationAfter: observation('after-wheel'),
        outcome: { actionSucceeded: true }
      }
    ],
    finalOutcome: { status: 'success' },
    strategyReady: true,
    privacy: {
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

function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-review-draft-'));
  const oldCwd = process.cwd();
  try {
    process.chdir(temp);
    const reviewFile = path.join(temp, 'ep-draft-1.task-episode-review.json');
    fs.writeFileSync(reviewFile, `${JSON.stringify(review(), null, 2)}\n`, 'utf8');
    const manifestFile = path.join(temp, 'manifest.json');
    fs.writeFileSync(manifestFile, `${JSON.stringify({
      strategy: {
        queue: [{
          episodeId: 'ep-draft-1',
          file: reviewFile,
          queueStatus: 'ready-for-human-review'
        }]
      }
    }, null, 2)}\n`, 'utf8');

    const packResult = buildReviewPack(manifestFile, path.join(temp, 'pack'));
    const triage = scoreReviewPack(packResult.packFile);
    const triageFile = path.join(temp, 'pack', 'triage.json');
    fs.writeFileSync(triageFile, `${JSON.stringify(triage, null, 2)}\n`, 'utf8');
    const result = prepareReviewDrafts(packResult.packFile, triageFile, path.join(temp, 'draft-output'));

    assert.equal(result.digest.reviewDraftVersion, '0.1.0');
    assert.equal(result.digest.episodeCount, 1);
    assert.equal(result.digest.transitionCount, 2);
    assert.equal(result.digest.fastLabelReviewCount, 1);
    assert.equal(result.digest.ambiguousLabelReviewCount, 1);
    assert.equal(result.digest.policy.autoTrainEligible, false);
    assert.equal(result.digest.policy.outcomesRequireHumanConfirmation, true);
    assert.equal(result.digest.policy.progressRequiresHumanConfirmation, true);

    const draftFile = path.resolve(result.digest.items[0].draftFile);
    const draft = JSON.parse(fs.readFileSync(draftFile, 'utf8'));
    assert.equal(draft.review.semanticLabelsVerified, false);
    assert.equal(draft.review.outcomeVerified, false);
    assert.equal(draft.policy.suggestionsNeverCountAsHumanVerification, true);
    assert.equal(draft.policy.noStepIncludeAutoApproved, true);

    const fast = draft.steps.find(step => step.transitionId === 't-fast');
    const ambiguous = draft.steps.find(step => step.transitionId === 't-ambiguous');
    assert.equal(fast.include, null);
    assert.equal(fast.action, null);
    assert.equal(fast.outcome, null);
    assert.equal(fast.reviewerAid.reviewClass, 'fast-label-review');
    assert.equal(fast.reviewerAid.suggestedActionReadyForCopy, true);
    assert.equal(fast.reviewerAid.suggestedAction.type, 'click');
    assert.equal(fast.reviewerAid.suggestedAction.targetRef, 'e1');
    assert.equal(fast.reviewerAid.semanticTarget.label, 'Open Result');
    assert.equal(ambiguous.reviewerAid.reviewClass, 'ambiguous-label-review');
    assert.equal(ambiguous.reviewerAid.suggestedAction, null);

    const serialized = JSON.stringify(draft);
    assert.equal(serialized.includes('selector'), false);
    assert.equal(serialized.includes('privateReasoning'), false);
    assert.equal(serialized.includes('chainOfThought'), false);

    const markdown = fs.readFileSync(result.markdownFile, 'utf8');
    assert(markdown.includes('Fast semantic-label review: 1'));
    assert(markdown.includes('Ambiguous semantic-label review: 1'));
    assert(markdown.includes('[FAST 95%] t-fast: click -> Open Result'));
    assert(markdown.includes('[AMBIGUOUS 35%] t-ambiguous'));
    assert(markdown.includes('No transition is auto-approved'));

    console.log('Strategy review draft contract: PASS');
  } finally {
    process.chdir(oldCwd);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error('Strategy review draft contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { observation, review, main };
