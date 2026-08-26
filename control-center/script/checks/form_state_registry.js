'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createRegistry } = require('../../extension/agent-runtime-extension/target_registry.js');

const registry = createRegistry({ ttlMs: 4000, now: () => 1000 });
const registered = registry.register({
  observationId: 'obs-form',
  tabId: 9,
  url: 'https://example.test/form',
  targets: [
    {
      ref: 'e0', tag: 'input', label: 'Check', editable: true, inputType: 'checkbox', checked: false,
      rect: { x: 10, y: 10, width: 20, height: 20 }
    },
    {
      ref: 'e1', tag: 'select', label: 'Select', editable: true, selectedValue: '0', selectedIndex: 0,
      options: [
        { index: 0, value: '0', label: 'Alpha', selected: true },
        { index: 1, value: '1', label: 'Beta' }
      ],
      rect: { x: 40, y: 10, width: 100, height: 24 }
    },
    {
      ref: 'e2', tag: 'input', label: 'Password', editable: true, inputType: 'password',
      rect: { x: 40, y: 50, width: 100, height: 24 }
    }
  ]
});

assert.strictEqual(registered.targets[0].checked, false);
assert.strictEqual(registered.targets[0].inputType, 'checkbox');
assert.strictEqual(registered.targets[1].selectedValue, '0');
assert.strictEqual(registered.targets[1].selectedIndex, 0);
assert.strictEqual(registered.targets[1].options[1].label, 'Beta');
assert.strictEqual(registered.targets[2].selectedValue, null);
assert.strictEqual(registered.targets[2].selectedIndex, null);
assert.strictEqual(Object.prototype.hasOwnProperty.call(registered.targets[2], 'value'), false);

const resolved = registry.resolve({ observationId: 'obs-form', tabId: 9, targetRef: 'e1', currentUrl: 'https://example.test/form' });
assert.strictEqual(resolved.options.length, 2);
assert.strictEqual(resolved.selector, null);

const runtimeSource = fs.readFileSync(path.resolve(__dirname, '../../extension/agent-runtime-extension/background.js'), 'utf8');
assert.match(runtimeSource, /checked: checkable \? !!el\.checked : null/);
assert.match(runtimeSource, /selectedValue: isSelect \? String\(el\.value/);
assert.match(runtimeSource, /targetFormStateChanged/);
assert.match(runtimeSource, /target_state_changed/);
assert.match(runtimeSource, /'setChecked', 'selectOption'/);

console.log('form_state_registry: PASS');
