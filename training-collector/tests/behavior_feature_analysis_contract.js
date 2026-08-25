'use strict';

const assert = require('assert');
const Analyzer = require('../tools/analyze_behavior_features.js');

const features = {
  behaviorFeatureVersion: '0.1.0',
  sourceSessionId: 'analysis-test',
  privacy: { printableHumanKeyContentStored: false },
  rows: [
    {
      actionType: 'click', quality: { targetSemanticPresent: true, physicalEvidencePresent: true },
      features: { approach: { available: true, pathLengthPx: 100, straightness: 0.9, meanSpeedPxS: 500 }, acquisitionPauseMs: 50 }
    },
    {
      actionType: 'click', quality: { targetSemanticPresent: false, physicalEvidencePresent: true },
      features: { approach: { available: true, pathLengthPx: 200, straightness: 0.8, meanSpeedPxS: 700 }, acquisitionPauseMs: 90 }
    },
    {
      actionType: 'hoverAndObserve', quality: { targetSemanticPresent: true, physicalEvidencePresent: true },
      features: { approach: { available: true, pathLengthPx: 150 }, leave: { available: true, pathLengthPx: 80 }, dwellMs: 800 }
    },
    {
      actionType: 'scrollHorizontal', quality: { targetSemanticPresent: false, physicalEvidencePresent: true },
      features: { timing: { durationMs: 200 }, absolutePrimaryDelta: 300 }
    },
    {
      actionType: 'scrollVertical', quality: { targetSemanticPresent: false, physicalEvidencePresent: true },
      features: { timing: { durationMs: 400 }, absolutePrimaryDelta: 600 }
    },
    {
      actionType: 'typeText', quality: { targetSemanticPresent: true, physicalEvidencePresent: true },
      features: { timing: { durationMs: 500, gapMedianMs: 70 } }
    },
    {
      actionType: 'drag', quality: { targetSemanticPresent: true, physicalEvidencePresent: true },
      features: { displacementPx: 100, durationMs: 250 }
    }
  ]
};

const summary = Analyzer.summarizeBehaviorFeatures(features);
assert.strictEqual(summary.behaviorFeatureVersion, '0.1.0');
assert.strictEqual(summary.totalRows, 7);
assert.strictEqual(summary.byType.click.count, 2);
assert.strictEqual(summary.coverage.physicalEvidenceRate, 1);
assert.strictEqual(summary.pointerClick.approachPathLengthPx.median, 150);
assert.strictEqual(summary.pointerClick.meanSpeedPxS.median, 600);
assert.strictEqual(summary.hover.dwellMs.median, 800);
assert.strictEqual(summary.drag.count, 1);
assert.strictEqual(summary.scroll.horizontal.absoluteDelta.median, 300);
assert.strictEqual(summary.scroll.vertical.absoluteDelta.median, 600);
assert.strictEqual(summary.keyboard.medianEventGapMs.median, 70);
assert.strictEqual(summary.privacy.printableHumanKeyContentStored, false);

console.log('Training Collector A2 behavior feature analysis contract OK');
