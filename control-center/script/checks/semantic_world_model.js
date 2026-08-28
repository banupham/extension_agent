'use strict';

const assert = require('assert');
const {
  buildSemanticWorldModel,
  semanticFactMatches
} = require('../../manager/world/semantic_world_model.js');

function main() {
  const world = buildSemanticWorldModel({
    page: {
      url: 'https://www.youtube.com/results?search_query=AI',
      title: 'AI videos - YouTube',
      interactiveElements: [
        { ref: 'e1', role: 'link', label: 'AI Explained', visible: true, rect: { x: 1, y: 2, width: 3, height: 4 } },
        { ref: 'e2', role: 'button', label: 'Hidden Control', visible: false }
      ],
      pageSignals: {
        searchResultsObserved: true,
        requestedInformationCaptured: false,
        nested: { shouldNotLeak: true }
      }
    },
    browserContext: {
      tabs: [
        { tabId: 99, title: 'AI videos - YouTube', url: 'https://www.youtube.com/results?search_query=AI', active: true }
      ]
    }
  });

  assert.equal(world.page.host, 'youtube.com');
  assert.deepEqual(world.ui.visibleLabels, ['AI Explained']);
  assert.equal(world.signals.searchResultsObserved, true);
  assert.equal(Object.prototype.hasOwnProperty.call(world.signals, 'nested'), false);
  assert.equal(semanticFactMatches(world, { key: 'site.identity', operator: 'includes', value: 'youtube' }), true);
  assert.equal(semanticFactMatches(world, { key: 'content.semanticText', operator: 'includes', value: 'AI' }), true);
  assert.equal(semanticFactMatches(world, { key: 'signal.searchResultsObserved', operator: 'equals', value: true }), true);

  const serialized = JSON.stringify(world);
  for (const forbidden of ['"tabId"', '"ref"', '"rect"', '"selector"', '"privateReasoning"']) {
    assert.equal(serialized.includes(forbidden), false, `forbidden semantic world field leaked: ${forbidden}`);
  }
  assert.equal(world.privacy.observationLocalRefsStored, false);
  assert.equal(world.privacy.rawCoordinatesStored, false);

  console.log('Semantic world model contract: PASS');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('Semantic world model contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { main };
