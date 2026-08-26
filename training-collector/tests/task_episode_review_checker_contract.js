'use strict';

const assert = require('assert');
const { checkReviewExport } = require('../tools/check_task_episode_review.js');

function observation(id) {
  return {
    strategyObservationVersion: '0.1.0',
    observationId: id,
    capturedAt: '2026-08-27T00:00:00.000Z',
    url: 'https://example.test/lab',
    title: '',
    viewport: { width: 1200, height: 800, devicePixelRatio: 1 },
    scroll: { x: 0, y: 0 },
    focusedElement: null,
    interactiveElements: [{
      ref: 'e1', role: 'button', label: 'Submit',
      rect: { x: 10, y: 20, width: 100, height: 40 },
      visible: true, enabled: true
    }],
    pageSignals: {},
    privacy: {
      redacted: true,
      selectorsStored: false,
      tabIdStored: false
    }
  };
}

function validRecord() {
  return {
    reviewExportVersion: '0.1.0',
    exportedAt: '2026-08-27T00:00:01.000Z',
    episodeSchemaVersion: '0.6.0',
    episodeId: 'ep-check',
    task: { instruction: 'Click Submit', type: 'test', args: {} },
    transitions: [{
      transitionId: 't1',
      status: 'complete',
      startedAtMs: 10,
      endedAtMs: 50,
      rawAction: { actionVersion: '0.2.0', kind: 'click', targetRef: 'e1', t: 10 },
      strategyObservationBefore: observation('t1-before'),
      strategyObservationAfter: observation('t1-after'),
      outcome: { actionSucceeded: true, partial: false }
    }],
    finalOutcome: { status: 'success' },
    strategyReady: true,
    privacy: {
      selectorsExported: false,
      tabIdExported: false,
      rawActionCoordinatesExported: false
    },
    trainingEligibility: {
      eligible: false,
      reasons: [
        'human_review_required',
        'semantic_agent_action_labels_required',
        'outcome_progress_review_required',
        'split_assignment_required'
      ]
    }
  };
}

function main() {
  const good = checkReviewExport(validRecord());
  assert.equal(good.ok, true);
  assert.equal(good.summary.transitionCount, 1);
  assert.equal(good.summary.trainingEligible, false);
  assert.equal(good.summary.forbiddenFieldCount, 0);

  const selectorLeak = validRecord();
  selectorLeak.transitions[0].strategyObservationBefore.interactiveElements[0].selector = '#private';
  const badSelector = checkReviewExport(selectorLeak);
  assert.equal(badSelector.ok, false);
  assert.ok(badSelector.errors.some(error => error.includes('forbidden fields present')));

  const pointLeak = validRecord();
  pointLeak.transitions[0].rawAction.point = { x: 1, y: 2 };
  assert.equal(checkReviewExport(pointLeak).ok, false);

  const trainingLeak = validRecord();
  trainingLeak.trainingEligibility.eligible = true;
  assert.equal(checkReviewExport(trainingLeak).ok, false);

  const queryLeak = validRecord();
  queryLeak.transitions[0].strategyObservationAfter.url = 'https://example.test/lab?q=secret';
  const badQuery = checkReviewExport(queryLeak);
  assert.equal(badQuery.ok, false);
  assert.ok(badQuery.errors.some(error => error.includes('must not contain query values')));

  const incomplete = validRecord();
  incomplete.strategyReady = false;
  incomplete.transitions[0].strategyObservationAfter = null;
  assert.equal(checkReviewExport(incomplete).ok, false);

  console.log('Task Episode review checker contract: PASS');
}

main();
