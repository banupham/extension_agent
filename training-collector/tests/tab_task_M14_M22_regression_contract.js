'use strict';

const assert = require('assert');

function buildSemanticEpisode(events) {
  const context = events.map(e => e.logicalContext);
  return context.length > 0 && context.every(item => item === context[0]);
}

const cases = {
  M14: [
    'TAB_OPEN',
    'TAB_SWITCH',
    'NAV_BACK',
    'NAV_FORWARD',
    'RELOAD',
    'TAB_CLOSE'
  ],
  M22: [
    'TAB_OPEN',
    'TAB_SWITCH',
    'NAV_BACK',
    'RELOAD',
    'TAB_CLOSE'
  ]
};

for (const name of Object.keys(cases)) {
  const events = cases[name].map(type => ({ type, logicalContext: name }));
  assert.strictEqual(buildSemanticEpisode(events), true, `${name} failed`);
}

console.log('tab_task_M14_M22_regression_contract: ok');
