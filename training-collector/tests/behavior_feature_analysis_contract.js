'use strict';

const assert = require('assert');
const Analyzer = require('../tools/analyze_behavior_features.js');

const features = {
  behaviorFeatureVersion: '0.2.0',
  sourceSessionId: 'analysis-test',
  privacy: { printableHumanKeyContentStored: false },
  rows: [
    {
      actionType: 'click', quality: { targetSemanticPresent: true, physicalEvidencePresent: true },
      features: {
        approach: { available: true, durationMs: 200, pathLengthPx: 100, straightness: 0.9, meanSpeedPxS: 500, meanAbsTurnDeg: 10, correctionCount45Deg: 0 },
        acquisitionPauseMs: 50,
        acquisition: { available: true, endToCenterNormalized: 0.2 },
        press: { available: true, holdMs: 70 }
      }
    },
    {
      actionType: 'click', quality: { targetSemanticPresent: false, physicalEvidencePresent: true },
      features: {
        approach: { available: true, durationMs: 300, pathLengthPx: 200, straightness: 0.8, meanSpeedPxS: 700, meanAbsTurnDeg: 20, correctionCount45Deg: 1 },
        acquisitionPauseMs: 90,
        acquisition: { available: true, endToCenterNormalized: 0.4 },
        press: { available: true, holdMs: 90 }
      }
    },
    {
      actionType: 'hoverAndObserve', quality: { targetSemanticPresent: true, physicalEvidencePresent: true },
      features: { approach: { available: true, durationMs: 150 }, leave: { available: true, durationMs: 100 }, dwellMs: 800 }
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
      features: { rhythm: { interKeyMedianMs: 70, holdMedianMs: 65, holdCount: 2 } }
    },
    {
      actionType: 'drag', quality: { targetSemanticPresent: true, physicalEvidencePresent: true },
      features: { displacementPx: 100, durationMs: 250 }
    }
  ]
};

const summary = Analyzer.summarizeBehaviorFeatures(features);
assert.strictEqual(summary.behaviorFeatureVersion, '0.2.0');
assert.strictEqual(summary.sessionCount, 1);
assert.strictEqual(summary.rowCount, 7);
assert.strictEqual(summary.byType.click.count, 2);
assert.strictEqual(summary.coverage.physicalEvidenceRate, 1);
assert.strictEqual(summary.coverage.clickPressHoldRate, 1);
assert.strictEqual(summary.coverage.clickAcquisitionRate, 1);
assert.strictEqual(summary.coverage.hoverApproachRate, 1);
assert.strictEqual(summary.coverage.hoverLeaveRate, 1);
assert.strictEqual(summary.coverage.keyboardHoldRate, 1);
assert.strictEqual(summary.distributions.clickApproachPathPx.median, 150);
assert.strictEqual(summary.distributions.clickMeanSpeedPxS.median, 600);
assert.strictEqual(summary.distributions.clickHoldMs.median, 80);
assert.strictEqual(summary.distributions.clickEndToCenterNormalized.median, 0.3);
assert.strictEqual(summary.distributions.hoverDwellMs.median, 800);
assert.strictEqual(summary.distributions.horizontalScrollAbsDelta.median, 300);
assert.strictEqual(summary.distributions.verticalScrollAbsDelta.median, 600);
assert.strictEqual(summary.distributions.keyboardInterKeyMedianMs.median, 70);
assert.strictEqual(summary.distributions.keyboardHoldMedianMs.median, 65);
assert.strictEqual(summary.distributions.dragDistancePx.median, 100);
assert.ok(summary.warnings.some(x => x.code === 'drag_sparse'));

console.log('Training Collector A2 behavior feature analysis contract OK');
