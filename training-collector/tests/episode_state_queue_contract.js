'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const QueueFactory = require('../core/episode_state_queue.js');

async function main() {
  assert.strictEqual(QueueFactory.VERSION, '0.1.0');
  const queue = QueueFactory.createEpisodeStateQueue();
  const order = [];

  const a = queue.enqueue(async () => {
    order.push('start-a');
    await new Promise(resolve => setTimeout(resolve, 15));
    order.push('end-a');
    return 'a';
  });
  const b = queue.enqueue(async () => {
    order.push('start-b');
    await new Promise(resolve => setTimeout(resolve, 1));
    order.push('end-b');
    return 'b';
  });

  assert.strictEqual(await a, 'a');
  assert.strictEqual(await b, 'b');
  assert.deepStrictEqual(order, ['start-a', 'end-a', 'start-b', 'end-b']);

  await assert.rejects(() => queue.enqueue(async () => { throw new Error('expected'); }), /expected/);
  const recovered = await queue.enqueue(async () => 'recovered');
  assert.strictEqual(recovered, 'recovered');
  const drained = await queue.drain();
  assert.strictEqual(drained.queued, 0);

  const background = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  assert.match(background, /core\/episode_state_queue\.js/);
  assert.match(background, /function queueEpisodeMutation\(job\)/);
  assert.match(background, /return queueEpisodeMutation\(\(\) => transitionStartUnlocked/);
  assert.match(background, /return queueEpisodeMutation\(\(\) => transitionEndUnlocked/);
  assert.match(background, /return queueEpisodeMutation\(\(\) => stopEpisodeUnlocked/);
  assert.match(background, /GET_EPISODE_DIAGNOSTIC/);
  assert.match(background, /selectorsIncluded: false/);
  assert.match(background, /coordinatesIncluded: false/);
  assert.match(background, /tabIdsIncluded: false/);

  console.log('Episode state queue contract: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
