'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const popup = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

assert(background.includes("'core/episode_capture_gate.js'"), 'background must import episode_capture_gate.js');
assert(background.includes('const EpisodeCaptureGate = globalThis.TrainingCollectorV09.EpisodeCaptureGate;'), 'background must bind EpisodeCaptureGate');
assert(background.includes('EpisodeCaptureGate.assertSnapshotReady(initial)'), 'startEpisode must require a valid initial snapshot');
assert(background.includes('EpisodeCaptureGate.assertCaptureArmed(capture)'), 'startEpisode must require capture ACK');
assert(background.includes('await saveEpisodeState({ ...EMPTY });'), 'failed capture arming must roll episode state back');
assert(background.includes('EpisodeCaptureGate.assertStopAllowed(state.episode, outcome);'), 'stopEpisode must enforce success transition gate');
assert(!background.includes("type: 'START_EPISODE_CAPTURE'\n  }, { frameId: 0 }).catch(() => {});"), 'START_EPISODE_CAPTURE failure must not be swallowed');

assert(popup.includes('function episodeTransitionCounts(episode)'), 'popup must expose complete/pending transition counts');
assert(popup.includes("stopWithOutcome('success')"), 'success button must use shared stop handler');
assert(popup.includes('showEpisode(res?.state, res?.error);'), 'popup must surface STOP_EPISODE errors');

console.log('Task Episode capture integration contract: PASS');
