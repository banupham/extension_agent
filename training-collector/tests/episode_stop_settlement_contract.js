'use strict';

const assert = require('assert');
const Settlement = require('../core/episode_stop_settlement.js');

function state(active, statuses) {
  return {
    active,
    episode: {
      transitions: statuses.map(status => ({ status }))
    }
  };
}

async function main() {
  assert.equal(Settlement.pendingCount(state(true, ['complete', 'pending'])), 1);
  assert.equal(Settlement.pendingCount(state(true, ['complete', 'complete'])), 0);

  const sequence = [
    state(true, ['complete', 'pending']),
    state(true, ['complete', 'pending']),
    state(true, ['complete', 'complete'])
  ];
  let index = 0;
  const settled = await Settlement.waitForSettlement(async () => sequence[Math.min(index++, sequence.length - 1)], {
    timeoutMs: 100,
    pollMs: 1,
    sleep: async () => {}
  });
  assert.equal(settled.settled, true);
  assert.equal(settled.pending, 0);
  assert.ok(index >= 3);

  let now = 0;
  const stuck = await Settlement.waitForSettlement(async () => state(true, ['pending']), {
    timeoutMs: 5,
    pollMs: 1,
    now: () => now,
    sleep: async ms => { now += ms; }
  });
  assert.equal(stuck.settled, false);
  assert.equal(stuck.pending, 1);

  const stopped = await Settlement.waitForSettlement(async () => state(false, ['pending']), {
    timeoutMs: 5,
    pollMs: 1,
    sleep: async () => {}
  });
  assert.equal(stopped.settled, true);

  console.log('Episode stop settlement contract: PASS');
}

if (require.main === module) {
  main().catch(error => {
    console.error('Episode stop settlement contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { main, state };
