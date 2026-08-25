'use strict';

const assert = require('assert');
const Windows = require('../tools/build_action_windows.js');

const raw = {
  session: { sessionId: 'browser-action-window-test' },
  events: [
    { type: 'semantic-snapshot', tsEpochMs: 850, sessionSeq: 2, pageSeq: 0, sourceSeq: 1, pageInstanceId: 'p1', tabId: 1, frameId: 0, interactiveElements: [
      { ref: 'eButton', tag: 'button', role: 'button', label: 'Thích', rect: { x: 10, y: 20, width: 80, height: 30 } },
      { ref: 'search', tag: 'input', role: 'searchbox', label: 'Tìm kiếm', rect: { x: 20, y: 40, width: 220, height: 32 } },
      { ref: 'thumb', tag: 'a', role: 'link', label: 'Video đề xuất', rect: { x: 300, y: 100, width: 220, height: 120 } },
      { ref: 'bodyBg', tag: 'body', role: null, label: '', rect: { x: 0, y: 0, width: 1280, height: 3000 } }
    ] },
    { type: 'pointer', tsEpochMs: 900, sessionSeq: 4, pageSeq: 1, sourceSeq: 1, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'e1' },
    { type: 'dom-click', tsEpochMs: 1000, sessionSeq: 7, pageSeq: 2, sourceSeq: 1, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'eChild', rawTargetRef: 'eChild', resolvedTargetRef: 'eButton', rawTarget: { tag: 'span', label: 'Thích' }, resolvedTarget: { tag: 'button', role: 'button', label: '', rect: { x: 10, y: 20, width: 80, height: 30 } } },
    { type: 'dom-mutation-burst', tsEpochMs: 1080, sessionSeq: 8, pageSeq: 3, sourceSeq: 2, pageInstanceId: 'p1', tabId: 1, frameId: 0, recordCount: 3 },
    { type: 'route-change', tsEpochMs: 1120, sessionSeq: 9, pageSeq: 4, sourceSeq: 3, pageInstanceId: 'p1', tabId: 1, frameId: 0 },

    { type: 'wheel', tsEpochMs: 2000, sessionSeq: 20, pageSeq: 5, sourceSeq: 1, pageInstanceId: 'p1', tabId: 1, frameId: 0, deltaX: 120, deltaY: 4, targetRef: 'carousel' },
    { type: 'wheel', tsEpochMs: 2070, sessionSeq: 21, pageSeq: 6, sourceSeq: 2, pageInstanceId: 'p1', tabId: 1, frameId: 0, deltaX: 140, deltaY: 3, targetRef: 'carousel' },
    { type: 'wheel', tsEpochMs: 2600, sessionSeq: 22, pageSeq: 7, sourceSeq: 3, pageInstanceId: 'p1', tabId: 1, frameId: 0, deltaX: 0, deltaY: 180, targetRef: 'feed' },

    { type: 'keyboard', tsEpochMs: 3000, sessionSeq: 30, pageSeq: 8, sourceSeq: 1, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'search', operation: 'printable', keyClass: 'printable', key: null, code: null },
    { type: 'keyboard', tsEpochMs: 3070, sessionSeq: 31, pageSeq: 9, sourceSeq: 2, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'search', operation: 'printable', keyClass: 'printable', key: null, code: null },
    { type: 'keyboard', tsEpochMs: 3140, sessionSeq: 32, pageSeq: 10, sourceSeq: 3, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'search', operation: 'Enter', keyClass: 'control', key: null, code: null },

    { type: 'dom-hover-enter', tsEpochMs: 4000, sessionSeq: 40, pageSeq: 11, sourceSeq: 1, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'thumb' },
    { type: 'dom-hover-dwell', tsEpochMs: 4400, sessionSeq: 41, pageSeq: 12, sourceSeq: 2, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'thumb', dwellMs: 400 },
    { type: 'dom-mutation-burst', tsEpochMs: 4450, sessionSeq: 42, pageSeq: 13, sourceSeq: 3, pageInstanceId: 'p1', tabId: 1, frameId: 0, recordCount: 4, targetRefs: ['thumb'], addedRefs: ['previewControl'], attributes: {} },
    { type: 'dom-hover-leave', tsEpochMs: 4800, sessionSeq: 43, pageSeq: 14, sourceSeq: 4, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'thumb', dwellMs: 800 },

    { type: 'dom-hover-enter', tsEpochMs: 5000, sessionSeq: 50, pageSeq: 15, sourceSeq: 5, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'bodyBg' },
    { type: 'dom-hover-leave', tsEpochMs: 5050, sessionSeq: 51, pageSeq: 16, sourceSeq: 6, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'bodyBg', dwellMs: 50 }
  ]
};

const result = Windows.buildActionWindows(raw);
assert.strictEqual(result.actionWindowVersion, '0.1.1');
assert.strictEqual(result.sourceSessionId, 'browser-action-window-test');
assert.strictEqual(result.ordering.primary, 'tsEpochMs');
assert.strictEqual(result.ordering.durabilityOnly, 'sessionSeq');
assert.strictEqual(result.privacy.printableHumanKeyContentStored, false);
assert.strictEqual(result.derivation.rawFactsMutated, false);
assert.strictEqual(result.derivation.filteredHoverNoiseCount, 1);

const click = result.windows.find(x => x.actionType === 'click');
assert(click);
assert.strictEqual(click.target.targetRef, 'eButton');
assert.strictEqual(click.target.label, 'Thích');
assert.strictEqual(click.target.role, 'button');
assert.strictEqual(click.target.labelEnriched, true);
assert.ok(['semantic-snapshot', 'raw-descendant'].includes(click.target.labelSource));
assert.strictEqual(click.outcome.mutationBurstCount, 1);
assert.strictEqual(click.outcome.routeChangeObserved, true);
assert.ok(click.before.some(x => x.type === 'pointer'));

const horizontal = result.windows.find(x => x.actionType === 'scrollHorizontal');
assert(horizontal);
assert.strictEqual(horizontal.action.eventCount, 2);
assert.strictEqual(horizontal.action.deltaX, 260);

const vertical = result.windows.find(x => x.actionType === 'scrollVertical');
assert(vertical);
assert.strictEqual(vertical.action.eventCount, 1);

const typing = result.windows.find(x => x.actionType === 'typeText');
assert(typing);
assert.strictEqual(typing.action.eventCount, 3);
assert.strictEqual(typing.action.printableContentStored, false);
assert.strictEqual(typing.target.label, 'Tìm kiếm');
assert.ok(!JSON.stringify(typing).includes('"key":"'));

const hover = result.windows.find(x => x.actionType === 'hoverAndObserve');
assert(hover);
assert.strictEqual(hover.action.derivedHoverType, 'hover-preview');
assert.strictEqual(hover.outcome.previewLikeStateChange, true);
assert.strictEqual(hover.target.label, 'Video đề xuất');
assert.ok(!result.windows.some(x => x.target?.targetRef === 'bodyBg'));

const scrambled = [
  { type: 'pointer', tsEpochMs: 2000, sessionSeq: 1 },
  { type: 'pointer', tsEpochMs: 1000, sessionSeq: 999 }
].sort(Windows.chronologicalOrder);
assert.strictEqual(scrambled[0].tsEpochMs, 1000);

console.log('Training Collector Phase A1 Action Window contract OK');
