'use strict';

const assert = require('assert');
const {
  fitBaseline
} = require('../tools/fit_strategy_offline_baseline.js');
const {
  diagnoseStep,
  safeActionCandidateSummary
} = require('../tools/diagnose_strategy_action_selection.js');
const {
  scorePrototypes
} = require('../../control-center/manager/strategy/offline_baseline_provider.js');

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

function clickRecord() {
  return {
    episodeId: 'train-click-family',
    task: { instruction: 'Click Launch Control' },
    steps: [{
      stepIndex: 0,
      observation: {
        observationId: 'train-click-observation',
        interactiveElements: [
          { ref: 'click-target', label: 'Launch Control', role: 'button', tag: 'button', visible: true, enabled: true }
        ]
      },
      action: action('click', 'click-target')
    }]
  };
}

function formRecord() {
  const observation = {
    observationId: 'train-form-observation',
    interactiveElements: [
      { ref: 'train-field', label: 'Message Field', role: 'textbox', tag: 'input', editable: true, visible: true, enabled: true }
    ]
  };
  return {
    episodeId: 'train-form-family',
    task: { instruction: 'Type sample into Message Field then press Enter' },
    steps: [
      { stepIndex: 0, observation, action: action('typeText', 'train-field') },
      { stepIndex: 1, observation, action: action('submit', 'train-field') }
    ]
  };
}

const model = fitBaseline([clickRecord(), formRecord()]);
const heldoutRecord = {
  episodeId: 'heldout-action-diagnostic',
  splitGroup: 'synthetic-unseen-action-family',
  task: { instruction: 'Type PRIVATE TASK PHRASE into Query Box and press Enter' }
};
const heldoutStep = {
  stepIndex: 0,
  observation: {
    observationId: 'heldout-observation',
    interactiveElements: [
      {
        ref: 'heldout-field',
        label: 'Query Box',
        role: 'searchbox',
        tag: 'input',
        editable: true,
        visible: true,
        enabled: true,
        selector: 'input#private-selector',
        rect: { x: 123, y: 456, width: 789, height: 321 }
      },
      {
        ref: 'heldout-button',
        label: 'PRIVATE BUTTON LABEL',
        role: 'button',
        tag: 'button',
        editable: false,
        visible: true,
        enabled: true
      }
    ]
  },
  action: action('typeText', 'heldout-field')
};

const detail = diagnoseStep(model, heldoutRecord, heldoutStep, []);
assert.strictEqual(detail.expectedType, 'typeText');
assert.ok(['typeText', 'click'].includes(detail.predictedType));
assert.deepStrictEqual(detail.priorActionTypes, []);
assert.strictEqual(typeof detail.currentTaskFeatures.textEntryIntent, 'boolean');
assert.ok(detail.historyCandidates.some(item => item.type === 'typeText'));
assert.ok(detail.historyCandidates.some(item => item.type === 'click'));
for (const item of detail.historyCandidates) {
  assert.strictEqual(typeof item.score, 'number');
  assert.strictEqual(typeof item.taskFeatureScore, 'number');
  assert.strictEqual(typeof item.semanticTargetScore, 'number');
  assert.strictEqual(typeof item.eligibleTargetCount, 'number');
}

const scored = scorePrototypes(model.historyPrototypes.filter(proto => proto.priorActionTypes.length === 0), heldoutRecord.task, heldoutStep.observation);
const safe = safeActionCandidateSummary(scored[0], heldoutStep.observation, detail.predictedType);
assert.ok(safe.type);
assert.strictEqual(Object.prototype.hasOwnProperty.call(safe, 'instructions'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(safe, 'targetLabels'), false);

const serialized = JSON.stringify(detail);
assert.ok(!serialized.includes('PRIVATE TASK PHRASE'));
assert.ok(!serialized.includes('PRIVATE BUTTON LABEL'));
assert.ok(!serialized.includes('input#private-selector'));
assert.ok(!serialized.includes('123'));
assert.ok(!serialized.includes('456'));
assert.ok(!serialized.includes('789'));
assert.ok(!serialized.includes('321'));
assert.ok(!serialized.includes('"label"'));
assert.ok(!serialized.includes('"selector"'));
assert.ok(!serialized.includes('"rect"'));

console.log('Strategy action-selection diagnostic contract: PASS');
