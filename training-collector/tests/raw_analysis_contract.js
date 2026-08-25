'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { analyze, parseInput, readInputFile } = require('../tools/analyze_raw');

const data = {
  exportVersion: '0.7.2',
  session: { sessionId: 'browser-test', schemaVersion: '0.7.2' },
  events: [
    { sessionSeq: 1, tsEpochMs: 1000, type: 'frame-context', captureSource: 'semantic', pageInstanceId: 'p1', frameId: 0, documentId: 'd1', tabId: 1, isTopFrame: true },
    { sessionSeq: 2, tsEpochMs: 1001, type: 'semantic-snapshot', captureSource: 'semantic', pageInstanceId: 'p1', frameId: 0, documentId: 'd1', tabId: 1 },
    { sessionSeq: 3, tsEpochMs: 1002, type: 'collector-stream-start', captureSource: 'health', pageInstanceId: 'p1', frameId: 0, documentId: 'd1', tabId: 1, isTopFrame: true, sourceEventCounts: { semantic: 2 } },
    { sessionSeq: 4, tsEpochMs: 1010, type: 'pointer', captureSource: 'physical', x: 1, y: 1, targetRef: 'e1', pageInstanceId: 'p1', frameId: 0, documentId: 'd1', tabId: 1 },
    { sessionSeq: 5, tsEpochMs: 1026, type: 'pointer', captureSource: 'physical', x: 2, y: 2, targetRef: 'e1', pageInstanceId: 'p1', frameId: 0, documentId: 'd1', tabId: 1 },
    { sessionSeq: 6, tsEpochMs: 1030, type: 'dom-click', captureSource: 'dom', targetRef: 'e1', pageInstanceId: 'p1', frameId: 0, documentId: 'd1', tabId: 1 },
    { sessionSeq: 7, tsEpochMs: 1040, type: 'dom-mutation-burst', captureSource: 'mutation', recordCount: 8, pageInstanceId: 'p1', frameId: 0, documentId: 'd1', tabId: 1 },
    { sessionSeq: 8, tsEpochMs: 1050, type: 'route-change', captureSource: 'navigation', pageInstanceId: 'p1', frameId: 0, documentId: 'd1', tabId: 1 },
    { sessionSeq: 9, tsEpochMs: 1051, type: 'semantic-snapshot', captureSource: 'semantic', pageInstanceId: 'p1', frameId: 0, documentId: 'd1', tabId: 1 },
    { sessionSeq: 10, tsEpochMs: 1100, type: 'collector-stream-health', captureSource: 'health', pageInstanceId: 'p1', frameId: 0, documentId: 'd1', tabId: 1, isTopFrame: true, modules: { physical: true, dom: true, mutation: true, hover: true, navigation: true }, sourceEventCounts: { semantic: 3, physical: 2, dom: 1, mutation: 1, navigation: 1 } }
  ]
};

const report = analyze(data);
assert.strictEqual(report.totalEvents, 10);
assert.strictEqual(report.pointer.samples, 2);
assert.strictEqual(report.semanticCorrelation.eligiblePhysicalEvents, 2);
assert.strictEqual(report.semanticCorrelation.correlatedEvents, 2);
assert.strictEqual(report.semanticCorrelation.coverage, 1);
assert.strictEqual(report.dom.events, 2);
assert.strictEqual(report.dom.mutationEvents, 1);
assert.strictEqual(report.dom.mutationRecords, 8);
assert.strictEqual(report.frames.uniqueTabFrames, 1);
assert.strictEqual(report.frames.uniqueDocuments, 1);
assert.strictEqual(report.frames.uniquePageInstances, 1);
assert.strictEqual(report.frames.frameContextEvents, 1);
assert.strictEqual(report.navigation.routeChanges, 1);
assert.strictEqual(report.navigation.semanticSnapshots, 2);
assert.strictEqual(report.streamHealth.pagesObserved, 1);
assert.strictEqual(report.streamHealth.missingInitialSemantic, 0);
assert.strictEqual(report.streamHealth.physicalOnlySuspicions, 0);
assert.strictEqual(report.integrity.sequenceProblems, 0);
assert.strictEqual(report.integrity.timestampBackwards, 0);
assert.strictEqual(report.integrity.privacyRedFlags, 0);

const jsonl = [
  JSON.stringify({ recordType: 'session', exportVersion: '0.7.2', session: data.session }),
  ...data.events.map(event => JSON.stringify({ recordType: 'event', ...event }))
].join('\n');
const parsed = parseInput(jsonl);
assert.strictEqual(parsed.events.length, 10);
assert.strictEqual(parsed.session.sessionId, 'browser-test');
assert.strictEqual(parsed.exportVersion, '0.7.2');

const temp = path.join(os.tmpdir(), `collector-analysis-${process.pid}.raw.jsonl.gz`);
fs.writeFileSync(temp, zlib.gzipSync(Buffer.from(jsonl, 'utf8')));
try {
  const gzParsed = readInputFile(temp);
  assert.strictEqual(gzParsed.events.length, 10);
  assert.strictEqual(gzParsed.session.schemaVersion, '0.7.2');
} finally {
  fs.unlinkSync(temp);
}

console.log('Collector V0.7.2 raw analysis contract: OK');
