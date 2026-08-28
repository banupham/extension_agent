'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const manifest = JSON.parse(read('manifest.json'));
const content = read('content.js');
const background = read('background.js');
const routeTrace = read('observer/route_trace.js');
const rawStore = read('core/raw_session_store.js');

// Inherited frame-stream capability must survive every V0.8 patch release.
assert.match(String(manifest.version || ''), /^0\.8\./, `collector ${manifest.version} must remain on the V0.8 contract line`);
assert.ok(manifest.name.includes('V0.8'));
assert.equal(manifest.content_scripts[0].all_frames, true);
assert.equal(manifest.content_scripts[0].match_about_blank, true);
assert.equal(manifest.content_scripts[0].match_origin_as_fallback, true);
assert.ok(manifest.content_scripts[0].js.includes('observer/route_trace.js'));
assert.ok(manifest.content_scripts[0].js.includes('core/strategy_episode_view.js'));

assert.ok(content.includes("type: 'frame-context'"));
assert.ok(content.includes("type = 'collector-stream-health'"));
assert.ok(content.includes("emitHealth('collector-stream-start')"));
assert.ok(content.includes("emitHealth('collector-stream-stop')"));
assert.ok(content.includes('sourceEventCounts'));
assert.ok(content.includes('IS_TOP_FRAME'));
assert.ok(content.includes('ignoredSubframe'));
assert.ok(content.includes('tcRawPendingV072:'));
assert.ok(content.includes('strategyObservationBefore'));
assert.ok(content.includes('strategyObservationAfter'));

assert.ok(routeTrace.includes("type: 'route-change'"));
assert.ok(routeTrace.includes("snapshotReason: 'route-change'"));
assert.ok(routeTrace.includes("const POLL_MS = 500"));
assert.ok(routeTrace.includes("addEventListener('popstate'"));
assert.ok(routeTrace.includes("addEventListener('hashchange'"));

assert.ok(background.includes('documentId: sender.documentId || null'));
assert.ok(background.includes('documentLifecycle: sender.documentLifecycle || null'));
assert.ok(background.includes('sender.frameId === 0'));
assert.ok(background.includes('schema_upgrade_to_'));

assert.ok(rawStore.includes("const VERSION = '0.7.2'"));
assert.ok(rawStore.includes('all-frame-content-capture'));
assert.ok(rawStore.includes('sanitized-spa-route-change'));
assert.ok(rawStore.includes('collector-stream-start-health-stop'));

console.log(`Training Collector inherited V0.7.2 frame-aware + stream diagnostics contract OK (collector ${manifest.version})`);
