'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Semantics = require('../tools/build_action_semantics.js');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const manifest = JSON.parse(read('manifest.json'));
const content = read('content.js');
const domCapture = read('capture/dom_capture.js');
const hoverTrace = read('observer/hover_trace.js');
const resolver = read('correlation/action_target_resolver.js');
const rawStore = read('core/raw_session_store.js');

assert.ok(/^0\.7\./.test(manifest.version));
assert.ok(manifest.name.includes('V0.7'));
assert.ok(manifest.content_scripts[0].js.includes('correlation/action_target_resolver.js'));
assert.ok(manifest.content_scripts[0].js.includes('observer/hover_trace.js'));

assert.ok(content.includes('pageSeq'));
assert.ok(content.includes('sourceSeq'));
assert.ok(content.includes('decorateEvent'));
assert.ok(content.includes('createActionTargetResolver'));
assert.ok(content.includes('createHoverTrace'));

assert.ok(domCapture.includes('rawTargetRef'));
assert.ok(domCapture.includes('resolvedTargetRef'));
assert.ok(domCapture.includes('targetResolution'));
assert.ok(resolver.includes('composed-path-actionable'));
assert.ok(resolver.includes('element-from-point-actionable'));
assert.ok(hoverTrace.includes("type: 'dom-hover-enter'"));
assert.ok(hoverTrace.includes("type: 'dom-hover-dwell'"));
assert.ok(hoverTrace.includes("type: 'dom-hover-leave'"));
assert.ok(rawStore.includes("const VERSION = '0.7.2'"));
assert.ok(rawStore.includes('actionTargetResolution'));

const sample = {
  session: { sessionId: 'browser-test' },
  events: [
    { type: 'dom-hover-enter', pageInstanceId: 'p1', pageSeq: 1, tsEpochMs: 1000, targetRef: 'e10' },
    { type: 'dom-hover-dwell', pageInstanceId: 'p1', pageSeq: 2, tsEpochMs: 1400, targetRef: 'e10', dwellMs: 400 },
    { type: 'dom-mutation-burst', pageInstanceId: 'p1', pageSeq: 3, tsEpochMs: 1450, recordCount: 12, targetRefs: ['e10'], addedRefs: ['e11'], removedRefs: [], attributes: {} },
    { type: 'dom-hover-leave', pageInstanceId: 'p1', pageSeq: 4, tsEpochMs: 1800, targetRef: 'e10', dwellMs: 800 }
  ]
};
const derived = Semantics.buildActionSemantics(sample);
assert.equal(derived.hoverActions.length, 1);
assert.equal(derived.hoverActions[0].actionType, 'hover-preview');
assert.equal(derived.hoverActions[0].targetRef, 'e10');
assert.equal(derived.hoverActions[0].outcome.mutationRecordCount, 12);
assert.equal(derived.hoverActions[0].outcome.clickOccurred, false);
assert.deepEqual(derived.hoverActions[0].outcome.addedRefs, ['e11']);

const clicked = Semantics.buildHoverActions([
  { type: 'dom-hover-enter', pageInstanceId: 'p1', pageSeq: 1, tsEpochMs: 1000, targetRef: 'e10' },
  { type: 'dom-hover-dwell', pageInstanceId: 'p1', pageSeq: 2, tsEpochMs: 1400, targetRef: 'e10', dwellMs: 400 },
  { type: 'dom-click', pageInstanceId: 'p1', pageSeq: 3, tsEpochMs: 1500, targetRef: 'e1', resolvedTargetRef: 'e10' },
  { type: 'dom-mutation-burst', pageInstanceId: 'p1', pageSeq: 4, tsEpochMs: 1550, recordCount: 5, targetRefs: ['e10'], addedRefs: [], removedRefs: [], attributes: {} },
  { type: 'dom-hover-leave', pageInstanceId: 'p1', pageSeq: 5, tsEpochMs: 1700, targetRef: 'e10', dwellMs: 700 }
]);
assert.equal(clicked.length, 1);
assert.notEqual(clicked[0].actionType, 'hover-preview');
assert.equal(clicked[0].outcome.clickOccurred, true);

console.log('Training Collector V0.7.x action semantics contract OK');
