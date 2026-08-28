'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Order = require('../core/episode_transition_order.js');

async function main() {
  assert.strictEqual(Order.VERSION, '0.1.0');
  const order = Order.createTransitionOrder();
  const events = [];
  let releaseStart;
  const startAck = new Promise(resolve => { releaseStart = resolve; }).then(() => {
    events.push('start-ack');
  });

  order.registerStart('t-enter', startAck);
  const endWork = order.afterStart('t-enter', async () => {
    events.push('end-send');
  });

  await Promise.resolve();
  assert.deepStrictEqual(events, [], 'end must not run before transition start acknowledgement');
  assert.strictEqual(order.pendingStartCount(), 1);

  releaseStart();
  await endWork;
  assert.deepStrictEqual(events, ['start-ack', 'end-send']);
  assert.strictEqual(order.pendingStartCount(), 0);

  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'manifest.json'), 'utf8'));
  const scripts = manifest.content_scripts?.[0]?.js || [];
  const helperIndex = scripts.indexOf('core/episode_transition_order.js');
  const contentIndex = scripts.indexOf('content.js');
  assert.ok(helperIndex >= 0 && contentIndex >= 0 && helperIndex < contentIndex, 'ordering helper must load before content.js');

  const content = fs.readFileSync(path.resolve(__dirname, '..', 'content.js'), 'utf8');
  assert.ok(content.includes('registerStart?.(id, startPromise)'), 'content capture must register the start acknowledgement');
  assert.ok(content.includes('afterStart(id, completeTransition)'), 'content capture must wait for start before end');

  console.log('Episode transition order contract: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
