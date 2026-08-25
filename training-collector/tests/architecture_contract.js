'use strict';

const assert = require('assert');
const Privacy = require('../core/privacy.js');
const ActionNormalizer = require('../core/action_normalizer.js');
const StateDiff = require('../core/state_diff.js');
const EpisodeBuilder = require('../core/episode_builder.js');

assert.equal(Privacy.classifyElementMeta({ type: 'password' }).sensitive, true);
assert.equal(Privacy.classifyElementMeta({ name: 'otp_code' }).sensitive, true);
assert.equal(Privacy.classifyElementMeta({ ariaLabel: 'Search' }).sensitive, false);

const safeUrl = Privacy.sanitizeUrl('https://example.com/search?q=private-value&token=secret#fragment');
assert.equal(safeUrl.origin, 'https://example.com');
assert.equal(safeUrl.pathname, '/search');
assert.deepEqual(safeUrl.queryKeys, ['q', 'token']);
assert.equal(safeUrl.hasHash, true);
assert.equal(JSON.stringify(safeUrl).includes('private-value'), false);
assert.equal(JSON.stringify(safeUrl).includes('secret'), false);
assert.deepEqual(Privacy.safePageTitle('Private account name'), { length: 20, empty: false });

const action = ActionNormalizer.normalize({
  kind: 'text-key',
  targetRef: 'e12',
  operation: 'backspace',
  code: 'Backspace',
  repeat: false,
  t: 125
});
assert.equal(action.actionVersion, '0.2.0');
assert.equal(action.kind, 'text-key');
assert.equal(action.operation, 'backspace');
assert.equal(action.targetRef, 'e12');

const before = {
  pageInstanceId: 'page-1',
  focusedElementRef: null,
  scroll: { x: 0, y: 0 },
  interactiveElements: [
    { ref: 'e1', enabled: true, rendered: true, inViewport: true, interactable: true, rect: { x: 0, y: 0, width: 20, height: 20 } }
  ]
};
const after = {
  pageInstanceId: 'page-1',
  focusedElementRef: 'e1',
  scroll: { x: 0, y: 10 },
  interactiveElements: [
    { ref: 'e1', enabled: true, rendered: true, inViewport: true, interactable: true, rect: { x: 0, y: -10, width: 20, height: 20 } },
    { ref: 'e2', enabled: true, rendered: true, inViewport: true, interactable: true, rect: { x: 20, y: 20, width: 20, height: 20 } }
  ]
};
const diff = StateDiff.diffObservation(before, after);
assert.equal(diff.schemaVersion, '0.5.0');
assert.equal(diff.focusedElementRef, 'e1');
assert.deepEqual(diff.scroll, { x: 0, y: 10 });
assert.deepEqual(diff.addedRefs, ['e2']);
assert.equal(diff.elementChanges[0].ref, 'e1');

const episode = EpisodeBuilder.createEpisode({
  task: { instruction: 'Search for OpenAI', type: 'web_search', args: { query: 'OpenAI' } },
  tabId: 7,
  initialObservation: { schemaVersion: '0.5.0' },
  now: '2026-08-25T00:00:00.000Z'
});
assert.equal(episode.schemaVersion, '0.5.0');
assert.equal(episode.stateEncoding, 'initial-full-then-diff');
assert.equal(episode.privacy.rawTextValuesStored, false);
assert.equal(episode.transitions.length, 0);

EpisodeBuilder.beginTransition(episode, {
  transitionId: 'page-1-t1',
  startedAtMs: 100,
  stateBeforeDiff: diff,
  action
});
assert.equal(episode.transitions.length, 1);
assert.equal(episode.transitions[0].status, 'pending');
assert.equal(episode.transitions[0].stateBefore, null);
assert.equal(episode.transitions[0].stateBeforeDiff.schemaVersion, '0.5.0');
assert.equal(episode.transitions[0].outcome.partial, true);

const matched = EpisodeBuilder.finishTransition(episode, {
  transitionId: 'page-1-t1',
  endedAtMs: 150,
  stateAfterDiff: diff,
  actionSucceeded: true
});
assert.equal(matched, true);
assert.equal(episode.transitions[0].status, 'complete');
assert.equal(episode.transitions[0].stateAfter, null);
assert.equal(episode.transitions[0].stateAfterDiff.schemaVersion, '0.5.0');
assert.equal(episode.transitions[0].outcome.partial, false);

console.log('Training Collector V0.5 architecture contract: OK');
