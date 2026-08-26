'use strict';

const assert = require('assert');
const View = require('../core/strategy_episode_view.js');

function walkKeys(value, out = []) {
  if (Array.isArray(value)) {
    value.forEach(item => walkKeys(item, out));
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value)) {
    out.push(key);
    walkKeys(child, out);
  }
  return out;
}

function main() {
  const snapshot = {
    schemaVersion: '0.5.0',
    pageInstanceId: 'page-1',
    page: {
      origin: 'https://example.test',
      pathname: '/search',
      queryKeys: ['q', 'token'],
      hasHash: true
    },
    titleMetrics: { length: 20, empty: false },
    viewport: { width: 1200, height: 800, devicePixelRatio: 2 },
    scroll: { x: 10, y: 30 },
    focusedElementRef: 'e1',
    interactiveElements: [
      {
        ref: 'e1',
        tag: 'button',
        role: 'button',
        label: 'Submit',
        editable: false,
        enabled: true,
        rendered: true,
        inViewport: true,
        interactable: true,
        visible: true,
        selector: '#private-id',
        selectorCandidates: [{ type: 'id', value: '#private-id', score: 1 }],
        rect: { x: 100, y: 200, width: 120, height: 40 }
      }
    ],
    registry: { size: 1 },
    tabId: 77
  };

  const observation = View.sanitizeSnapshot(snapshot, {
    observationId: 'strategy-obs-1',
    capturedAt: '2026-08-27T00:00:00.000Z'
  });
  assert.equal(observation.strategyObservationVersion, '0.1.0');
  assert.equal(observation.url, 'https://example.test/search');
  assert.equal(observation.title, '');
  assert.equal(observation.focusedElement.ref, 'e1');
  assert.equal(observation.interactiveElements[0].rect.x, 100);
  assert.equal(observation.privacy.redacted, true);
  assert.equal(observation.privacy.selectorsStored, false);
  assert.equal(observation.privacy.tabIdStored, false);

  const keys = walkKeys(observation).map(key => key.toLowerCase());
  assert.equal(keys.includes('selector'), false);
  assert.equal(keys.includes('selectorcandidates'), false);
  assert.equal(keys.includes('tabid'), false);
  assert.equal(JSON.stringify(observation).includes('private-id'), false);
  assert.equal(JSON.stringify(observation).includes('token'), false);

  const rawUrl = View.sanitizeSnapshot({
    page: 'https://example.test/path?q=secret#frag',
    interactiveElements: []
  });
  assert.equal(rawUrl.url, 'https://example.test/path');

  console.log('Strategy episode observation view contract: PASS');
}

main();
