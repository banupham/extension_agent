'use strict';

const assert = require('assert');
const { analyze, parseInput } = require('../tools/analyze_raw');

const data = {
  exportVersion: '0.5.0',
  session: { sessionId: 'browser-test', schemaVersion: '0.5.0' },
  events: [
    { sessionSeq: 1, tsEpochMs: 1000, type: 'pointer', captureSource: 'physical', x: 1, y: 1, targetRef: 'e1', tabId: 1 },
    { sessionSeq: 2, tsEpochMs: 1016, type: 'pointer', captureSource: 'physical', x: 2, y: 2, targetRef: 'e1', tabId: 1 },
    { sessionSeq: 3, tsEpochMs: 1020, type: 'dom-click', captureSource: 'dom', targetRef: 'e1', tabId: 1 },
    { sessionSeq: 4, tsEpochMs: 1030, type: 'dom-mutation-burst', captureSource: 'mutation', recordCount: 8, tabId: 1 }
  ]
};

const report = analyze(data);
assert.strictEqual(report.totalEvents, 4);
assert.strictEqual(report.pointer.samples, 2);
assert.strictEqual(report.semanticCorrelation.eligiblePhysicalEvents, 2);
assert.strictEqual(report.semanticCorrelation.correlatedEvents, 2);
assert.strictEqual(report.semanticCorrelation.coverage, 1);
assert.strictEqual(report.dom.events, 2);
assert.strictEqual(report.dom.mutationEvents, 1);
assert.strictEqual(report.dom.mutationRecords, 8);
assert.strictEqual(report.integrity.sequenceProblems, 0);
assert.strictEqual(report.integrity.timestampBackwards, 0);
assert.strictEqual(report.integrity.privacyRedFlags, 0);

const jsonl = [
  JSON.stringify({ recordType: 'session', exportVersion: '0.5.0', session: data.session }),
  ...data.events.map(event => JSON.stringify({ recordType: 'event', ...event }))
].join('\n');
const parsed = parseInput(jsonl);
assert.strictEqual(parsed.events.length, 4);
assert.strictEqual(parsed.session.sessionId, 'browser-test');
assert.strictEqual(parsed.exportVersion, '0.5.0');

console.log('Collector V0.5 raw analysis contract: OK');
