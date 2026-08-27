'use strict';

const assert = require('assert');
const {
  fitBaseline,
  predictAction,
  evaluateHeldOut,
  chooseTargetRef
} = require('../tools/fit_strategy_offline_baseline.js');
const {
  safeCandidateSummary
} = require('../tools/diagnose_strategy_target_grounding.js');

// The collector observer is browser-oriented, but its text-entry semantic classifier is pure.
delete globalThis.TrainingCollectorV02;
delete globalThis.TrainingCollectorV04;
require('../observer/semantic_observer.js');
const { textEntryEditableFromSemantics } = globalThis.TrainingCollectorV02.SemanticObserver;

assert.strictEqual(textEntryEditableFromSemantics({ tag: 'input', inputType: 'text' }), true);
assert.strictEqual(textEntryEditableFromSemantics({ tag: 'input', inputType: 'search' }), true);
assert.strictEqual(textEntryEditableFromSemantics({ tag: 'textarea' }), true);
assert.strictEqual(textEntryEditableFromSemantics({ tag: 'div', isContentEditable: true }), true);
assert.strictEqual(textEntryEditableFromSemantics({ tag: 'select' }), false);
assert.strictEqual(textEntryEditableFromSemantics({ tag: 'input', inputType: 'button' }), false);
assert.strictEqual(textEntryEditableFromSemantics({ tag: 'input', inputType: 'submit' }), false);
assert.strictEqual(textEntryEditableFromSemantics({ tag: 'input', inputType: 'checkbox' }), false);

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

function record(id, instruction, type, targetRef) {
  return {
    episodeId: id,
    task: { instruction },
    steps: [{
      stepIndex: 0,
      observation: observation(),
      action: action(type, targetRef)
    }]
  };
}

function formObservation(fieldRef, fieldLabel, suffix) {
  return {
    observationId: `form-${suffix}`,
    interactiveElements: [
      { ref: fieldRef, label: fieldLabel, role: 'textbox', tag: 'input', editable: true, visible: true, enabled: true },
      { ref: `b-${suffix}`, label: 'Primary Action', role: 'button', tag: 'button', editable: false, visible: true, enabled: true },
      { ref: `l-${suffix}`, label: 'Help Link', role: 'link', tag: 'a', editable: false, visible: true, enabled: true }
    ],
    privacy: { redacted: true }
  };
}

function formRecord(id, instruction, fieldRef, fieldLabel, suffix) {
  const obs = formObservation(fieldRef, fieldLabel, suffix);
  return {
    episodeId: id,
    task: { instruction },
    steps: [
      { stepIndex: 0, observation: obs, action: action('typeText', fieldRef) },
      { stepIndex: 1, observation: obs, action: action('submit', fieldRef) }
    ]
  };
}

function adversarialFormObservation() {
  const instruction = 'Type hidden value into Destination and press Enter';
  return {
    instruction,
    observation: {
      observationId: 'form-adversarial',
      interactiveElements: [
        { ref: 'editable-destination', label: 'Destination', role: 'textbox', tag: 'input', editable: true, visible: true, enabled: true },
        { ref: 'label-distractor', label: instruction, role: 'button', tag: 'button', editable: false, visible: true, enabled: true },
        { ref: 'help-distractor', label: 'Destination Help', role: 'link', tag: 'a', editable: false, visible: true, enabled: true }
      ],
      privacy: { redacted: true }
    }
  };
}

const train = [
  record('train-click', 'Click Submit Target', 'click', 'e4'),
  record('train-pause', 'Pause Media', 'pause', 'e8'),
  record('train-mute', 'Mute Media', 'mute', 'e9'),
  record('train-unmute', 'Unmute Media', 'unmute', 'e10'),
  record('train-play', 'Start media playback', 'play', 'e7'),
  record('train-dismiss', 'Dismiss the target', 'dismiss', 'e6'),
  formRecord('train-form', 'Type sample into Message Field then press Enter', 'train-field', 'Message Field', 'train')
];

const model = fitBaseline(train);
assert.strictEqual(model.modelVersion, '0.3.2');
assert.strictEqual(model.fitSource, 'train-only');
assert.strictEqual(model.heldOutUsedForFit, false);
assert.strictEqual(model.localTargetRefsPersisted, false);
assert.strictEqual(model.targetGroundingPolicy, 'current-task-dominant-with-action-affordance');
assert.strictEqual(model.actionPrototypes.length, 8);

const playPrediction = predictAction(model, { instruction: 'Play Media' }, observation());
assert.strictEqual(playPrediction.action.type, 'play');
assert.strictEqual(playPrediction.action.targetRef, 'e7');

const dismissPrediction = predictAction(model, { instruction: 'Dismiss Dismiss Target' }, observation());
assert.strictEqual(dismissPrediction.action.type, 'dismiss');
assert.strictEqual(dismissPrediction.action.targetRef, 'e6');

const unseenFormObservation = formObservation('heldout-field', 'Query Entry', 'heldout');
const first = predictAction(
  model,
  { instruction: 'Fill a query into Query Entry and press Enter' },
  unseenFormObservation,
  []
);
assert.strictEqual(first.action.type, 'typeText');
assert.strictEqual(first.action.targetRef, 'heldout-field');

const second = predictAction(
  model,
  { instruction: 'Fill a query into Query Entry and press Enter' },
  unseenFormObservation,
  [{ actionType: first.action.type, targetRef: first.action.targetRef, action: first.action }]
);
assert.strictEqual(second.action.type, 'submit');
assert.strictEqual(second.action.targetRef, 'heldout-field');

const adversarial = adversarialFormObservation();
const adversarialFirst = predictAction(
  model,
  { instruction: adversarial.instruction },
  adversarial.observation,
  []
);
assert.strictEqual(adversarialFirst.action.type, 'typeText');
assert.strictEqual(adversarialFirst.action.targetRef, 'editable-destination');

const typeTextProto = model.actionPrototypes.find(proto => proto.type === 'typeText');
assert.ok(typeTextProto);
assert.strictEqual(chooseTargetRef(
  typeTextProto,
  { instruction: adversarial.instruction },
  {
    observationId: 'no-editable-target',
    interactiveElements: [
      { ref: 'button-only', label: adversarial.instruction, role: 'button', tag: 'button', editable: false, visible: true, enabled: true }
    ],
    privacy: { redacted: true }
  },
  []
), null);

// Old collector snapshots may have stale editable=true on input controls that are semantically buttons.
// Role/input semantics must veto that stale boolean rather than letting text actions target the control.
const staleEditableButtonObservation = {
  observationId: 'stale-editable-button',
  interactiveElements: [
    { ref: 'lookup-field', label: 'Lookup Box', role: 'combobox', tag: 'textarea', editable: true, visible: true, enabled: true },
    { ref: 'stale-button', label: 'Lookup Box Action', role: 'button', tag: 'input', editable: true, visible: true, enabled: true },
    { ref: 'weak-input', label: 'Account Preference', role: null, tag: 'input', editable: true, visible: true, enabled: true }
  ],
  privacy: { redacted: true }
};
const staleButtonPrediction = predictAction(
  model,
  { instruction: 'Type a value into Lookup Box and press Enter' },
  staleEditableButtonObservation,
  []
);
assert.strictEqual(staleButtonPrediction.action.type, 'typeText');
assert.strictEqual(staleButtonPrediction.action.targetRef, 'lookup-field');

// A target whose label matches TRAIN exactly must not beat a different editable target named by the current task.
const learnedLabelDistractorObservation = {
  observationId: 'learned-label-distractor',
  interactiveElements: [
    { ref: 'current-task-field', label: 'Topic Entry', role: null, tag: 'input', editable: true, visible: true, enabled: true },
    { ref: 'train-label-field', label: 'Message Field', role: null, tag: 'input', editable: true, visible: true, enabled: true }
  ],
  privacy: { redacted: true }
};
const learnedLabelPrediction = predictAction(
  model,
  { instruction: 'Type a value into Topic Entry and press Enter' },
  learnedLabelDistractorObservation,
  []
);
assert.strictEqual(learnedLabelPrediction.action.type, 'typeText');
assert.strictEqual(learnedLabelPrediction.action.targetRef, 'current-task-field');

// Exact TRAIN tag/role shape is only supporting evidence. A textarea/combobox named by the task
// must be able to beat a generic input whose structural traits happen to match TRAIN better.
const crossShapeObservation = {
  observationId: 'cross-shape-transfer',
  interactiveElements: [
    { ref: 'cross-shape-field', label: 'Lookup Destination', role: 'combobox', tag: 'textarea', editable: true, visible: true, enabled: true },
    { ref: 'shape-match-distractor', label: 'Lookup History', role: null, tag: 'input', editable: true, visible: true, enabled: true }
  ],
  privacy: { redacted: true }
};
const crossShapePrediction = predictAction(
  model,
  { instruction: 'Type a value into Lookup Destination and press Enter' },
  crossShapeObservation,
  []
);
assert.strictEqual(crossShapePrediction.action.type, 'typeText');
assert.strictEqual(crossShapePrediction.action.targetRef, 'cross-shape-field');

const privacyDiagnostic = safeCandidateSummary({
  element: {
    ref: 'private-field',
    label: 'SUPER SECRET TYPED VALUE',
    role: 'textbox',
    tag: 'input',
    editable: true,
    visible: true,
    enabled: true,
    selector: 'input#private-secret',
    rect: { x: 999, y: 888, width: 777, height: 666 }
  },
  expectedRef: 'private-field',
  predictedRef: 'private-field',
  observation: { focusedElementRef: 'private-field' },
  task: { instruction: 'Type a value into the field' },
  proto: typeTextProto
});
assert.strictEqual(privacyDiagnostic.isExpectedTarget, true);
assert.strictEqual(privacyDiagnostic.isPredictedTarget, true);
assert.strictEqual(privacyDiagnostic.isFocusedTarget, true);
assert.strictEqual(privacyDiagnostic.affordanceEligible, true);
assert.strictEqual(Object.prototype.hasOwnProperty.call(privacyDiagnostic, 'label'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(privacyDiagnostic, 'selector'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(privacyDiagnostic, 'rect'), false);
const serializedDiagnostic = JSON.stringify(privacyDiagnostic);
assert.ok(!serializedDiagnostic.includes('SUPER SECRET TYPED VALUE'));
assert.ok(!serializedDiagnostic.includes('input#private-secret'));

const validationForm = formRecord(
  'validation-form',
  'Fill a query into Query Entry and press Enter',
  'validation-field',
  'Query Entry',
  'validation'
);
const testForm = formRecord(
  'test-form',
  'Type a lookup value into Lookup Box, then submit',
  'test-field',
  'Lookup Box',
  'test'
);
const evaluation = evaluateHeldOut(model, [validationForm], [testForm]);
assert.strictEqual(evaluation.pass, true);
assert.strictEqual(evaluation.validation.actionTypeAccuracy, 1);
assert.strictEqual(evaluation.validation.exactSemanticAccuracy, 1);
assert.strictEqual(evaluation.test.actionTypeAccuracy, 1);
assert.strictEqual(evaluation.test.exactSemanticAccuracy, 1);
assert.strictEqual(evaluation.fitPolicy.evaluationHistoryUsesModelPredictions, true);

const serializedModel = JSON.stringify(model);
assert.ok(!serializedModel.includes('validation-form'));
assert.ok(!serializedModel.includes('test-form'));
assert.ok(!serializedModel.includes('heldout-field'));
assert.ok(!serializedModel.includes('"targetRef"'));
assert.ok(!serializedModel.includes('"selector"'));
assert.ok(!serializedModel.includes('"rawCdp"'));
assert.ok(!serializedModel.includes('"tabId"'));

console.log('Strategy offline baseline contract: PASS');
