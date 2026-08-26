'use strict';

const assert = require('assert');
const {
  TASKS,
  findSequence,
  applyAnnotation
} = require('../tools/process_strategy_multistep_play_mute.js');

function obs() {
  return {
    interactiveElements: [
      { ref: 'e6', label: 'Media Play' },
      { ref: 'e8', label: 'Media Mute' },
      { ref: 'e9', label: 'Noise' }
    ]
  };
}

const review = {
  task: { instruction: 'Start media playback, then mute it' },
  transitions: [
    { transitionId: 'noise', status: 'complete', rawAction: { kind: 'click', targetRef: 'e9' }, strategyObservationBefore: obs() },
    { transitionId: 'play', status: 'complete', rawAction: { kind: 'click', targetRef: 'e6' }, strategyObservationBefore: obs() },
    { transitionId: 'mute', status: 'complete', rawAction: { kind: 'click', targetRef: 'e8' }, strategyObservationBefore: obs() }
  ]
};

const hits = findSequence(review);
assert.deepStrictEqual(hits.map(hit => hit.transitionId), ['play', 'mute']);

const annotation = {
  steps: review.transitions.map(transition => ({
    transitionId: transition.transitionId,
    evidence: { targetSummary: { ref: transition.rawAction.targetRef } }
  }))
};

const result = applyAnnotation(
  annotation,
  review,
  TASKS['Start media playback, then mute it'],
  hits
);

assert.strictEqual(result.splitGroup, '8091-multistep-play-mute-a-v1');
assert.deepStrictEqual(result.taskOverride.metadata.sequence, ['play', 'mute']);
const included = result.steps.filter(step => step.include === true);
assert.strictEqual(included.length, 2);
assert.deepStrictEqual(included.map(step => step.action.type), ['play', 'mute']);
assert.deepStrictEqual(included.map(step => step.outcome.progress), [0.5, 1]);
assert.deepStrictEqual(included.map(step => step.outcome.taskSucceeded), [false, true]);
assert.strictEqual(result.steps[0].include, false);
assert.strictEqual(result.steps[0].exclusionReason, 'task_irrelevant_capture_noise');

console.log('Strategy multistep play-mute processor contract: PASS');
