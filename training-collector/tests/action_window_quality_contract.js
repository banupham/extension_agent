'use strict';

const assert = require('assert');
const Windows = require('../tools/build_action_windows.js');
const Quality = require('../tools/analyze_action_windows.js');

const raw = {
  session: { sessionId: 'a1-quality-contract' },
  events: [
    { type: 'semantic-snapshot', tsEpochMs: 900, pageSeq: 1, sessionSeq: 1, tabId: 1, frameId: 0, pageInstanceId: 'p1', interactiveElements: [
      { ref: 'goodButton', tag: 'button', role: 'button', label: 'Bình luận', rect: { x: 100, y: 100, width: 100, height: 30 } },
      { ref: 'search', tag: 'input', role: 'searchbox', label: 'Tìm kiếm', rect: { x: 10, y: 10, width: 200, height: 30 } }
    ] },
    { type: 'pointer', phase: 'move', tsEpochMs: 950, pageSeq: 2, sessionSeq: 2, tabId: 1, frameId: 0, pageInstanceId: 'p1', targetRef: 'goodButton', x: 80, y: 105 },
    { type: 'dom-click', tsEpochMs: 1000, pageSeq: 3, sessionSeq: 3, tabId: 1, frameId: 0, pageInstanceId: 'p1', targetRef: 'child', rawTargetRef: 'child', resolvedTargetRef: 'goodButton', resolvedTargetDescriptor: { elementRef: 'goodButton', tag: 'button', role: 'button', label: '' } },
    { type: 'dom-click', tsEpochMs: 2000, pageSeq: 4, sessionSeq: 4, tabId: 1, frameId: 0, pageInstanceId: 'p1', targetRef: 'unknown', rawTargetRef: 'unknown', resolvedTargetRef: 'unknown', resolvedTargetDescriptor: { elementRef: 'unknown', tag: 'button', role: null, label: '' } },
    { type: 'wheel', tsEpochMs: 3000, pageSeq: 5, sessionSeq: 5, tabId: 1, frameId: 0, pageInstanceId: 'p1', deltaX: 0, deltaY: 120, x: 500, y: 400 },
    { type: 'keyboard', phase: 'down', tsEpochMs: 4000, pageSeq: 6, sessionSeq: 6, tabId: 1, frameId: 0, pageInstanceId: 'p1', targetRef: 'search', operation: 'printable', keyClass: 'printable', code: null },
    { type: 'keyboard', phase: 'up', tsEpochMs: 4060, pageSeq: 7, sessionSeq: 7, tabId: 1, frameId: 0, pageInstanceId: 'p1', targetRef: 'search', operation: 'printable', keyClass: 'printable', code: null }
  ]
};

const windows = Windows.buildActionWindows(raw);
const summary = Quality.summarizeActionWindows(windows);

assert.strictEqual(summary.privacy.printableContentContractOk, true);
assert.ok(summary.trainingEligibility.strategy.eligible >= 3);
assert.ok(summary.trainingEligibility.strategy.rejected >= 1);
assert.strictEqual(summary.trainingEligibility.strategy.rejectedReasons.missing_semantic_target_label_or_role >= 1, true);
assert.ok(summary.trainingEligibility.behavior.full >= 3);
assert.strictEqual(summary.byType.scrollVertical.strategyEligibilityRate, 1);
assert.strictEqual(summary.byType.typeText.strategyEligibilityRate, 1);
assert.strictEqual(summary.targetQuality.enriched >= 1, true);

const clickRows = windows.windows.filter(x => x.actionType === 'click');
const labeled = clickRows.find(x => x.target?.targetRef === 'goodButton');
const unlabeled = clickRows.find(x => x.target?.targetRef === 'unknown');
assert.strictEqual(Quality.strategyEligibility(labeled).eligible, true);
assert.strictEqual(Quality.strategyEligibility(unlabeled).eligible, false);
assert.strictEqual(Quality.behaviorEvidence(labeled).level, 'full');

console.log('Training Collector A1 strategy/behavior eligibility contract OK');
