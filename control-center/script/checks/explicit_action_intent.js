'use strict';

const assert = require('assert');
const {
  createOfflineBaselineProvider,
  createExplicitActionIntentProvider,
  explicitActionType
} = require('../../manager/strategy');

function prototype(type, priorActionTypes, taskFeatures, targetTraits) {
  return {
    type,
    priorActionTypes,
    instructions: [type === 'click' ? 'click Open Berth Schedule' : type === 'typeText' ? 'type Dispatch Token' : 'submit Dispatch Token'],
    targetLabels: [type === 'click' ? 'Open Berth Schedule' : 'Dispatch Token'],
    taskFeatures,
    targetTraits
  };
}

function model() {
  const click = prototype('click', [], {
    textEntryIntent: 0,
    submitIntent: 0.1,
    enterIntent: 0,
    clickIntent: 1
  }, { roles: [], tags: ['button'], editableKnown: 1, editableRate: 0 });
  const typeText = prototype('typeText', [], {
    textEntryIntent: 1,
    submitIntent: 1,
    enterIntent: 0.4,
    clickIntent: 0.4
  }, { roles: [], tags: ['input'], editableKnown: 1, editableRate: 1 });
  const submit = prototype('submit', ['typeText'], {
    textEntryIntent: 0.3,
    submitIntent: 1,
    enterIntent: 1,
    clickIntent: 0
  }, { roles: [], tags: ['input'], editableKnown: 1, editableRate: 1 });
  return {
    modelVersion: 'test-explicit-action',
    kind: 'offline-semantic-prototype-baseline',
    actionPrototypes: [click, typeText, submit].map(item => ({ ...item, priorActionTypes: undefined })),
    historyPrototypes: [click, typeText, submit]
  };
}

function task(instruction) {
  return {
    taskId: 'explicit-action-test',
    type: 'controlled-explicit-action',
    instruction,
    args: {},
    successCriteria: [],
    constraints: {},
    metadata: {}
  };
}

function observation() {
  return {
    observationId: 'explicit-action-observation',
    capturedAt: new Date().toISOString(),
    url: 'http://explicit-action.invalid/',
    title: 'Explicit Action Test',
    viewport: { width: 1000, height: 700 },
    scroll: { x: 0, y: 0 },
    focusedElement: null,
    interactiveElements: [
      { ref: 'e0', label: 'Confirm Berth', role: null, tag: 'button', editable: false, visible: true, enabled: true },
      { ref: 'e1', label: 'Inspect Mooring', role: null, tag: 'button', editable: false, visible: true, enabled: true }
    ],
    pageSignals: {},
    privacy: { redacted: true }
  };
}

async function main() {
  const artifact = model();
  const baseProvider = createOfflineBaselineProvider({ model: artifact, minimumConfidence: 0 });
  const collisionTask = task('click Confirm Berth');
  const obs = observation();

  const base = await baseProvider.decide({ task: collisionTask, observation: obs, history: [] });
  assert.equal(base.status, 'blocked');
  assert.equal(base.reasonCode, 'offline_baseline_target_not_found');
  assert.equal(base.metadata.prototypeType, 'typeText');

  const wrapped = createExplicitActionIntentProvider({ baseProvider, model: artifact, minimumConfidence: 0 });
  const fixed = await wrapped.decide({ task: collisionTask, observation: obs, history: [] });
  assert.equal(fixed.status, 'act');
  assert.equal(fixed.action.type, 'click');
  assert.equal(fixed.action.targetRef, 'e0');
  assert.equal(fixed.metadata.prototypeType, 'click');
  assert.equal(fixed.metadata.explicitActionIntent, true);
  assert.equal(fixed.metadata.explicitActionType, 'click');

  assert.equal(explicitActionType(task('bấm Confirm Berth'), []), 'click');
  assert.equal(explicitActionType(task('bấm Enter'), []), 'submit');
  assert.equal(explicitActionType(task('type a value into Dispatch Token'), []), 'typeText');
  assert.equal(explicitActionType(task('click Confirm Berth'), [{ actionType: 'typeText' }]), null);

  console.log('Explicit action intent precedence: PASS');
}

if (require.main === module) {
  main().catch(error => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  });
}

module.exports = { model, task, observation, main };
