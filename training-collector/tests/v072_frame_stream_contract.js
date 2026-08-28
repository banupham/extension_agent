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
const mutationTrace = read('observer/mutation_trace.js');
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

// M18 must observe a real delayed semantic DOM change even when continuous raw capture is paused.
assert.ok(content.includes('const STRATEGY_WAIT_MIN_MS = 500'));
assert.ok(content.includes("kind: 'observe', operation: 'wait'"));
assert.ok(content.includes('strategySemanticFingerprint(S.lastEpisodeState) === strategySemanticFingerprint(after)'));
assert.ok(content.includes('if (S.rawActive || S.episodeActive) trace.start?.()'));
assert.ok(mutationTrace.includes('onBurst'));
assert.ok(mutationTrace.includes('onBurst?.(out)'));

assert.ok(routeTrace.includes("type: 'route-change'"));
assert.ok(routeTrace.includes("snapshotReason: 'route-change'"));
assert.ok(routeTrace.includes("const POLL_MS = 500"));
assert.ok(routeTrace.includes("on(globalThis, 'popstate'"), 'route trace must observe browser history navigation');
assert.ok(routeTrace.includes("on(globalThis, 'hashchange'"), 'route trace must observe hash navigation');
assert.ok(routeTrace.includes('removeEventListener'), 'route listeners must be removable on stop');

assert.ok(background.includes('documentId: sender.documentId || null'));
assert.ok(background.includes('documentLifecycle: sender.documentLifecycle || null'));
assert.match(background, /sender\.frameId\s*!==\s*0|sender\.frameId\s*===\s*0/, 'episode transition gate must explicitly enforce top-frame semantics');
assert.ok(background.includes('schema_upgrade_to_'));

// M14/M22 must use real chrome.tabs lifecycle signals and settle observations across the retry window.
for (const listener of ['onCreated', 'onActivated', 'onRemoved', 'onUpdated']) {
  assert.ok(background.includes(`chrome.tabs.${listener}.addListener`), `missing chrome.tabs.${listener} lifecycle capture`);
}
assert.ok(background.includes("beginBrowserTransition(state.episode, 'switchTab'"));
assert.ok(background.includes("beginBrowserTransition(state.episode, 'closeTab'"));
assert.ok(background.includes("beginBrowserTransition(state.episode, 'reload'"));
assert.ok(background.includes("runtime.pendingOpenByTabId"));
const observationHelper = background.match(/async function requestStrategyObservation[\s\S]*?\n}\nfunction initHistory/);
assert.ok(observationHelper, 'browser observation settlement helper missing');
assert.ok(observationHelper[0].includes('const attempts = Math.max(1, Number(retries || 1))'));
assert.ok(observationHelper[0].includes('if (observed) latest = observed'));
assert.equal(observationHelper[0].includes('if (latest) return latest'), false, 'must not return the first snapshot before lifecycle state settles');
assert.ok(background.includes("requestStrategyObservation(fallback, 'close-tab-after', BROWSER_OBSERVATION_RETRIES)"));

assert.ok(rawStore.includes("const VERSION = '0.7.2'"));
assert.ok(rawStore.includes('all-frame-content-capture'));
assert.ok(rawStore.includes('sanitized-spa-route-change'));
assert.ok(rawStore.includes('collector-stream-start-health-stop'));

console.log(`Training Collector inherited V0.7.2 frame-aware + stream diagnostics contract OK (collector ${manifest.version})`);
