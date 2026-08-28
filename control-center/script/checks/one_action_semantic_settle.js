'use strict';

const assert = require('assert');
const {
  SETTLE_ACTION_TYPES,
  settlePolicy,
  observeAfterAction
} = require('../../manager/agent/one_action_bridge.js');

function observation(id, title) {
  return {
    observationId: id,
    url: 'http://127.0.0.1:8091/',
    title,
    viewport: { width: 1200, height: 800 },
    scroll: { x: 0, y: 0 },
    focusedRef: null,
    interactiveElements: [
      { ref: 'e6', tag: 'button', role: null, label: 'Media Play', visible: true, enabled: true }
    ]
  };
}

async function main() {
  for (const type of ['play', 'pause', 'mute', 'unmute', 'toggle', 'submit', 'dismiss', 'hoverAndObserve']) {
    assert.equal(SETTLE_ACTION_TYPES.has(type), true, `missing settle action: ${type}`);
    assert.ok(settlePolicy({}, { type }), `missing settle policy: ${type}`);
  }

  let observeCount = 0;
  const runtime = {
    async observe() {
      observeCount += 1;
      if (observeCount === 1) return observation('obs-1', 'PAGE_CDP Batch Lab');
      return observation(`obs-${observeCount}`, 'PLAY PASS');
    }
  };

  const settled = await observeAfterAction(runtime, { type: 'play' }, {
    postActionSettle: { pollMs: 1, minWindowMs: 1, maxWindowMs: 5, stableSamples: 2 },
    settleSleep: async () => {}
  });

  assert.equal(settled.observation.title, 'PLAY PASS');
  assert.equal(settled.metadata.mode, 'settled');
  assert.equal(settled.metadata.semanticChanged, true);
  assert.equal(settled.metadata.deadlineReached, false);
  assert.ok(observeCount >= 3);

  console.log('One-action semantic settle contract: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
