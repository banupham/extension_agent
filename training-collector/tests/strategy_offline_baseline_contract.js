'use strict';

const assert = require('assert');
const {
  fitBaseline,
  predictAction,
  evaluateHeldOut
} = require('../tools/fit_strategy_offline_baseline.js');

function observation() {
  return {
    observationId: 'obs-1',
    interactiveElements: [
      { ref: 'e4', label: 'Submit Target', visible: true, enabled: true },
      { ref: 'e6', label: 'Dismiss Target', visible: true, enabled: true },
      { ref: 'e7', label: 'Media Play', visible: true, enabled: true },
      { ref: 'e8', label: 'Media Pause', visible: true, enabled: true },
      { ref: 'e9', label: 'Media Mute', visible: true, enabled: true },
      { ref: 'e10', label: 'Media Unmute', visible: true, enabled: true }
    ],
    privacy: { redacted: true }
  };
}

function record(id, instruction, type, targetRef) {
  return {
    episodeId: id,
    task: { instruction },
    steps: [{
      stepIndex: 0,
      observation: observation(),
      action: {
        contractVersion: '0.1.0',
        type,
        targetRef,
        args: {},
        intent: type,
        expectedOutcome: {}
      }
    }]
  };
}

const train = [
  record('train-click', 'Click Submit Target', 'click', 'e4'),
  record('train-pause', 'Pause Media', 'pause', 'e8'),
  record('train-mute', 'Mute Media', 'mute', 'e9'),
  record('train-unmute', 'Unmute Media', 'unmute', 'e10'),
  record('train-play', 'Start media playback', 'play', 'e7'),
  record('train-dismiss', 'Dismiss the target', 'dismiss', 'e6')
];

const model = fitBaseline(train);
assert.strictEqual(model.fitSource, 'train-only');
assert.strictEqual(model.heldOutUsedForFit, false);
assert.strictEqual(model.actionPrototypes.length, 6);

const playPrediction = predictAction(model, { instruction: 'Play Media' }, observation());
assert.strictEqual(playPrediction.action.type, 'play');
assert.strictEqual(playPrediction.action.targetRef, 'e7');

const dismissPrediction = predictAction(model, { instruction: 'Dismiss Dismiss Target' }, observation());
assert.strictEqual(dismissPrediction.action.type, 'dismiss');
assert.strictEqual(dismissPrediction.action.targetRef, 'e6');

const evaluation = evaluateHeldOut(
  model,
  [record('validation-play', 'Play Media', 'play', 'e7')],
  [record('test-dismiss', 'Dismiss Dismiss Target', 'dismiss', 'e6')]
);
assert.strictEqual(evaluation.pass, true);
assert.strictEqual(evaluation.validation.actionTypeAccuracy, 1);
assert.strictEqual(evaluation.validation.exactSemanticAccuracy, 1);
assert.strictEqual(evaluation.test.actionTypeAccuracy, 1);
assert.strictEqual(evaluation.test.exactSemanticAccuracy, 1);

const serializedModel = JSON.stringify(model);
assert.ok(!serializedModel.includes('validation-play'));
assert.ok(!serializedModel.includes('test-dismiss'));

console.log('Strategy offline baseline contract: PASS');
