'use strict';

const assert = require('assert');
const { createStrategy } = require('../../manager/strategy/index.js');
const { createOfflineBaselineProvider } = require('../../manager/strategy/offline_baseline_provider.js');

const model = {
  modelVersion: '0.1.0',
  kind: 'offline-semantic-prototype-baseline',
  fitSource: 'train-only',
  heldOutUsedForFit: false,
  trainingEpisodeIds: ['fixture-train'],
  actionPrototypes: [
    { type: 'dismiss', examples: 1, instructions: ['Dismiss the target'], targetLabels: ['Dismiss Target'] },
    { type: 'play', examples: 1, instructions: ['Start media playback'], targetLabels: ['Media Play'] }
  ]
};

const observation = {
  observationId: 'offline-provider-fixture',
  url: 'http://127.0.0.1:8091/',
  title: '',
  viewport: {},
  scroll: {},
  focusedElement: null,
  interactiveElements: [
    { ref: 'e6', label: 'Dismiss Target', visible: true, enabled: true, interactable: true },
    { ref: 'e7', label: 'Media Play', visible: true, enabled: true, interactable: true }
  ],
  pageSignals: {},
  privacy: { redacted: true }
};

async function decide(instruction) {
  const provider = createOfflineBaselineProvider({ model });
  const strategy = createStrategy({ provider });
  return strategy.decide({
    task: {
      taskId: `fixture-${instruction.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      type: 'controlled-browser-action',
      instruction,
      args: {},
      successCriteria: [],
      constraints: {},
      metadata: {}
    },
    observation,
    history: []
  });
}

(async () => {
  const play = await decide('Start media playback');
  assert.equal(play.status, 'act');
  assert.equal(play.action.type, 'play');
  assert.equal(play.action.targetRef, 'e7');
  assert.equal(play.reasonCode, 'offline_baseline_prototype_match');

  const dismiss = await decide('Dismiss the target');
  assert.equal(dismiss.status, 'act');
  assert.equal(dismiss.action.type, 'dismiss');
  assert.equal(dismiss.action.targetRef, 'e6');

  for (const decision of [play, dismiss]) {
    const text = JSON.stringify(decision);
    assert(!text.includes('selector'));
    assert(!text.includes('cdpMethod'));
    assert(!Object.prototype.hasOwnProperty.call(decision.action, 'x'));
    assert(!Object.prototype.hasOwnProperty.call(decision.action, 'y'));
  }

  console.log('Offline Strategy provider contract: PASS');
})().catch(error => {
  console.error(`Offline Strategy provider contract: FAIL\n${error.stack || error}`);
  process.exitCode = 1;
});
