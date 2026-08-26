'use strict';

const assert = require('assert');
const {
  adaptHumanReviewToStrategyEpisode
} = require('../../manager/training/human_strategy_episode_adapter.js');

function observation(id, label = 'Submit Target') {
  return {
    observationId: id,
    capturedAt: '2026-08-27T00:00:00.000Z',
    url: 'http://127.0.0.1:8091/',
    title: '',
    viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
    scroll: { x: 0, y: 0 },
    focusedElement: null,
    interactiveElements: [{
      ref: 'e3',
      tag: 'button',
      role: 'button',
      label,
      enabled: true,
      rendered: true,
      inViewport: true,
      interactable: true,
      visible: true,
      rect: { x: 100, y: 100, width: 120, height: 40 }
    }],
    pageSignals: {},
    privacy: {
      redacted: true,
      rawTextValuesStored: false,
      passwordValuesStored: false,
      cookiesStored: false,
      storageSecretsStored: false,
      authorizationDataStored: false,
      selectorsStored: false,
      tabIdStored: false
    }
  };
}

function reviewExport(finalStatus = 'success') {
  return {
    reviewExportVersion: '0.1.0',
    exportedAt: '2026-08-27T00:00:01.000Z',
    episodeSchemaVersion: '0.6.0',
    episodeId: 'ep-human-1',
    task: {
      instruction: 'Click Submit Target',
      type: 'generic',
      args: {}
    },
    transitions: [{
      transitionId: 'transition-1',
      status: 'complete',
      startedAtMs: 1000,
      endedAtMs: 1100,
      rawAction: {
        actionVersion: '0.1.0',
        kind: 'click',
        targetRef: 'raw-e3',
        t: 1050
      },
      strategyObservationBefore: observation('obs-before'),
      strategyObservationAfter: observation('obs-after'),
      outcome: { actionSucceeded: true, partial: false }
    }],
    finalOutcome: { status: finalStatus },
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
    },
    trainingEligibility: { eligible: false },
    reviewRequirements: {
      taskPrivacyReviewed: false,
      semanticLabelsVerified: false,
      outcomeVerified: false,
      splitGroupAssigned: false
    }
  };
}

function annotation() {
  return {
    contractVersion: '0.1.0',
    episodeId: 'ep-human-1',
    splitGroup: 'human-submit-family-1',
    review: {
      taskPrivacyReviewed: true,
      semanticLabelsVerified: true,
      outcomeVerified: true,
      credentialsExcluded: true,
      secretsExcluded: true
    },
    steps: [{
      transitionId: 'transition-1',
      action: {
        contractVersion: '0.1.0',
        type: 'submit',
        targetRef: 'e3',
        args: {},
        intent: 'submit the demonstrated form',
        expectedOutcome: {}
      },
      outcome: {
        actionSucceeded: true,
        taskSucceeded: true,
        progress: 1,
        evidence: [],
        errorCode: null
      },
      decisionReasonCode: 'reviewed_submit_action'
    }]
  };
}

const adapted = adaptHumanReviewToStrategyEpisode(reviewExport(), annotation());
assert.equal(adapted.adapterVersion, '0.1.0');
assert.equal(adapted.provenance.sourceEpisodeId, 'ep-human-1');
assert.equal(adapted.provenance.rawTelemetryPreservedExternally, true);
assert.equal(adapted.record.source.kind, 'human-demonstration');
assert.equal(adapted.record.source.labelVerified, true);
assert.equal(adapted.record.source.outcomeVerified, true);
assert.equal(adapted.record.steps.length, 1);
assert.equal(adapted.record.steps[0].action.type, 'submit');
assert.equal(adapted.record.steps[0].action.targetRef, 'e3');
assert.equal(adapted.record.steps[0].decision.action.type, 'submit');
assert.equal(adapted.record.steps[0].control.status, 'done');
assert.equal(adapted.record.steps[0].control.terminal, true);
assert.equal(adapted.record.steps[0].budget.status, 'done');
assert.equal(adapted.record.steps[0].budget.terminal, true);
assert.deepEqual(adapted.record.steps[0].progress, { before: 0, after: 1, delta: 1 });
assert.equal(adapted.record.terminalResult.status, 'done');
assert.equal(adapted.record.terminalResult.verified, true);
assert.equal(adapted.record.split, 'unassigned');
assert.equal(adapted.record.trainingEligibility.eligible, false);
assert.deepEqual(adapted.record.trainingEligibility.reasons, ['split_not_train']);

// Raw human action remains provenance evidence; it is not silently promoted to the Strategy label.
assert.notEqual(reviewExport().transitions[0].rawAction.targetRef, adapted.record.steps[0].action.targetRef);

assert.throws(() => {
  const bad = annotation();
  bad.review.semanticLabelsVerified = false;
  adaptHumanReviewToStrategyEpisode(reviewExport(), bad);
}, /semanticLabelsVerified must be true/);

assert.throws(() => {
  const bad = annotation();
  bad.steps[0].action.selector = '#submit';
  adaptHumanReviewToStrategyEpisode(reviewExport(), bad);
}, /selector/);

assert.throws(() => {
  const bad = annotation();
  bad.steps[0].outcome.taskSucceeded = false;
  bad.steps[0].outcome.progress = 0;
  adaptHumanReviewToStrategyEpisode(reviewExport(), bad);
}, /not terminal under A5\.2\/A5\.3/);

assert.throws(() => {
  adaptHumanReviewToStrategyEpisode(reviewExport('stopped'), annotation());
}, /stopped human episode/);

assert.throws(() => {
  const badReview = reviewExport();
  badReview.privacy.tabIdExported = true;
  adaptHumanReviewToStrategyEpisode(badReview, annotation());
}, /privacy boundary failed/);

console.log('Human Strategy episode review adapter contract: PASS');
