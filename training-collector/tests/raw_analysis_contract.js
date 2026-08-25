'use strict';

const assert = require('assert');
const { analyze } = require('../tools/analyze_raw');

const report = analyze({
  exportVersion: '0.4.0',
  session: { sessionId: 'browser-test' },
  events: [
    { sessionSeq: 1, tsEpochMs: 1000, type: 'pointer', captureSource: 'physical', x: 1, y: 1, semanticTarget: { elementRef: 'e1' }, tabId: 1 },
    { sessionSeq: 2, tsEpochMs: 1016, type: 'pointer', captureSource: 'physical', x: 2, y: 2, semanticTarget: { elementRef: 'e1' }, tabId: 1 },
    { sessionSeq: 3, tsEpochMs: 1020, type: 'dom-click', captureSource: 'dom', elementRef: 'e1', tabId: 1 },
    { sessionSeq: 4, tsEpochMs: 1030, type: 'dom-mutation', captureSource: 'mutation', mutationType: 'attributes', tabId: 1 }
  ]
});

assert.strictEqual(report.totalEvents, 4);
assert.strictEqual(report.pointer.samples, 2);
assert.strictEqual(report.semanticCorrelation.eligiblePhysicalEvents, 2);
assert.strictEqual(report.semanticCorrelation.correlatedEvents, 2);
assert.strictEqual(report.semanticCorrelation.coverage, 1);
assert.strictEqual(report.dom.events, 2);
assert.strictEqual(report.dom.mutations, 1);
assert.strictEqual(report.integrity.sequenceProblems, 0);
assert.strictEqual(report.integrity.timestampBackwards, 0);
assert.strictEqual(report.integrity.privacyRedFlags, 0);

console.log('Collector V0.4 raw analysis contract: OK');
