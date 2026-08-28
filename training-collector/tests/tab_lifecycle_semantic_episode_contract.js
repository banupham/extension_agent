'use strict';

const assert = require('assert');

function normalizeTabLifecycleEvents(events) {
  return events.map(event => ({
    type: event.type,
    logicalContext: event.logicalContext || 'default'
  }));
}

function sameSemanticEpisode(events) {
  const normalized = normalizeTabLifecycleEvents(events);
  return normalized.length > 0 && normalized.every(event => event.logicalContext === normalized[0].logicalContext);
}

const M14 = [
  { type: 'TAB_OPEN', tabId: 10, logicalContext: 'task-m14' },
  { type: 'TAB_SWITCH', tabId: 11, logicalContext: 'task-m14' },
  { type: 'NAV_BACK', tabId: 11, logicalContext: 'task-m14' },
  { type: 'NAV_FORWARD', tabId: 11, logicalContext: 'task-m14' },
  { type: 'RELOAD', tabId: 11, logicalContext: 'task-m14' },
  { type: 'TAB_CLOSE', tabId: 12, logicalContext: 'task-m14' }
];

assert.strictEqual(sameSemanticEpisode(M14), true);

console.log('tab_lifecycle_semantic_episode_contract: ok');
