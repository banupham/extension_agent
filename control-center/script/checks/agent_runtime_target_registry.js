'use strict';

const assert = require('assert');
const { createRegistry } = require('../../extension/agent-runtime-extension/target_registry.js');

let now = 1000;
const registry = createRegistry({ ttlMs: 4000, now: () => now });

const first = registry.register({
  observationId: 'obs-1',
  tabId: 7,
  url: 'https://example.test/a',
  targets: [
    {
      ref: 'e17', tag: 'button', role: 'button', label: 'Like', enabled: true, visible: true,
      selector: '#private-selector',
      rect: { x: 100, y: 50, width: 80, height: 30 }
    }
  ]
});

assert.strictEqual(first.targets.length, 1);
assert.strictEqual(first.targets[0].ref, 'e17');
assert.strictEqual(Object.prototype.hasOwnProperty.call(first.targets[0], 'selector'), false);

const resolved = registry.resolve({
  observationId: 'obs-1', tabId: 7, targetRef: 'e17', currentUrl: 'https://example.test/a'
});
assert.strictEqual(resolved.selector, '#private-selector');
assert.strictEqual(resolved.rect.centerX, 140);
assert.strictEqual(resolved.rect.centerY, 65);

registry.register({
  observationId: 'obs-2',
  tabId: 7,
  url: 'https://example.test/a',
  targets: [{ ref: 'e2', tag: 'a', role: 'link', label: 'Next', rect: { x: 10, y: 10, width: 40, height: 20 } }]
});
assert.throws(() => registry.resolve({ observationId: 'obs-1', tabId: 7, targetRef: 'e17' }), /stale_observation/);

now += 4100;
assert.throws(() => registry.resolve({ observationId: 'obs-2', tabId: 7, targetRef: 'e2' }), /stale_observation/);

now = 9000;
registry.register({
  observationId: 'obs-3', tabId: 7, url: 'https://example.test/a',
  targets: [{ ref: 'e3', tag: 'button', role: 'button', label: 'Open', rect: { x: 1, y: 2, width: 30, height: 20 } }]
});
assert.throws(() => registry.resolve({ observationId: 'obs-3', tabId: 7, targetRef: 'e3', currentUrl: 'https://example.test/b' }), /stale_observation_url_changed/);

registry.invalidateTab(7);
assert.strictEqual(registry.status(7).observationId, null);

console.log('Agent Runtime target registry contract: PASS');
