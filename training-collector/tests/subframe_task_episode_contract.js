'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const backgroundEntry = fs.readFileSync(path.join(ROOT, 'background_entry.js'), 'utf8');
const bridge = fs.readFileSync(path.join(ROOT, 'core', 'frame_episode_background_bridge.js'), 'utf8');
const subframe = fs.readFileSync(path.join(ROOT, 'capture', 'subframe_episode_capture.js'), 'utf8');
const episodeBuilder = fs.readFileSync(path.join(ROOT, 'core', 'episode_builder.js'), 'utf8');

const scripts = manifest.content_scripts?.[0]?.js || [];
assert.strictEqual(manifest.version, '0.8.4', 'collector version must expose the frame-aware Task Episode fix');
assert.strictEqual(manifest.background?.service_worker, 'background_entry.js', 'background entry must load the frame episode bridge');
assert.strictEqual(manifest.content_scripts?.[0]?.all_frames, true, 'collector must inject into all frames');
assert(scripts.includes('capture/subframe_episode_capture.js'), 'subframe Task Episode capture must be injected');

assert(backgroundEntry.includes("'background.js'"), 'background entry must preserve the existing collector background');
assert(backgroundEntry.includes("'core/frame_episode_background_bridge.js'"), 'background entry must load frame episode bridge after existing background');

assert(bridge.includes("TRAINING_COLLECTOR_FRAME_EPISODE_V1"), 'frame bridge must use an isolated message scope');
assert(bridge.includes('sender?.tab?.id === state.episode.tabId'), 'frame bridge must restrict transitions to the active episode tab');
assert(bridge.includes('queueEpisodeMutation'), 'frame bridge must serialize with the existing episode mutation queue');
assert(bridge.includes('sourceContext'), 'frame bridge must attach source frame context');
assert(bridge.includes('next_subframe_document_ready'), 'frame navigation must settle pending subframe transitions');

assert(subframe.includes('if (root === root.top) return;'), 'subframe capture must not duplicate top-frame transitions');
assert(subframe.includes('chrome.storage.onChanged.addListener'), 'subframe capture must follow episode start/stop state changes');
assert(subframe.includes("send('TRANSITION_START'"), 'subframe capture must emit transition starts');
assert(subframe.includes("send('TRANSITION_END'"), 'subframe capture must emit transition ends');
assert(subframe.includes("send('DOCUMENT_READY'"), 'subframe capture must report iframe navigation settlement');
assert(subframe.includes("addEventListener('click'"), 'subframe capture must record clicks');
assert(subframe.includes("addEventListener('keydown'"), 'subframe capture must record keyboard actions');
assert(subframe.includes("addEventListener('scroll'"), 'subframe capture must record scroll actions');

assert(episodeBuilder.includes('sourceContext:'), 'episode transition schema must persist source frame context');

console.log('Subframe Task Episode contract: PASS');
