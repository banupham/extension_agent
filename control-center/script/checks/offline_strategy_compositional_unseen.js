'use strict';

const assert = require('assert');
const {
  inferCompositionalSequence,
  createOfflineBaselineProvider
} = require('../../manager/strategy/offline_baseline_provider.js');

function model() {
  return {
    modelVersion: '0.2.0',
    kind: 'offline-semantic-prototype-baseline',
    fitSource: 'train-only',
    heldOutUsedForFit: false,
    actionPrototypes: [
      { type: 'mute', examples: 2, instructions: ['Mute Media'], targetLabels: ['Media Mute'] },
      { type: 'pause', examples: 2, instructions: ['Pause Media'], targetLabels: ['Media Pause'] },
      { type: 'play', examples: 2, instructions: ['Start media playback'], targetLabels: ['Media Play'] }
    ],
    historyPrototypes: [
      { type: 'mute', priorActionTypes: ['play'], examples: 1, instructions: ['Start media playback, then mute it'], targetLabels: ['Media Mute'] }
    ]
  };
}

function observation() {
  return {
    observationId: 'obs-unseen',
    url: 'http://127.0.0.1:8091/',
    title: 'PAGE_CDP Batch Lab',
    interactiveElements: [
      { ref: 'e6', label: 'Media Play', tag: 'button', visible: true, enabled: true },
      { ref: 'e7', label: 'Media Pause', tag: 'button', visible: true, enabled: true },
      { ref: 'e8', label: 'Media Mute', tag: 'button', visible: true, enabled: true }
    ],
    privacy: { redacted: true }
  };
}

async function main() {
  const fitted = model();
  const task = { instruction: 'Play the media, then pause it' };
  assert.deepStrictEqual(inferCompositionalSequence(fitted, task), ['play', 'pause']);

  const provider = createOfflineBaselineProvider({ model: fitted });
  const first = await provider.decide({ task, observation: observation(), history: [] });
  assert.equal(first.status, 'act');
  assert.equal(first.action.type, 'play');
  assert.equal(first.action.targetRef, 'e6');
  assert.equal(first.reasonCode, 'offline_baseline_task_composition');
  assert.equal(first.metadata.compositionMatched, true);
  assert.deepStrictEqual(first.metadata.compositionSequence, ['play', 'pause']);
  assert.equal(first.metadata.prototypeSource, 'taskComposition');

  const second = await provider.decide({
    task,
    observation: observation(),
    history: [{ stepIndex: 1, actionType: 'play' }]
  });
  assert.equal(second.status, 'act');
  assert.equal(second.action.type, 'pause');
  assert.equal(second.action.targetRef, 'e7');
  assert.equal(second.reasonCode, 'offline_baseline_task_composition');
  assert.equal(second.metadata.compositionMatched, true);
  assert.deepStrictEqual(second.metadata.priorActionTypes, ['play']);

  assert.equal(fitted.historyPrototypes.some(proto =>
    proto.type === 'pause' && JSON.stringify(proto.priorActionTypes) === JSON.stringify(['play'])
  ), false);

  console.log('Offline Strategy compositional unseen contract: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});