'use strict';

const assert = require('assert');
const { createStrategy } = require('../../manager/strategy/index.js');
const { createOfflineBaselineProvider } = require('../../manager/strategy/offline_baseline_provider.js');

const model = {
  modelVersion: '0.2.0',
  kind: 'offline-semantic-prototype-baseline',
  fitSource: 'train-only',
  heldOutUsedForFit: false,
  historyAware: true,
  historyFeature: 'prior-semantic-action-types',
  trainingEpisodeIds: ['fixture-train'],
  actionPrototypes: [
    { type: 'mute', examples: 1, instructions: ['Start media playback, then mute it'], targetLabels: ['Media Mute'] },
    { type: 'play', examples: 1, instructions: ['Start media playback, then mute it'], targetLabels: ['Media Play'] }
  ],
  historyPrototypes: [
    { type: 'play', priorActionTypes: [], examples: 1, instructions: ['Start media playback, then mute it'], targetLabels: ['Media Play'] },
    { type: 'mute', priorActionTypes: ['play'], examples: 1, instructions: ['Start media playback, then mute it'], targetLabels: ['Media Mute'] }
  ]
};

const observation = {
  observationId: 'offline-history-provider-fixture',
  url: 'http://127.0.0.1:8091/',
  title: 'PAGE_CDP Batch Lab',
  viewport: {},
  scroll: {},
  interactiveElements: [
    { ref: 'e6', label: 'Media Play', visible: true, enabled: true },
    { ref: 'e8', label: 'Media Mute', visible: true, enabled: true }
  ],
  privacy: { redacted: true }
};

function task() {
  return {
    taskId: 'fixture-history-sequence',
    type: 'controlled-browser-action',
    instruction: 'Play the media and then mute it',
    args: {},
    successCriteria: [],
    constraints: {},
    metadata: {}
  };
}

(async () => {
  const provider = createOfflineBaselineProvider({ model });
  const strategy = createStrategy({ provider });

  const first = await strategy.decide({ task: task(), observation, history: [] });
  assert.equal(first.status, 'act');
  assert.equal(first.action.type, 'play');
  assert.equal(first.action.targetRef, 'e6');
  assert.equal(first.metadata.historyMatched, true);
  assert.deepStrictEqual(first.metadata.priorActionTypes, []);

  const second = await strategy.decide({
    task: task(),
    observation: { ...observation, observationId: 'offline-history-provider-fixture-2', title: 'PLAY PASS' },
    history: [{ actionType: 'play', controlStatus: 'continue', taskSucceeded: false }]
  });
  assert.equal(second.status, 'act');
  assert.equal(second.action.type, 'mute');
  assert.equal(second.action.targetRef, 'e8');
  assert.equal(second.metadata.historyMatched, true);
  assert.deepStrictEqual(second.metadata.priorActionTypes, ['play']);
  assert.equal(second.metadata.prototypeSource, 'historyPrototypes');

  for (const decision of [first, second]) {
    const text = JSON.stringify(decision);
    assert(!text.includes('selector'));
    assert(!text.includes('cdpMethod'));
    assert(!Object.prototype.hasOwnProperty.call(decision.action, 'x'));
    assert(!Object.prototype.hasOwnProperty.call(decision.action, 'y'));
  }

  console.log('Offline Strategy history provider contract: PASS');
})().catch(error => {
  console.error(`Offline Strategy history provider contract: FAIL\n${error.stack || error}`);
  process.exitCode = 1;
});
