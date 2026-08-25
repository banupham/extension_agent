'use strict';

const assert = require('assert');
const { createStrategy, validateTask, validateObservation, validateDecision } = require('../../manager/strategy');

async function main() {
  const task = validateTask({
    taskId: 'strategy-smoke',
    type: 'web_search',
    instruction: 'Search for OpenAI',
    args: { query: 'OpenAI' }
  });

  const observation = validateObservation({
    url: 'https://www.google.com/',
    interactiveElements: [
      {
        id: 'searchbox-1',
        tag: 'textarea',
        role: 'combobox',
        label: 'Search',
        selector: 'textarea[name=q]',
        visible: true,
        enabled: true,
        editable: true
      }
    ]
  });

  const strategy = createStrategy({ provider: 'baseline' });
  const history = [];

  const d1 = validateDecision(await strategy.decide({ task, observation, history }));
  assert.equal(d1.status, 'act');
  assert.equal(d1.action.action, 'focusSelector');
  history.push({ decision: d1 });

  const d2 = validateDecision(await strategy.decide({ task, observation, history }));
  assert.equal(d2.status, 'act');
  assert.equal(d2.action.action, 'type');
  assert.equal(d2.action.text, 'OpenAI');
  history.push({ decision: d2 });

  const d3 = validateDecision(await strategy.decide({ task, observation, history }));
  assert.equal(d3.status, 'act');
  assert.equal(d3.action.action, 'pressKey');
  assert.equal(d3.action.key, 'Enter');
  history.push({ decision: d3 });

  const doneObservation = validateObservation({
    ...observation,
    url: 'https://www.google.com/search?q=OpenAI',
    pageSignals: { searchResultsVisible: true, query: 'OpenAI' }
  });
  const d4 = validateDecision(await strategy.decide({ task, observation: doneObservation, history }));
  assert.equal(d4.status, 'done');

  console.log('strategy_contract: PASS');
}

main().catch(err => {
  console.error('strategy_contract: FAIL');
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
