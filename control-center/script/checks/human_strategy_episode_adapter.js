'use strict';

const assert = require('assert');
const { adaptHumanReviewToStrategyEpisode } = require('../../manager/training/human_strategy_episode_adapter.js');

function observation(id, elements = []) {
  return {
    observationId: id,
    capturedAt: '2026-08-27T00:00:00.000Z',
    url: 'http://127.0.0.1:8091/',
    title: '',
    viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
    scroll: { x: 0, y: 0 },
    focusedElement: null,
    interactiveElements: elements,
    pageSignals: {},
    privacy: { redacted: true }
  };
}

const submitElement = {
  ref: 'e4', tag: 'button', role: null, label: 'Submit Target', editable: false,
  enabled: true, rendered: true, inViewport: true, interactable: true, visible: true,
  rect: { x: 100, y: 100, width: 120, height: 40 }
};

function reviewExport(finalStatus = 'success') {
  return {
    reviewExportVersion: '0.1.0',
    exportedAt: '2026-08-27T00:00:01.000Z',
    episodeSchemaVersion: '0.6.0',
    episodeId: 'ep-human-1',
    task: { instruction: 'Click Submit Target', type: 'generic', args: {} },
    transitions: [
      {
        transitionId: 'transition-noise', status: 'complete', startedAtMs: 1000, endedAtMs: 1050,
        rawAction: { actionVersion: '0.1.0', kind: 'click', targetRef: 'e16', t: 1025 },
        strategyObservationBefore: observation('noise-before', [submitElement]),
        strategyObservationAfter: observation('noise-after', [submitElement]),
        outcome: { actionSucceeded: true, partial: false }
      },
      {
        transitionId: 'transition-submit', status: 'complete', startedAtMs: 1100, endedAtMs: 1200,
        rawAction: { actionVersion: '0.1.0', kind: 'click', targetRef: 'e4', t: 1150 },
        strategyObservationBefore: observation('submit-before', [submitElement]),
        strategyObservationAfter: observation('submit-after', [submitElement]),
        outcome: { actionSucceeded: true, partial: false }
      }
    ],
    finalOutcome: { status: finalStatus },
    strategyReady: true,
    privacy: {
      sourcePolicyVersion: '0.3.0', rawTextValuesStored: false, passwordValuesStored: false,
      cookiesStored: false, storageSecretsStored: false, authorizationDataStored: false,
      selectorsExported: false, tabIdExported: false, rawActionCoordinatesExported: false
    }
  };
}

function annotation() {
  return {
    contractVersion: '0.1.1',
    episodeId: 'ep-human-1',
    splitGroup: 'human-submit-family-1',
    review: {
      taskPrivacyReviewed: true, semanticLabelsVerified: true, outcomeVerified: true,
      credentialsExcluded: true, secretsExcluded: true
    },
    steps: [
      {
        transitionId: 'transition-noise', include: false,
        exclusionReason: 'incidental_user_action', action: null, outcome: null
      },
      {
        transitionId: 'transition-submit', include: true, exclusionReason: null,
        action: {
          contractVersion: '0.1.0', type: 'click', targetRef: 'e4', args: {},
          intent: 'click Submit Target', expectedOutcome: {}
        },
        outcome: { actionSucceeded: true, taskSucceeded: true, progress: 1, evidence: [], errorCode: null },
        decisionReasonCode: 'reviewed_click_submit_target'
      }
    ]
  };
}

const adapted = adaptHumanReviewToStrategyEpisode(reviewExport(), annotation());
assert.equal(adapted.adapterVersion, '0.1.1');
assert.equal(adapted.provenance.reviewedTransitionCount, 2);
assert.equal(adapted.provenance.includedTransitionCount, 1);
assert.deepEqual(adapted.provenance.excludedTransitions, [{ transitionId: 'transition-noise', reason: 'incidental_user_action' }]);
assert.equal(adapted.record.source.kind, 'human-demonstration');
assert.equal(adapted.record.steps.length, 1);
assert.equal(adapted.record.steps[0].stepIndex, 0);
assert.equal(adapted.record.steps[0].action.type, 'click');
assert.equal(adapted.record.steps[0].action.targetRef, 'e4');
assert.equal(adapted.record.steps[0].control.status, 'done');
assert.equal(adapted.record.steps[0].budget.status, 'done');
assert.deepEqual(adapted.record.steps[0].progress, { before: 0, after: 1, delta: 1 });
assert.equal(adapted.record.terminalResult.status, 'done');
assert.equal(adapted.record.split, 'unassigned');
assert.equal(adapted.record.trainingEligibility.eligible, false);
assert.deepEqual(adapted.record.trainingEligibility.reasons, ['split_not_train']);

assert.throws(() => {
  const bad = annotation();
  bad.steps[0].include = null;
  adaptHumanReviewToStrategyEpisode(reviewExport(), bad);
}, /include must be boolean/);

assert.throws(() => {
  const bad = annotation();
  bad.steps[0].exclusionReason = '';
  adaptHumanReviewToStrategyEpisode(reviewExport(), bad);
}, /exclusionReason/);

assert.throws(() => {
  const bad = annotation();
  bad.steps[1].include = false;
  bad.steps[1].exclusionReason = 'capture_artifact';
  adaptHumanReviewToStrategyEpisode(reviewExport(), bad);
}, /at least one reviewed transition/);

assert.throws(() => {
  const bad = annotation();
  bad.steps[1].action.selector = '#submit';
  adaptHumanReviewToStrategyEpisode(reviewExport(), bad);
}, /selector/);

assert.throws(() => adaptHumanReviewToStrategyEpisode(reviewExport('stopped'), annotation()), /stopped human episode/);

console.log('Human Strategy episode review adapter contract: PASS');
