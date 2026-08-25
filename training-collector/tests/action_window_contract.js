'use strict';

const assert = require('assert');
const Windows = require('../tools/build_action_windows.js');
const Analyzer = require('../tools/analyze_action_windows.js');

const raw = {
  session: { sessionId: 'browser-action-window-test' },
  events: [
    { type: 'semantic-snapshot', tsEpochMs: 850, sessionSeq: 2, pageSeq: 0, sourceSeq: 1, pageInstanceId: 'p1', tabId: 1, frameId: 0, interactiveElements: [
      { ref: 'eButton', tag: 'button', role: 'button', label: 'Thích', rect: { x: 10, y: 20, width: 80, height: 30 } },
      { ref: 'closeButton', tag: 'button', role: 'button', label: 'Đóng', rect: { x: 900, y: 30, width: 32, height: 32 } },
      { ref: 'search', tag: 'input', role: 'searchbox', label: 'Tìm kiếm', rect: { x: 20, y: 40, width: 220, height: 32 } },
      { ref: 'check', tag: 'input', role: 'checkbox', label: 'Ghi nhớ', rect: { x: 20, y: 80, width: 20, height: 20 } },
      { ref: 'country', tag: 'select', role: null, label: 'Quốc gia', rect: { x: 20, y: 120, width: 160, height: 30 } },
      { ref: 'thumb', tag: 'a', role: 'link', label: 'Video đề xuất', rect: { x: 300, y: 100, width: 220, height: 120 } },
      { ref: 'slider', tag: 'div', role: 'slider', label: 'Âm lượng', rect: { x: 500, y: 400, width: 160, height: 20 } },
      { ref: 'bodyBg', tag: 'body', role: null, label: '', rect: { x: 0, y: 0, width: 1280, height: 3000 } }
    ] },
    { type: 'pointer', phase: 'move', tsEpochMs: 900, sessionSeq: 4, pageSeq: 1, sourceSeq: 1, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'e1', pointerId: 1, x: 12, y: 24, movementX: 3, movementY: 2, buttons: 0 },
    { type: 'dom-click', tsEpochMs: 1000, sessionSeq: 7, pageSeq: 2, sourceSeq: 1, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'eChild', rawTargetRef: 'eChild', resolvedTargetRef: 'eButton', targetDescriptor: { elementRef: 'eChild', tag: 'span', role: null, label: 'Thích' }, resolvedTargetDescriptor: { elementRef: 'eButton', tag: 'button', role: 'button', label: '', rect: { x: 10, y: 20, width: 80, height: 30 } } },
    { type: 'dom-mutation-burst', tsEpochMs: 1080, sessionSeq: 8, pageSeq: 3, sourceSeq: 2, pageInstanceId: 'p1', tabId: 1, frameId: 0, recordCount: 3 },
    { type: 'route-change', tsEpochMs: 1120, sessionSeq: 9, pageSeq: 4, sourceSeq: 3, pageInstanceId: 'p1', tabId: 1, frameId: 0 },
    { type: 'dom-click', tsEpochMs: 1200, sessionSeq: 10, pageSeq: 4.01, sourceSeq: 4, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'closeButton', resolvedTargetRef: 'closeButton', resolvedTargetDescriptor: { elementRef: 'closeButton', tag: 'button', role: 'button', label: 'Đóng' } },
    { type: 'dom-focus', focused: true, tsEpochMs: 1250, sessionSeq: 11, pageSeq: 4.02, sourceSeq: 5, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'search', targetDescriptor: { elementRef: 'search', tag: 'input', role: 'searchbox', label: 'Tìm kiếm' } },
    { type: 'dom-change', checked: true, tsEpochMs: 1300, sessionSeq: 12, pageSeq: 4.03, sourceSeq: 6, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'check', targetDescriptor: { elementRef: 'check', tag: 'input', role: 'checkbox', label: 'Ghi nhớ' } },
    { type: 'dom-change', selectedIndex: 2, tsEpochMs: 1350, sessionSeq: 13, pageSeq: 4.04, sourceSeq: 7, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'country', targetDescriptor: { elementRef: 'country', tag: 'select', role: null, label: 'Quốc gia' } },
    { type: 'dom-submit', tsEpochMs: 1400, sessionSeq: 14, pageSeq: 4.05, sourceSeq: 8, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'form1', targetDescriptor: { elementRef: 'form1', tag: 'form', role: null, label: '' } },

    { type: 'pointer', phase: 'down', tsEpochMs: 1500, sessionSeq: 15, pageSeq: 4.1, sourceSeq: 9, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'slider', pointerId: 1, x: 510, y: 410, button: 0, buttons: 1, pressure: 0.5 },
    { type: 'pointer', phase: 'move', tsEpochMs: 1540, sessionSeq: 16, pageSeq: 4.2, sourceSeq: 10, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'slider', pointerId: 1, x: 555, y: 410, buttons: 1, pressure: 0.5 },
    { type: 'pointer', phase: 'move', tsEpochMs: 1580, sessionSeq: 17, pageSeq: 4.3, sourceSeq: 11, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'slider', pointerId: 1, x: 590, y: 410, buttons: 1, pressure: 0.5 },
    { type: 'pointer', phase: 'up', tsEpochMs: 1620, sessionSeq: 18, pageSeq: 4.4, sourceSeq: 12, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'slider', pointerId: 1, x: 600, y: 410, button: 0, buttons: 0, pressure: 0 },

    { type: 'wheel', tsEpochMs: 2000, sessionSeq: 20, pageSeq: 5, sourceSeq: 1, pageInstanceId: 'p1', tabId: 1, frameId: 0, deltaX: 120, deltaY: 4, x: 400, y: 300, targetRef: 'carousel' },
    { type: 'wheel', tsEpochMs: 2070, sessionSeq: 21, pageSeq: 6, sourceSeq: 2, pageInstanceId: 'p1', tabId: 1, frameId: 0, deltaX: 140, deltaY: 3, x: 400, y: 300, targetRef: 'carousel' },
    { type: 'wheel', tsEpochMs: 2600, sessionSeq: 22, pageSeq: 7, sourceSeq: 3, pageInstanceId: 'p1', tabId: 1, frameId: 0, deltaX: 0, deltaY: 180, x: 600, y: 500, targetRef: 'feed' },

    { type: 'keyboard', phase: 'down', tsEpochMs: 3000, sessionSeq: 30, pageSeq: 8, sourceSeq: 1, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'search', operation: 'printable', keyClass: 'printable', key: null, code: null },
    { type: 'keyboard', phase: 'up', tsEpochMs: 3070, sessionSeq: 31, pageSeq: 9, sourceSeq: 2, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'search', operation: 'printable', keyClass: 'printable', key: null, code: null },
    { type: 'keyboard', phase: 'down', tsEpochMs: 3140, sessionSeq: 32, pageSeq: 10, sourceSeq: 3, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'search', operation: 'enter', keyClass: 'Enter', key: null, code: 'Enter' },

    { type: 'dom-hover-enter', tsEpochMs: 4000, sessionSeq: 40, pageSeq: 11, sourceSeq: 1, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'thumb' },
    { type: 'dom-hover-dwell', tsEpochMs: 4400, sessionSeq: 41, pageSeq: 12, sourceSeq: 2, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'thumb', dwellMs: 400 },
    { type: 'dom-mutation-burst', tsEpochMs: 4450, sessionSeq: 42, pageSeq: 13, sourceSeq: 3, pageInstanceId: 'p1', tabId: 1, frameId: 0, recordCount: 4, targetRefs: ['thumb'], addedRefs: ['previewControl'], attributes: {} },
    { type: 'dom-hover-leave', tsEpochMs: 4800, sessionSeq: 43, pageSeq: 14, sourceSeq: 4, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'thumb', dwellMs: 800 },
    { type: 'dom-hover-enter', tsEpochMs: 5000, sessionSeq: 50, pageSeq: 15, sourceSeq: 5, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'bodyBg' },
    { type: 'dom-hover-leave', tsEpochMs: 5050, sessionSeq: 51, pageSeq: 16, sourceSeq: 6, pageInstanceId: 'p1', tabId: 1, frameId: 0, targetRef: 'bodyBg', dwellMs: 50 }
  ]
};

const result = Windows.buildActionWindows(raw);
assert.strictEqual(result.actionWindowVersion, '0.1.3');
assert.strictEqual(result.sourceSessionId, 'browser-action-window-test');
assert.strictEqual(result.ordering.primary, 'tsEpochMs');
assert.strictEqual(result.ordering.durabilityOnly, 'sessionSeq');
assert.strictEqual(result.privacy.printableHumanKeyContentStored, false);
assert.strictEqual(result.derivation.rawFactsMutated, false);
assert.strictEqual(result.derivation.filteredHoverNoiseCount, 1);

const click = result.windows.find(x => x.actionType === 'click' && x.target.targetRef === 'eButton');
assert(click);
assert.strictEqual(click.target.label, 'Thích');
assert.strictEqual(click.target.role, 'button');
assert.strictEqual(click.target.labelEnriched, true);
assert.ok(['semantic-snapshot', 'target'].includes(click.target.labelSource));
assert.strictEqual(click.outcome.mutationBurstCount >= 1, true);
assert.strictEqual(click.outcome.routeChangeObserved, true);
const pointerBefore = click.before.find(x => x.type === 'pointer');
assert(pointerBefore);
assert.strictEqual(pointerBefore.x, 12);

const dismiss = result.windows.find(x => x.actionType === 'dismiss');
assert(dismiss);
assert.strictEqual(dismiss.target.label, 'Đóng');

const focus = result.windows.find(x => x.actionType === 'focus');
assert(focus);
assert.strictEqual(focus.target.label, 'Tìm kiếm');

const toggle = result.windows.find(x => x.actionType === 'toggle' && x.target.targetRef === 'check');
assert(toggle);
assert.strictEqual(toggle.action.checked, true);

const select = result.windows.find(x => x.actionType === 'selectOption');
assert(select);
assert.strictEqual(select.action.selectedIndex, 2);

const submit = result.windows.find(x => x.actionType === 'submit');
assert(submit);

const drag = result.windows.find(x => x.actionType === 'drag');
assert(drag);
assert.strictEqual(drag.target.targetRef, 'slider');
assert.strictEqual(drag.target.label, 'Âm lượng');
assert.ok(drag.action.distancePx >= 90);
assert.strictEqual(drag.action.points[0].phase, 'down');
assert.strictEqual(drag.action.points.at(-1).phase, 'up');

const horizontal = result.windows.find(x => x.actionType === 'scrollHorizontal');
assert(horizontal);
assert.strictEqual(horizontal.action.eventCount, 2);
assert.strictEqual(horizontal.action.deltaX, 260);
assert.strictEqual(horizontal.action.events[0].deltaX, 120);

const vertical = result.windows.find(x => x.actionType === 'scrollVertical');
assert(vertical);
assert.strictEqual(vertical.action.events[0].deltaY, 180);

const typing = result.windows.find(x => x.actionType === 'typeText');
assert(typing);
assert.strictEqual(typing.action.printableContentStored, false);
assert.strictEqual(typing.target.label, 'Tìm kiếm');
assert.strictEqual(typing.action.events[0].code, null);
assert.strictEqual(typing.action.events[2].code, 'Enter');
assert.ok(!JSON.stringify(typing).includes('"key":"'));

const hover = result.windows.find(x => x.actionType === 'hoverAndObserve');
assert(hover);
assert.strictEqual(hover.outcome.previewLikeStateChange, true);
assert.strictEqual(hover.target.label, 'Video đề xuất');
assert.ok(!result.windows.some(x => x.target?.targetRef === 'bodyBg'));

const quality = Analyzer.summarizeActionWindows(result);
assert.strictEqual(quality.sourceSessionId, 'browser-action-window-test');
assert.ok(quality.totalWindows >= 10);
assert.ok(quality.targetQuality.labelCoverage > 0.5);
assert.ok(quality.targetQuality.enriched >= 1);
assert.ok(quality.behaviorEvidence.dragCount >= 1);
assert.ok(quality.behaviorEvidence.horizontalScrollCount >= 1);
assert.strictEqual(quality.privacy.printableLeakSuspected, 0);
assert.strictEqual(quality.privacy.printableContentContractOk, true);

const scrambled = [
  { type: 'pointer', tsEpochMs: 2000, sessionSeq: 1 },
  { type: 'pointer', tsEpochMs: 1000, sessionSeq: 999 }
].sort(Windows.chronologicalOrder);
assert.strictEqual(scrambled[0].tsEpochMs, 1000);

console.log('Training Collector Phase A1 Action Window contract OK');
