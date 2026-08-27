'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runGate } = require('../offline_strategy_self_experience_gate.js');

function observation(id, title) {
  return {
    observationId: id,
    capturedAt: new Date().toISOString(),
    url: 'http://127.0.0.1:8091/',
    title,
    viewport: { width: 1200, height: 800 },
    scroll: { x: 0, y: 0 },
    focusedElement: null,
    interactiveElements: [
      { ref: 'e6', tag: 'button', role: 'button', label: 'Media Play', visible: true, enabled: true, rect: { x: 100, y: 100, width: 100, height: 30 } },
      { ref: 'e7', tag: 'button', role: 'button', label: 'Media Pause', visible: true, enabled: true, rect: { x: 220, y: 100, width: 100, height: 30 } }
    ],
    pageSignals: {},
    privacy: { redacted: true }
  };
}

function runtimeFixture() {
  let title = 'PAGE_CDP Batch Lab';
  let seq = 0;
  return {
    reset() { title = 'PAGE_CDP Batch Lab'; },
    async observe() { seq += 1; return observation(`obs-${seq}`, title); },
    async executePlan(payload) {
      const type = payload?.plan?.actionType;
      if (type === 'play') title = 'PLAY PASS';
      else if (type === 'pause') title = 'PAUSE PASS';
      return { ok: true };
    }
  };
}

const model = {
  modelVersion: '0.1.0',
  kind: 'offline-semantic-prototype-baseline',
  fitSource: 'train-only',
  heldOutUsedForFit: false,
  actionPrototypes: [
    { type: 'pause', examples: 1, instructions: ['Pause Media'], targetLabels: ['Media Pause'] },
    { type: 'play', examples: 1, instructions: ['Play Media'], targetLabels: ['Media Play'] }
  ],
  historyPrototypes: []
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-selfexp-gate-'));
  const memoryFile = path.join(dir, 'memory.jsonl');
  const runtime = runtimeFixture();

  const learned = await runGate({
    runtime,
    model,
    mode: 'learn',
    instruction: 'Play the media, then pause it',
    expectedTitle: 'PAUSE PASS',
    memoryFile,
    resetMemory: true,
    postActionSettle: false
  });
  assert.equal(learned.result, 'PASS');
  assert.deepStrictEqual(learned.actualSequence, ['play', 'pause']);
  assert.deepStrictEqual(learned.decisionSources, ['taskComposition', 'taskComposition']);
  assert.equal(learned.memoryWrite.appended, true);
  assert.equal(fs.existsSync(memoryFile), true);

  runtime.reset();
  const recalled = await runGate({
    runtime,
    model,
    mode: 'recall',
    instruction: 'Play the media, then pause it',
    expectedTitle: 'PAUSE PASS',
    memoryFile,
    postActionSettle: false
  });
  assert.equal(recalled.result, 'PASS');
  assert.deepStrictEqual(recalled.actualSequence, ['play', 'pause']);
  assert.deepStrictEqual(recalled.decisionSources, ['selfExperience', 'selfExperience']);
  assert.equal(recalled.finalBudget.reasonCode, 'goal_satisfied');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Offline Strategy self-experience gate contract: PASS');
})().catch(error => {
  console.error(`Offline Strategy self-experience gate contract: FAIL\n${error.stack || error}`);
  process.exitCode = 1;
});
