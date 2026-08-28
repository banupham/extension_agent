'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { diagnose } = require('../tools/diagnose_strategy_target_backfill.js');

function observation(id) {
  return {
    observationId: id,
    url: 'http://review.test/',
    title: '',
    interactiveElements: [],
    pageSignals: {},
    privacy: { redacted: true, selectorsStored: false, tabIdStored: false }
  };
}

function review(episodeId, transitionId, ref) {
  return {
    reviewExportVersion: '0.1.0',
    episodeId,
    strategyReady: true,
    task: { instruction: 'Open the chosen item', type: 'generic' },
    transitions: [{
      transitionId,
      status: 'complete',
      rawAction: { actionVersion: '0.1.0', kind: 'click', targetRef: ref, t: 1 },
      strategyObservationBefore: observation(`${transitionId}-before`),
      strategyObservationAfter: observation(`${transitionId}-after`),
      outcome: { actionSucceeded: true, partial: false }
    }],
    finalOutcome: { status: 'success' }
  };
}

function packItem(episodeId, sourceFile, transitionId) {
  return {
    episodeId,
    sourceFile,
    status: 'awaiting-human-review',
    task: { instruction: 'Open the chosen item', type: 'generic' },
    finalOutcomeStatus: 'success',
    proposals: [{
      transitionId,
      evidence: { targetBefore: null, actionSucceededCaptured: true },
      proposal: { actionTypeHint: 'click' }
    }]
  };
}

function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-target-diagnostic-'));
  try {
    const rawDir = path.join(temp, 'raw');
    fs.mkdirSync(rawDir, { recursive: true });
    const cases = [
      ['ep-a', 'page-a-t1', 'e1'],
      ['ep-b', 'page-b-t1', 'e2'],
      ['ep-c', 'page-c-t1', 'e3']
    ];
    const items = [];
    for (const [episodeId, transitionId, ref] of cases) {
      const file = path.join(temp, `${episodeId}.task-episode-review.json`);
      fs.writeFileSync(file, JSON.stringify(review(episodeId, transitionId, ref)));
      items.push(packItem(episodeId, file, transitionId));
    }
    fs.writeFileSync(path.join(temp, 'review-pack.json'), JSON.stringify({ items }));
    fs.writeFileSync(path.join(rawDir, 's1.raw.json'), JSON.stringify({
      session: { sessionId: 's1' },
      events: [
        {
          type: 'dom-click', pageInstanceId: 'page-a', targetRef: 'e1',
          targetDescriptor: { elementRef: 'e1', tag: 'button', role: 'button', label: 'Alpha', selector: '#alpha' }
        },
        {
          type: 'dom-click', pageInstanceId: 'page-b', targetRef: 'e9',
          targetDescriptor: { elementRef: 'e9', tag: 'a', role: 'link', label: 'Beta', rect: { x: 1, y: 2, width: 3, height: 4 } }
        },
        {
          type: 'dom-click', pageInstanceId: 'other-page', targetRef: 'e3',
          targetDescriptor: { elementRef: 'e3', tag: 'button', role: 'button', label: 'Gamma' }
        }
      ]
    }));

    const result = diagnose(path.join(temp, 'review-pack.json'), rawDir);
    assert.equal(result.requestedCoverage.requestedTransitionCount, 3);
    assert.equal(result.requestedCoverage.exactDescriptorKeyMatchCount, 1);
    assert.equal(result.requestedCoverage.pagePresentButExactKeyMissingCount, 1);
    assert.equal(result.requestedCoverage.targetRefSeenOnOtherPageCount, 1);
    assert.equal(result.requestedCoverage.descriptorPageMissingCount, 0);
    assert.equal(result.rawCoverage.targetDescriptorEventCount, 3);
    assert.equal(result.rawCoverage.descriptorIndexKeyCount, 3);
    assert.equal(result.policy.aggregateOnly, true);
    assert.equal(result.policy.autoTrainEligible, false);

    const text = JSON.stringify(result);
    assert.equal(text.includes('page-a'), false);
    assert.equal(text.includes('other-page'), false);
    assert.equal(text.includes('"e1"'), false);
    assert.equal(text.includes('#alpha'), false);
    assert.equal(text.includes('selector'), true); // policy flag name only
    assert.equal(text.includes('"rect"'), false);

    console.log('Strategy target backfill diagnostic contract: PASS');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error('Strategy target backfill diagnostic contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { main };
