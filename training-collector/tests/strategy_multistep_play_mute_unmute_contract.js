'use strict';

const assert = require('assert');
const {
  TASKS,
  findSequence,
  applyAnnotation
} = require('../tools/process_strategy_multistep_play_mute_unmute.js');

function obs() {
  return {
    interactiveElements: [
      { ref: 'e6', label: 'Media Play' },
      { ref: 'e8', label: 'Media Mute' },
      { ref: 'e10', label: 'Media Unmute' },
      { ref: 'e9', label: 'Noise' }
    ]
  };
}

const review = {
  task: { instruction: 'Start media playback, mute it, then unmute it' },
  transitions: [
    { transitionId: 'noise', status: 'complete', rawAction: { kind: 'click', targetRef: 'e9' }, strategyObservationBefore: obs() },
    { transitionId: 'play', status: 'complete', rawAction: { kind: 'click', targetRef: 'e6' }, strategyObservationBefore: obs() },
    { transitionId: 'mute', status: 'complete', rawAction: { kind: 'click', targetRef: 'e8' }, strategyObservationBefore: obs() },
    { transitionId: 'unmute', status: 'complete', rawAction: { kind: 'click', targetRef: 'e10' }, strategyObservationBefore: obs() }
  ]
};

const hits = findSequence(review);
assert.deepStrictEqual(hits.map(hit => hit.transitionId), ['play', 'mute', 'unmute']);

const annotation = {
  steps: review.transitions.map(transition => ({
    transitionId: transition.transitionId,
    evidence: { targetSummary: { ref: transition.rawAction.targetRef } }
  }))
};

const result = applyAnnotation(
  annotation,
  review,
  TASKS['Start media playback, mute it, then unmute it'],
  hits
);

assert.strictEqual(result.splitGroup, '8091-multistep-play-mute-unmute-a-v1');
assert.deepStrictEqual(result.taskOverride.metadata.sequence, ['play', 'mute', 'unmute']);
assert.strictEqual(result.taskOverride.successCriteria[0].value, 'UNMUTE PASS');
const included = result.steps.filter(step => step.include === true);
assert.strictEqual(included.length, 3);
assert.deepStrictEqual(included.map(step => step.action.type), ['play', 'mute', 'unmute']);
assert.deepStrictEqual(included.map(step => step.outcome.taskSucceeded), [false, false, true]);
assert.ok(Math.abs(included[0].outcome.progress - (1 / 3)) < 1e-12);
assert.ok(Math.abs(included[1].outcome.progress - (2 / 3)) < 1e-12);
assert.strictEqual(included[2].outcome.progress, 1);
assert.strictEqual(result.steps[0].include, false);

console.log('Strategy multistep play-mute-unmute processor contract: PASS');
