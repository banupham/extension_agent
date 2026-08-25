'use strict';

const assert = require('assert');
const Privacy = require('../core/privacy.js');
const ActionNormalizer = require('../core/action_normalizer.js');
const EpisodeBuilder = require('../core/episode_builder.js');

assert.equal(Privacy.classifyElementMeta({ type: 'password' }).sensitive, true);
assert.equal(Privacy.classifyElementMeta({ name: 'otp_code' }).sensitive, true);
assert.equal(Privacy.classifyElementMeta({ ariaLabel: 'Search' }).sensitive, false);

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

const episode = EpisodeBuilder.createEpisode({
  task: { instruction: 'Search for OpenAI', type: 'web_search', args: { query: 'OpenAI' } },
  tabId: 7,
  initialObservation: { schemaVersion: '0.2.0' },
  now: '2026-08-25T00:00:00.000Z'
});
assert.equal(episode.schemaVersion, '0.2.0');
assert.equal(episode.privacy.rawTextValuesStored, false);
assert.equal(episode.transitions.length, 0);

EpisodeBuilder.beginTransition(episode, {
  transitionId: 'page-1-t1',
  startedAtMs: 100,
  stateBefore: { focusedElementRef: null },
  action
});
assert.equal(episode.transitions.length, 1);
assert.equal(episode.transitions[0].status, 'pending');
assert.equal(episode.transitions[0].outcome.partial, true);

const matched = EpisodeBuilder.finishTransition(episode, {
  transitionId: 'page-1-t1',
  endedAtMs: 150,
  stateAfter: { focusedElementRef: 'e12' },
  actionSucceeded: true
});
assert.equal(matched, true);
assert.equal(episode.transitions[0].status, 'complete');
assert.equal(episode.transitions[0].outcome.partial, false);

console.log('Training Collector V0.2 architecture contract: OK');
