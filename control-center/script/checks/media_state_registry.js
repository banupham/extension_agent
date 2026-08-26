'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createRegistry } = require('../../extension/agent-runtime-extension/target_registry.js');

const registry = createRegistry({ ttlMs: 4000, now: () => 1000 });
const registered = registry.register({
  observationId: 'obs-media',
  tabId: 12,
  url: 'https://example.test/media',
  targets: [
    {
      ref: 'e0', tag: 'input', label: 'Volume', editable: true, inputType: 'range',
      rangeValue: 20, rangeMin: 0, rangeMax: 100, rangeStep: 1,
      rect: { x: 100, y: 200, width: 129, height: 16 }
    },
    {
      ref: 'e1', tag: 'input', label: 'Secret', editable: true, inputType: 'password',
      rect: { x: 100, y: 240, width: 140, height: 24 }
    }
  ]
});

const range = registered.targets[0];
assert.strictEqual(range.inputType, 'range');
assert.strictEqual(range.rangeValue, 20);
assert.strictEqual(range.rangeMin, 0);
assert.strictEqual(range.rangeMax, 100);
assert.strictEqual(range.rangeStep, 1);

const secret = registered.targets[1];
assert.strictEqual(secret.rangeValue, null);
assert.strictEqual(secret.rangeMin, null);
assert.strictEqual(secret.rangeMax, null);
assert.strictEqual(secret.rangeStep, null);
assert.strictEqual(Object.prototype.hasOwnProperty.call(secret, 'value'), false);

const resolved = registry.resolve({
  observationId: 'obs-media', tabId: 12, targetRef: 'e0', currentUrl: 'https://example.test/media'
});
assert.strictEqual(resolved.rangeValue, 20);
assert.strictEqual(resolved.rangeMax, 100);

const runtimeSource = fs.readFileSync(path.resolve(__dirname, '../../extension/agent-runtime-extension/background.js'), 'utf8');
assert.match(runtimeSource, /rangeValue: isRange \? Number\(el\.value\) : null/);
assert.match(runtimeSource, /rangeMin: isRange \? Number\(el\.min \|\| '0'\) : null/);
assert.match(runtimeSource, /rangeMax: isRange \? Number\(el\.max \|\| '100'\) : null/);
assert.match(runtimeSource, /rangeStep: isRange \? \(el\.step === 'any'/);
assert.match(runtimeSource, /target\.rangeValue/);
assert.match(runtimeSource, /target_state_changed/);
assert.match(runtimeSource, /'setVolume', 'seek', 'changePlaybackRate'/);

console.log('media_state_registry: PASS');
