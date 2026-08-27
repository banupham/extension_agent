'use strict';

const assert = require('assert');
const { runGate } = require('../offline_strategy_history_three_step_gate.js');

function observation(id, title) {
  return {
    observationId: id,
    capturedAt: Date.now(),
    url: 'http://127.0.0.1:8091/',
    title,
    viewport: { width: 1200, height: 800 },
    scroll: { x: 0, y: 0 },
    interactiveElements: [
      { ref: 'e6', tag: 'button', label: 'Media Play', visible: true, enabled: true, rect: { x: 40, y: 350, width: 82, height: 21 } },
      { ref: 'e8', tag: 'button', label: 'Media Mute', visible: true, enabled: true, rect: { x: 220, y: 350, width: 82, height: 21 } },
      { ref: 'e10', tag: 'button', label: 'Media Unmute', visible: true, enabled: true, rect: { x: 400, y: 350, width: 82, height: 21 } }
    ],
    privacy: { redacted: true }
  };
}

const model = {
  modelVersion: '0.2.0',
  kind: 'offline-semantic-prototype-baseline',
  fitSource: 'train-only',
  heldOutUsedForFit: false,
  historyAware: true,
  historyFeature: 'prior-semantic-action-types',
  trainingEpisodeIds: ['fixture-three-step'],
  actionPrototypes: [
    { type: 'mute', examples: 1, instructions: ['Start media playback, mute it, then unmute it'], targetLabels: ['Media Mute'] },
    { type: 'play', examples: 1, instructions: ['Start media playback, mute it, then unmute it'], targetLabels: ['Media Play'] },
    { type: 'unmute', examples: 1, instructions: ['Start media playback, mute it, then unmute it'], targetLabels: ['Media Unmute'] }
  ],
  historyPrototypes: [
    { type: 'play', priorActionTypes: [], examples: 1, instructions: ['Start media playback, mute it, then unmute it'], targetLabels: ['Media Play'] },
    { type: 'mute', priorActionTypes: ['play'], examples: 1, instructions: ['Start media playback, mute it, then unmute it'], targetLabels: ['Media Mute'] },
    { type: 'unmute', priorActionTypes: ['play', 'mute'], examples: 1, instructions: ['Start media playback, mute it, then unmute it'], targetLabels: ['Media Unmute'] }
  ]
};

async function main() {
  let observeCount = 0;
  let executeCount = 0;
  let title = 'PAGE_CDP Batch Lab';
  const runtime = {
    async observe() {
      observeCount += 1;
      return observation(`obs-${observeCount}`, title);
    },
    async executePlan(payload) {
      executeCount += 1;
      if (payload.plan.actionType === 'play') title = 'PLAY PASS';
      if (payload.plan.actionType === 'mute') title = 'MUTE PASS';
      if (payload.plan.actionType === 'unmute') title = 'UNMUTE PASS';
      return { ok: true };
    }
  };

  const result = await runGate({
    runtime,
    model,
    instruction: 'Play the media, mute it, and then unmute it',
    expectedTitle: 'UNMUTE PASS',
    minimumConfidence: 0
  });

  assert.equal(result.ok, true);
  assert.equal(result.result, 'PASS');
  assert.deepStrictEqual(result.actualSequence, ['play', 'mute', 'unmute']);
  assert.equal(result.steps.length, 3);
  assert.equal(result.steps[0].control.status, 'continue');
  assert.equal(result.steps[1].control.status, 'continue');
  assert.equal(result.steps[2].control.status, 'done');
  assert.equal(result.finalOutcome.taskSucceeded, true);
  assert.equal(result.finalBudget.reasonCode, 'goal_satisfied');
  assert.equal(result.invariant.actionExecutionCount, 3);
  assert.equal(result.invariant.strategyCallCount, 3);
  assert.equal(executeCount, 3);

  console.log('Offline Strategy history three-step contract: PASS');
}

main().catch(error => {
  console.error(`Offline Strategy history three-step contract: FAIL\n${error.stack || error}`);
  process.exitCode = 1;
});
