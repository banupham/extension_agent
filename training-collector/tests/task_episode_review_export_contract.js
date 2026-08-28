'use strict';

const assert = require('assert');
const Exporter = require('../core/task_episode_review_export.js');

function keys(value, out = []) {
  if (Array.isArray(value)) {
    value.forEach(item => keys(item, out));
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value)) {
    out.push(key.toLowerCase());
    keys(child, out);
  }
  return out;
}

function main() {
  const episode = {
    schemaVersion: '0.6.0',
    episodeId: 'ep-review',
    tabId: 77,
    task: { instruction: 'Drag Submit', type: 'test', args: {} },
    startedAt: '2026-08-27T00:00:00.000Z',
    endedAt: '2026-08-27T00:00:01.000Z',
    initialObservation: { selector: '#secret' },
    transitions: [{
      transitionId: 't1',
      status: 'complete',
      startedAtMs: 10,
      endedAtMs: 50,
      stateBefore: { selector: '#private-before' },
      stateBeforeDiff: { selectorCandidates: ['#private-diff'] },
      strategyObservationBefore: {
        observationId: 't1-before',
        url: 'https://example.test/lab',
        interactiveElements: [{ ref: 'e1', rect: { x: 10, y: 20, width: 100, height: 40 } }],
        privacy: { redacted: true }
      },
      action: {
        actionVersion: '0.3.0',
        kind: 'drag',
        targetRef: 'e1',
        destinationRef: 'e2',
        t: 10,
        point: { x: 55, y: 66 },
        scroll: { x: 1, y: 2 },
        selector: '#private-action',
        checked: true,
        selectedIndex: 2,
        rangeValue: 70,
        rangeMin: 0,
        rangeMax: 100,
        volume: 0.7,
        playbackRate: 2,
        waitedMs: 1200,
        modifiers: { alt: false, ctrl: true, meta: false, shift: true }
      },
      stateAfter: { selector: '#private-after' },
      strategyObservationAfter: {
        observationId: 't1-after',
        url: 'https://example.test/lab',
        interactiveElements: [{ ref: 'e1', rect: { x: 10, y: 20, width: 100, height: 40 } }],
        privacy: { redacted: true }
      },
      outcome: { actionSucceeded: true, partial: false }
    }],
    finalOutcome: { status: 'success' },
    privacy: {
      policyVersion: '0.3.0',
      rawTextValuesStored: false,
      passwordValuesStored: false,
      cookiesStored: false,
      storageSecretsStored: false,
      authorizationDataStored: false
    }
  };

  const out = Exporter.buildReviewExport(episode, { exportedAt: '2026-08-27T00:00:02.000Z' });
  assert.equal(out.reviewExportVersion, '0.2.0');
  assert.equal(out.strategyReady, true);
  assert.equal(out.trainingEligibility.eligible, false);
  assert.equal(out.transitions[0].rawAction.kind, 'drag');
  assert.equal(out.transitions[0].rawAction.targetRef, 'e1');
  assert.equal(out.transitions[0].rawAction.destinationRef, 'e2');
  assert.equal(out.transitions[0].rawAction.checked, true);
  assert.equal(out.transitions[0].rawAction.selectedIndex, 2);
  assert.equal(out.transitions[0].rawAction.rangeValue, 70);
  assert.equal(out.transitions[0].rawAction.volume, 0.7);
  assert.equal(out.transitions[0].rawAction.playbackRate, 2);
  assert.equal(out.transitions[0].rawAction.waitedMs, 1200);
  assert.deepEqual(out.transitions[0].rawAction.modifiers, { alt: false, ctrl: true, meta: false, shift: true });
  assert.equal(out.transitions[0].rawAction.point, undefined);
  assert.equal(out.privacy.selectorsExported, false);
  assert.equal(out.privacy.tabIdExported, false);
  assert.equal(out.privacy.rawActionCoordinatesExported, false);
  assert.equal(out.privacy.privacySafeMotorMetadataExported, true);

  const allKeys = keys(out);
  assert.equal(allKeys.includes('tabid'), false);
  assert.equal(allKeys.includes('selector'), false);
  assert.equal(allKeys.includes('selectorcandidates'), false);
  assert.equal(allKeys.includes('point'), false);
  assert.equal(JSON.stringify(out).includes('private-action'), false);
  assert.equal(JSON.stringify(out).includes('private-before'), false);

  const oldEpisode = {
    schemaVersion: '0.5.0',
    episodeId: 'ep-old',
    task: {},
    transitions: [{ transitionId: 'old-t1', status: 'complete', action: { kind: 'click' }, outcome: { actionSucceeded: true, partial: false } }],
    finalOutcome: { status: 'success' },
    privacy: {}
  };
  assert.equal(Exporter.buildReviewExport(oldEpisode).strategyReady, false);

  console.log('Task Episode review export contract: PASS');
}

main();
