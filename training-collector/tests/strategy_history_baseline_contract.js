'use strict';

const assert = require('assert');
const {
  fitBaseline,
  predictAction,
  evaluateHeldOut
} = require('../tools/fit_strategy_offline_baseline.js');

function observation(title = 'PAGE_CDP Batch Lab') {
  return {
    observationId: `obs-${title}`,
    title,
    interactiveElements: [
      { ref: 'e6', label: 'Media Play', visible: true, enabled: true },
      { ref: 'e8', label: 'Media Mute', visible: true, enabled: true }
    ],
    privacy: { redacted: true }
  };
}

function action(type, targetRef) {
  return {
    contractVersion: '0.1.0',
    type,
    targetRef,
    args: {},
    intent: type,
    expectedOutcome: {}
  };
}

function record(id, instruction) {
  return {
    episodeId: id,
    task: { instruction },
    steps: [
      { stepIndex: 0, observation: observation(), action: action('play', 'e6') },
      { stepIndex: 1, observation: observation('PLAY PASS'), action: action('mute', 'e8') }
    ]
  };
}

const train = [record('train-sequence', 'Start media playback, then mute it')];
const model = fitBaseline(train);
assert.strictEqual(model.modelVersion, '0.3.1');
assert.strictEqual(model.historyAware, true);
assert.strictEqual(model.actionPrototypes.length, 2);
assert.strictEqual(model.historyPrototypes.length, 2);

const first = predictAction(
  model,
  { instruction: 'Play the media and then mute it' },
  observation(),
  []
);
assert.strictEqual(first.action.type, 'play');
assert.strictEqual(first.action.targetRef, 'e6');
assert.strictEqual(first.evidence.historyMatched, true);
assert.deepStrictEqual(first.evidence.priorActionTypes, []);

const second = predictAction(
  model,
  { instruction: 'Play the media and then mute it' },
  observation('PLAY PASS'),
  [{ actionType: 'play' }]
);
assert.strictEqual(second.action.type, 'mute');
assert.strictEqual(second.action.targetRef, 'e8');
assert.strictEqual(second.evidence.historyMatched, true);
assert.deepStrictEqual(second.evidence.priorActionTypes, ['play']);

const evaluation = evaluateHeldOut(
  model,
  [record('validation-sequence', 'Play the media and then mute it')],
  [record('test-sequence', 'Begin playback before muting the media')]
);
assert.strictEqual(evaluation.pass, true);
assert.strictEqual(evaluation.validation.total, 2);
assert.strictEqual(evaluation.validation.exactSemanticAccuracy, 1);
assert.strictEqual(evaluation.test.total, 2);
assert.strictEqual(evaluation.test.exactSemanticAccuracy, 1);
assert.strictEqual(evaluation.validation.details[1].prototypeSource, 'historyPrototypes');
assert.deepStrictEqual(evaluation.validation.details[1].priorActionTypes, ['play']);

const serialized = JSON.stringify(model);
assert.ok(!serialized.includes('validation-sequence'));
assert.ok(!serialized.includes('test-sequence'));

console.log('Strategy history-aware baseline contract: PASS');