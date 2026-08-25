'use strict';

const assert = require('assert');
const Features = require('../tools/extract_behavior_features.js');

const actionWindows = {
  actionWindowVersion: '0.1.4',
  sourceSessionId: 'behavior-feature-test',
  windows: [
    {
      actionWindowVersion: '0.1.4', actionId: 'click-1', actionType: 'click', anchorTsEpochMs: 1200,
      context: { tabId: 1, frameId: 0, pageInstanceId: 'p1' },
      target: { targetRef: 'b1', role: 'button', tag: 'button', label: 'Like', rect: { x: 100, y: 100, width: 80, height: 32 } },
      before: [
        { type: 'pointer', tsEpochMs: 1000, phase: 'move', x: 0, y: 0 },
        { type: 'pointer', tsEpochMs: 1100, phase: 'move', x: 60, y: 80 },
        { type: 'pointer', tsEpochMs: 1150, phase: 'move', x: 100, y: 100 },
        { type: 'pointer', tsEpochMs: 1180, phase: 'down', pointerId: 1, x: 110, y: 110 }
      ],
      action: { type: 'dom-click', tsEpochMs: 1200, button: 0 },
      after: [{ type: 'pointer', tsEpochMs: 1250, phase: 'up', pointerId: 1, x: 110, y: 110 }], outcome: {}
    },
    {
      actionWindowVersion: '0.1.4', actionId: 'hover-1', actionType: 'hoverAndObserve', anchorTsEpochMs: 2000,
      context: { tabId: 1, frameId: 0, pageInstanceId: 'p1' },
      target: { targetRef: 'v1', role: 'link', tag: 'a', label: 'Video', rect: { x: 300, y: 100, width: 220, height: 120 } },
      before: [
        { type: 'pointer', tsEpochMs: 1850, phase: 'move', x: 180, y: 100 },
        { type: 'pointer', tsEpochMs: 1950, phase: 'move', x: 300, y: 120 }
      ],
      action: { startTsEpochMs: 2000, endTsEpochMs: 2800, dwellMs: 800, derivedHoverType: 'hover-preview' },
      after: [{ type: 'pointer', tsEpochMs: 2900, phase: 'move', x: 500, y: 200 }],
      outcome: { previewLikeStateChange: true, mutationRecordCount: 4 }
    },
    {
      actionWindowVersion: '0.1.4', actionId: 'drag-1', actionType: 'drag', anchorTsEpochMs: 3000,
      target: { targetRef: 's1', role: 'slider', tag: 'div', rect: { x: 500, y: 400, width: 160, height: 20 } },
      destinationTarget: { targetRef: 's1', role: 'slider', tag: 'div', rect: { x: 500, y: 400, width: 160, height: 20 } },
      action: { durationMs: 200, distancePx: 100, points: [
        { type: 'pointer', tsEpochMs: 3000, phase: 'down', x: 500, y: 410 },
        { type: 'pointer', tsEpochMs: 3100, phase: 'move', x: 550, y: 410 },
        { type: 'pointer', tsEpochMs: 3200, phase: 'up', x: 600, y: 410 }
      ] }, before: [], after: [], outcome: {}
    },
    {
      actionWindowVersion: '0.1.4', actionId: 'scroll-1', actionType: 'scrollHorizontal', anchorTsEpochMs: 4000,
      target: { targetRef: 'carousel', tag: 'div', rect: { x: 0, y: 200, width: 700, height: 240 } },
      action: { events: [
        { type: 'wheel', tsEpochMs: 4000, deltaX: 120, deltaY: 2 },
        { type: 'wheel', tsEpochMs: 4070, deltaX: 140, deltaY: 1 },
        { type: 'wheel', tsEpochMs: 4140, deltaX: -20, deltaY: 0 }
      ] }, before: [], after: [], outcome: {}
    },
    {
      actionWindowVersion: '0.1.4', actionId: 'key-1', actionType: 'typeText', anchorTsEpochMs: 5000,
      target: { targetRef: 'search', role: 'searchbox', tag: 'input', rect: { x: 20, y: 20, width: 240, height: 36 } },
      action: { events: [
        { type: 'keyboard', tsEpochMs: 5000, phase: 'down', operation: 'printable', keyClass: 'printable', code: null },
        { type: 'keyboard', tsEpochMs: 5070, phase: 'up', operation: 'printable', keyClass: 'printable', code: null },
        { type: 'keyboard', tsEpochMs: 5150, phase: 'down', operation: 'backspace', keyClass: 'Backspace', code: 'Backspace' },
        { type: 'keyboard', tsEpochMs: 5220, phase: 'up', operation: 'backspace', keyClass: 'Backspace', code: 'Backspace' }
      ] }, before: [], after: [], outcome: {}
    }
  ]
};

const result = Features.extractBehaviorFeatures(actionWindows);
assert.strictEqual(result.behaviorFeatureVersion, '0.2.0');
assert.strictEqual(result.sourceActionWindowVersion, '0.1.4');
assert.strictEqual(result.privacy.printableHumanKeyContentStored, false);
assert.strictEqual(result.rows.length, 5);

const click = result.rows.find(x => x.actionType === 'click');
assert(click.features.approach.available);
assert.strictEqual(click.features.approach.sampleCount, 4);
assert.ok(click.features.approach.pathLengthPx > 0);
assert.ok(click.features.approach.meanSpeedPxS > 0);
assert.ok(click.features.approach.correctionCount45Deg >= 0);
assert.strictEqual(click.features.target.widthPx, 80);
assert.strictEqual(click.features.target.center.x, 140);
assert.strictEqual(click.features.acquisitionPauseMs, 20);
assert.strictEqual(click.features.press.available, true);
assert.strictEqual(click.features.press.holdMs, 70);
assert.strictEqual(click.features.press.downToActionMs, 20);
assert.strictEqual(click.features.press.actionToUpMs, 50);
assert.strictEqual(click.features.acquisition.available, true);

const hover = result.rows.find(x => x.actionType === 'hoverAndObserve');
assert(hover.features.approach.available);
assert(hover.features.leave.available);
assert.strictEqual(hover.features.dwellMs, 800);
assert.strictEqual(hover.features.previewLikeStateChange, true);
assert.strictEqual(hover.features.acquisition.available, true);

const drag = result.rows.find(x => x.actionType === 'drag');
assert(drag.features.path.available);
assert.strictEqual(drag.features.pointCount, 3);
assert.strictEqual(drag.features.displacementPx, 100);

const scroll = result.rows.find(x => x.actionType === 'scrollHorizontal');
assert.strictEqual(scroll.features.eventCount, 3);
assert.strictEqual(scroll.features.totalDeltaX, 240);
assert.strictEqual(scroll.features.directionChanges, 1);
assert.strictEqual(scroll.features.timing.durationMs, 140);
assert.ok(scroll.features.correctionRatio > 0);

const typing = result.rows.find(x => x.actionType === 'typeText');
assert.strictEqual(typing.features.operationCounts.printable, 2);
assert.strictEqual(typing.features.operationCounts.backspace, 2);
assert.strictEqual(typing.features.rhythm.downCount, 2);
assert.strictEqual(typing.features.rhythm.holdCount, 2);
assert.strictEqual(typing.features.rhythm.holdMeanMs, 70);
assert.strictEqual(typing.features.rhythm.interKeyMeanMs, 150);
assert.strictEqual(typing.features.printableContentStored, false);
assert.ok(!JSON.stringify(typing).includes('"text"'));
assert.ok(!JSON.stringify(typing).includes('"key"'));

console.log('Training Collector A2 behavior feature contract OK');
