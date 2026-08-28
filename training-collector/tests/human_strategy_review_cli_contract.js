'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildAnnotationTemplate,
  defaultOutputPath: templateDefaultOutputPath
} = require('../tools/make_strategy_review_template.js');
const {
  adaptFiles,
  defaultOutputPath: adapterDefaultOutputPath
} = require('../tools/adapt_task_episode_review.js');

function observation(id) {
  return {
    observationId: id,
    capturedAt: '2026-08-27T00:00:00.000Z',
    url: 'http://127.0.0.1:8091/',
    title: '',
    viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
    scroll: { x: 0, y: 0 },
    focusedElement: null,
    interactiveElements: [{
      ref: 'e4', tag: 'button', role: null, label: 'Submit Target',
      editable: false, enabled: true, rendered: true, inViewport: true,
      interactable: true, visible: true,
      rect: { x: 100, y: 100, width: 120, height: 40 }
    }],
    pageSignals: {},
    privacy: { redacted: true }
  };
}

const review = {
  reviewExportVersion: '0.1.0',
  exportedAt: '2026-08-27T00:00:01.000Z',
  episodeSchemaVersion: '0.6.0',
  episodeId: 'ep-cli-human-1',
  task: { instruction: 'Click Submit Target', type: 'generic', args: {} },
  transitions: [{
    transitionId: 'transition-1',
    status: 'complete',
    startedAtMs: 1000,
    endedAtMs: 1100,
    rawAction: { actionVersion: '0.1.0', kind: 'click', targetRef: 'e4', t: 1050 },
    strategyObservationBefore: observation('before'),
    strategyObservationAfter: observation('after'),
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

const template = buildAnnotationTemplate(review);
assert.equal(template.contractVersion, '0.1.1');
assert.equal(template.review.semanticLabelsVerified, false);
assert.equal(template.steps[0].include, null);
assert.equal(template.steps[0].action, null);
assert.equal(template.steps[0].outcome, null);
assert.equal(template.steps[0].evidence.rawActionKind, 'click');
assert.equal(template.steps[0].evidence.rawTargetRef, 'e4');
assert.equal(template.steps[0].evidence.targetSummary.label, 'Submit Target');
assert.equal(template.steps[0].evidence.before.interactiveElementCount, 1);
assert.equal(template.steps[0].evidence.after.interactiveElementCount, 1);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-review-cli-'));
const reviewPath = path.join(dir, 'demo.task-episode-review.json');
const annotationPath = path.join(dir, 'demo.strategy-review.json');
fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2));

const verified = JSON.parse(JSON.stringify(template));
verified.splitGroup = 'submit-demo-family';
verified.review = {
  taskPrivacyReviewed: true,
  semanticLabelsVerified: true,
  outcomeVerified: true,
  credentialsExcluded: true,
  secretsExcluded: true
};
verified.steps[0].include = true;
verified.steps[0].action = {
  contractVersion: '0.1.0',
  type: 'click',
  targetRef: 'e4',
  args: {},
  intent: 'click Submit Target',
  expectedOutcome: {}
};
verified.steps[0].outcome = {
  actionSucceeded: true,
  taskSucceeded: true,
  progress: 1,
  evidence: [],
  errorCode: null
};
fs.writeFileSync(annotationPath, JSON.stringify(verified, null, 2));

const adapted = adaptFiles(reviewPath, annotationPath);
assert.equal(adapted.adapterVersion, '0.1.1');
assert.equal(adapted.record.source.kind, 'human-demonstration');
assert.equal(adapted.record.steps[0].action.type, 'click');
assert.equal(adapted.record.terminalResult.status, 'done');
assert.equal(adapted.record.split, 'unassigned');
assert.equal(adapted.record.trainingEligibility.eligible, false);
assert.deepEqual(adapted.record.trainingEligibility.reasons, ['split_not_train']);
assert.ok(templateDefaultOutputPath(reviewPath).endsWith('.task-episode-review.strategy-review.json'));
assert.ok(adapterDefaultOutputPath(reviewPath).endsWith('.task-episode-review.strategy-episode.json'));

console.log('Human Strategy review CLI contract: PASS');
