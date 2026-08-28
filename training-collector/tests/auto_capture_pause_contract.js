'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const manifest = JSON.parse(read('manifest.json'));
const content = read('content.js');
const popup = read('popup.js');
const popupHtml = read('popup.html');
const backgroundEntry = read('background_entry.js');
const subframe = read('capture/subframe_episode_capture.js');
const routeTrace = read('observer/route_trace.js');

assert.strictEqual(manifest.version, '0.8.5', 'collector manifest must expose V0.8.5');
assert(popupHtml.includes('id="captureToggle"'), 'popup must expose capture toggle button');
assert(popupHtml.includes('Pause Auto Raw Capture'), 'popup must label pause action explicitly');
assert(content.includes("const AUTO_CAPTURE_KEY = 'trainingCollectorAutoCaptureEnabledV1';"), 'content capture must share persisted pause key');
assert(content.includes('function stopRawCapture()'), 'content capture must provide real stop path');
assert(content.includes('S.physical?.stop?.();'), 'pause must stop physical capture');
assert(content.includes('S.domCapture?.stop?.();'), 'pause must stop DOM capture');
assert(content.includes('S.mutationTrace?.stop?.();'), 'pause must stop mutation capture');
assert(content.includes('S.hoverTrace?.stop?.();'), 'pause must stop hover capture');
assert(content.includes('S.routeTrace?.stop?.();'), 'pause must stop route capture');
assert(content.includes('chrome.storage.onChanged.addListener'), 'open pages must react to persisted pause changes');
assert(routeTrace.includes('listeners.splice(0)'), 'route trace pause must detach route listeners');
assert(backgroundEntry.includes("TRAINING_COLLECTOR_EPISODE_STATE_V1"), 'background must expose lightweight episode state scope');
assert(popup.includes("TRAINING_COLLECTOR_EPISODE_STATE_V1"), 'popup settlement must use lightweight episode state scope');
assert(popup.includes('pollMs: 200'), 'success settlement polling must be rate-limited');
assert(subframe.includes('oldActive === newActive && oldEpisodeId === newEpisodeId'), 'subframe must ignore transition-only storage writes');

console.log('Auto capture pause + lightweight episode polling contract: PASS');
