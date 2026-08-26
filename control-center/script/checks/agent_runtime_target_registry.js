'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createRegistry, geometryChanged } = require('../../extension/agent-runtime-extension/target_registry.js');

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

const resolved = registry.resolve({ observationId: 'obs-1', tabId: 7, targetRef: 'e17', currentUrl: 'https://example.test/a' });
assert.strictEqual(resolved.selector, '#private-selector');
assert.strictEqual(resolved.rect.centerX, 140);
assert.strictEqual(resolved.rect.centerY, 65);

assert.strictEqual(geometryChanged({ x: 100, y: 50, width: 80, height: 30 }, { x: 101.5, y: 49, width: 80.5, height: 30 }, 2), false);
assert.strictEqual(geometryChanged({ x: 100, y: 50, width: 80, height: 30 }, { x: 380, y: 50, width: 80, height: 30 }, 2), true);
assert.strictEqual(geometryChanged(null, { x: 1, y: 1, width: 10, height: 10 }), true);

registry.register({ observationId: 'obs-2', tabId: 7, url: 'https://example.test/a', targets: [{ ref: 'e2', tag: 'a', role: 'link', label: 'Next', rect: { x: 10, y: 10, width: 40, height: 20 } }] });
assert.throws(() => registry.resolve({ observationId: 'obs-1', tabId: 7, targetRef: 'e17' }), /stale_observation/);

now += 4100;
assert.throws(() => registry.resolve({ observationId: 'obs-2', tabId: 7, targetRef: 'e2' }), /stale_observation/);

now = 9000;
registry.register({ observationId: 'obs-3', tabId: 7, url: 'https://example.test/a', targets: [{ ref: 'e3', tag: 'button', role: 'button', label: 'Open', rect: { x: 1, y: 2, width: 30, height: 20 } }] });
assert.throws(() => registry.resolve({ observationId: 'obs-3', tabId: 7, targetRef: 'e3', currentUrl: 'https://example.test/b' }), /stale_observation_url_changed/);

registry.invalidateTab(7);
assert.strictEqual(registry.status(7).observationId, null);

// Agent Cursor Debug Overlay contract: telemetry only, never an input source.
const extensionRoot = path.resolve(__dirname, '../../extension/agent-runtime-extension');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
const scripts = manifest.content_scripts || [];
assert.ok(scripts.some(entry => Array.isArray(entry.js) && entry.js.includes('agent_cursor_overlay.js')));
assert.strictEqual(manifest.background?.service_worker, 'agent_runtime_debug_background.js');

const overlaySource = fs.readFileSync(path.join(extensionRoot, 'agent_cursor_overlay.js'), 'utf8');
const mirrorSource = fs.readFileSync(path.join(extensionRoot, 'agent_cursor_mirror.js'), 'utf8');
const wrapperSource = fs.readFileSync(path.join(extensionRoot, 'agent_runtime_debug_background.js'), 'utf8');
new Function(overlaySource);
new Function(mirrorSource);
new Function(wrapperSource);
assert.match(overlaySource, /attachShadow\(\{ mode: 'closed' \}\)/);
assert.match(overlaySource, /pointer-events:none/);
assert.match(overlaySource, /inset:0/);
assert.match(overlaySource, /width:100vw/);
assert.match(overlaySource, /height:100vh/);
assert.doesNotMatch(overlaySource, /contain:[^'\n]*paint/);
assert.match(overlaySource, /chrome\.runtime\.onMessage/);
assert.doesNotMatch(overlaySource, /addEventListener\(['\"](?:mousemove|mousedown|mouseup|pointermove|pointerdown|pointerup)/);
assert.match(mirrorSource, /Input\.dispatchMouseEvent/);
assert.match(mirrorSource, /queueMicrotask/);
assert.match(mirrorSource, /chromeApi\.tabs\.sendMessage/);
assert.doesNotMatch(mirrorSource, /await\s+chromeApi\.tabs\.sendMessage/);
assert.match(wrapperSource, /AgentCursorMirror\.install\(chrome\)/);
assert.match(wrapperSource, /importScripts\('background\.js'\)/);

console.log('Agent Runtime target registry + cursor debug contract: PASS');
