'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createRegistry, geometryChanged, normalizeFramePath } = require('../../extension/agent-runtime-extension/target_registry.js');
const {
  normalizeTargetTracking,
  withTargetTrackingBehavior,
  withTargetTrackingPlan
} = require('../../manager/execution/target_tracking_variant.js');
require('../../extension/agent-runtime-extension/follow_live_pointer.js');
const FollowLive = globalThis.AgentFollowLivePointer;

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
assert.strictEqual(first.targets[0].frameDepth, 0);
assert.strictEqual(Object.prototype.hasOwnProperty.call(first.targets[0], 'selector'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(first.targets[0], 'framePath'), false);

const resolved = registry.resolve({
  observationId: 'obs-1', tabId: 7, targetRef: 'e17', currentUrl: 'https://example.test/a'
});
assert.strictEqual(resolved.selector, '#private-selector');
assert.deepStrictEqual(resolved.framePath, []);
assert.strictEqual(resolved.rect.centerX, 140);
assert.strictEqual(resolved.rect.centerY, 65);

assert.strictEqual(
  geometryChanged(
    { x: 100, y: 50, width: 80, height: 30 },
    { x: 101.5, y: 49, width: 80.5, height: 30 },
    2
  ),
  false
);
assert.strictEqual(
  geometryChanged(
    { x: 100, y: 50, width: 80, height: 30 },
    { x: 380, y: 50, width: 80, height: 30 },
    2
  ),
  true
);
assert.strictEqual(geometryChanged(null, { x: 1, y: 1, width: 10, height: 10 }), true);
assert.deepStrictEqual(normalizeFramePath([0, '2', -1, 'x', 3]), [0, 2, 3]);

registry.register({
  observationId: 'obs-frame',
  tabId: 8,
  url: 'https://example.test/root',
  targets: [{
    ref: 'e5', tag: 'button', label: 'Frame Action Target', selector: '#frameTarget',
    framePath: [0, 1], frameDepth: 2, frameUrl: 'https://example.test/nested',
    rect: { x: 410, y: 520, width: 120, height: 30 }
  }]
});
const framePublic = registry.status(8);
assert.strictEqual(framePublic.targetCount, 1);
const frameResolved = registry.resolve({ observationId: 'obs-frame', tabId: 8, targetRef: 'e5', currentUrl: 'https://example.test/root' });
assert.deepStrictEqual(frameResolved.framePath, [0, 1]);
assert.strictEqual(frameResolved.frameDepth, 2);
assert.strictEqual(frameResolved.frameUrl, 'https://example.test/nested');
assert.strictEqual(frameResolved.rect.centerX, 470);

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

const extensionRoot = path.resolve(__dirname, '../../extension/agent-runtime-extension');

// Drag plans bind both source and destination to the same observation. Runtime must
// guard destination geometry before dispatch and immediately before mouse release.
const runtimeSource = fs.readFileSync(path.join(extensionRoot, 'background.js'), 'utf8');
assert.match(runtimeSource, /let guardedDestination = null/);
assert.match(runtimeSource, /targetRef: normalized\.destinationRef/);
assert.match(runtimeSource, /guardTargetGeometry\(tabId, guardedDestination\)/);
assert.match(runtimeSource, /params\?\.type === 'mouseReleased'/);

// Same-origin iframe baseline: Observer recursively discovers child-frame targets,
// converts their rectangles to top-viewport coordinates, and live guard resolves
// the same private frame path before pointer execution.
assert.match(runtimeSource, /querySelectorAll\('iframe,frame'\)/);
assert.match(runtimeSource, /framePath: \[\.\.\.framePath\]/);
assert.match(runtimeSource, /owner\.contentDocument/);
assert.match(runtimeSource, /offsetX \+ r\.x \+ Number\(owner\.clientLeft/);
assert.match(runtimeSource, /target_frame_changed/);

// Experimental target-tracking variant stays below Strategy. Fixed behavior remains
// the default; follow-live explicitly attaches semantic target metadata to a plan.
assert.strictEqual(normalizeTargetTracking(undefined), 'fixed');
assert.strictEqual(normalizeTargetTracking('follow-live'), 'follow-live');
assert.throws(() => normalizeTargetTracking('teleport'), /unsupported_target_tracking/);
const fixedBehavior = {
  actionType: 'submit',
  profile: 'fallback',
  pointer: { profile: 'fallback', targetAcquisition: 'adaptive', constraints: {} },
  metadata: {}
};
const followBehavior = withTargetTrackingBehavior(fixedBehavior, 'follow-live');
assert.strictEqual(followBehavior.pointer.targetTracking, 'follow-live');
assert.strictEqual(Object.prototype.hasOwnProperty.call(fixedBehavior.pointer, 'targetTracking'), false);
const sampleTarget = {
  ref: 'e-follow', tag: 'button', role: null, label: 'Moving Submit', frameDepth: 0,
  rect: { x: 100, y: 50, width: 80, height: 30 }
};
const basePlan = {
  cdpPlanVersion: '0.1.2', actionType: 'submit', targetRef: 'e-follow',
  steps: [{ method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 140, y: 65 } }]
};
assert.strictEqual(withTargetTrackingPlan(basePlan, fixedBehavior, sampleTarget), basePlan);
const followPlan = withTargetTrackingPlan(basePlan, followBehavior, sampleTarget);
assert.strictEqual(followPlan.targetTracking, 'follow-live');
assert.strictEqual(followPlan.trackingTarget.label, 'Moving Submit');
assert.strictEqual(followPlan.trackingTarget.ref, basePlan.targetRef);

// Pure correction contract: the first step stays near the original approach path;
// correction grows monotonically and press/release use the full live-target delta.
FollowLive.begin(99, sampleTarget);
const trackingState = FollowLive.stateFor(99);
const liveRect = { x: 140, y: 50, width: 80, height: 30 };
const firstMove = FollowLive.correctedPointerParams(trackingState, { type: 'mouseMoved', x: 0, y: 0 }, liveRect);
const nearMove = FollowLive.correctedPointerParams(trackingState, { type: 'mouseMoved', x: 138, y: 65 }, liveRect);
const press = FollowLive.correctedPointerParams(trackingState, { type: 'mousePressed', x: 140, y: 65, button: 'left' }, liveRect);
assert.strictEqual(firstMove.x, 0);
assert.ok(nearMove.x > 138);
assert.strictEqual(press.x, 180);
assert.strictEqual(trackingState.lastProgress, 1);
const trackingSummary = FollowLive.end(99);
assert.ok(trackingSummary.samples >= 3);
assert.ok(trackingSummary.correctionCount >= 3);
assert.ok(trackingSummary.maxDeltaPx >= 40);
assert.throws(() => FollowLive.begin(100, { ...sampleTarget, frameDepth: 1 }), /follow_live_tracking_top_document_only/);

// Agent Cursor Debug Overlay contract: telemetry only, never an input source.
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
const scripts = manifest.content_scripts || [];
assert.ok(scripts.some(entry => Array.isArray(entry.js) && entry.js.includes('agent_cursor_overlay.js')));
assert.strictEqual(manifest.background?.service_worker, 'agent_runtime_debug_background.js');

const overlaySource = fs.readFileSync(path.join(extensionRoot, 'agent_cursor_overlay.js'), 'utf8');
const mirrorSource = fs.readFileSync(path.join(extensionRoot, 'agent_cursor_mirror.js'), 'utf8');
const wrapperSource = fs.readFileSync(path.join(extensionRoot, 'agent_runtime_debug_background.js'), 'utf8');
const followLiveSource = fs.readFileSync(path.join(extensionRoot, 'follow_live_pointer.js'), 'utf8');
new Function(overlaySource);
new Function(mirrorSource);
new Function(wrapperSource);
new Function(followLiveSource);
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
assert.match(wrapperSource, /AgentFollowLivePointer\.install\(chrome\)/);
assert.match(wrapperSource, /targetTracking === 'follow-live'/);
assert.match(wrapperSource, /importScripts\('background\.js'\)/);
assert.match(followLiveSource, /Runtime\.evaluate/);
assert.match(followLiveSource, /follow_live_target_/);

console.log('Agent Runtime target registry + iframe binding + cursor debug + follow-live contract: PASS');
