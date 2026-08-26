'use strict';

const assert = require('assert');
const { runGate } = require('../offline_strategy_native_one_action_gate.js');

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
      {
        ref: 'e7',
        tag: 'button',
        role: 'button',
        label: 'Media Play',
        visible: true,
        enabled: true,
        rect: { x: 100, y: 100, width: 120, height: 40 }
      }
    ],
    pageSignals: {},
    privacy: { redacted: true }
  };
}

async function main() {
  let executed = 0;
  let phase = 'before';
  const runtime = {
    async observe() {
      return phase === 'before'
        ? observation('obs-before', 'PAGE_CDP Batch Lab')
        : observation('obs-after', 'PLAY PASS');
    },
    async executePlan(payload) {
      assert.equal(payload.observationId, 'obs-before');
      assert.ok(Array.isArray(payload.plan));
      executed += 1;
      phase = 'after';
      return { ok: true };
    }
  };

  const model = {
    modelVersion: '0.1.0',
    kind: 'offline-semantic-prototype-baseline',
    actionPrototypes: [
      {
        type: 'play',
        examples: 1,
        instructions: ['Start media playback'],
        targetLabels: ['Media Play']
      }
    ]
  };

  const result = await runGate({
    runtime,
    model,
    instruction: 'Start media playback',
    expectedAction: 'play',
    expectedTitle: 'PLAY PASS'
  });

  assert.equal(result.ok, true);
  assert.equal(result.result, 'PASS');
  assert.equal(result.action.type, 'play');
  assert.equal(result.action.targetRef, 'e7');
  assert.equal(result.after.title, 'PLAY PASS');
  assert.equal(result.invariant.oneActionOnly, true);
  assert.equal(result.invariant.actionExecuted, true);
  assert.equal(result.invariant.reObservedAfterExecution, true);
  assert.equal(result.invariant.selectorUsedByStrategy, false);
  assert.equal(executed, 1);

  console.log('Offline Strategy native one-action contract: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
