'use strict';

const assert = require('assert');
const { fitBehaviorBaseline } = require('../../../training-collector/tools/build_behavior_baseline.js');
const { sampledBehavior } = require('../../manager/behavior/empirical_policy.js');
const { mapAgentAction } = require('../../manager/strategy/agent_action_contract.js');

const featureSet = {
  behaviorFeatureVersion: '0.2.0',
  sourceSessionId: 'a3-test',
  rows: []
};

for (let i = 0; i < 20; i += 1) {
  featureSet.rows.push({
    actionType: 'click',
    features: {
      approach: { durationMs: 180 + i, straightness: 0.8 + i / 1000, meanSpeedPxS: 500 + i * 5, meanAbsTurnDeg: 10 + i / 2, correctionCount45Deg: i % 3 },
      acquisitionPauseMs: 20 + i,
      press: { holdMs: 80 + i },
      acquisition: { endToCenterNormalized: 0.15 + i / 1000 },
      target: { widthPx: 80, heightPx: 30, areaPx2: 2400 }
    }
  });
  featureSet.rows.push({
    actionType: 'scrollVertical',
    features: {
      timing: { durationMs: 200 + i, gapMedianMs: 20 + i / 10 }, eventCount: 3 + (i % 4), absolutePrimaryDelta: 200 + i * 10,
      primaryDeltaP90: 100 + i, correctionRatio: (i % 2) * 0.1
    }
  });
  featureSet.rows.push({
    actionType: 'typeText',
    features: {
      timing: { durationMs: 300 + i },
      rhythm: { interKeyMedianMs: 70 + i, interKeyP90Ms: 120 + i, holdMedianMs: 60 + i / 2, holdP90Ms: 90 + i, pauseCount450Ms: i % 2 }
    }
  });
}
featureSet.rows.push({ actionType: 'drag', features: { durationMs: 300, displacementPx: 100, path: { straightness: 0.9, meanSpeedPxS: 400 } } });

const baseline = fitBehaviorBaseline(featureSet, { minContextSamples: 12 });
assert.strictEqual(baseline.behaviorBaselineVersion, '0.1.0');
assert.strictEqual(baseline.design.literalTrajectoryReplay, false);
assert.ok(baseline.families['pointer-click'].contexts['targetSize:small']);
assert.strictEqual(baseline.families['pointer-drag'].sparse, true);
assert.ok(baseline.warnings.some(x => x.code === 'drag_sparse'));

const fixedRng = () => 0.5;
const click = sampledBehavior({
  baseline,
  mappedAction: mapAgentAction({ type: 'click', targetRef: 'e17' }),
  target: { rect: { width: 80, height: 30 } },
  rng: fixedRng
});
assert.strictEqual(click.actionType, 'click');
assert.strictEqual(click.profile, 'empirical-quantile-v01');
assert.strictEqual(click.metadata.literalTrajectoryReplay, false);
assert.ok(Number.isFinite(click.pointer.holdMs));
assert.ok(Number.isFinite(click.pointer.constraints.approachDurationMs));

const scroll = sampledBehavior({
  baseline,
  mappedAction: mapAgentAction({ type: 'scrollVertical' }),
  rng: fixedRng
});
assert.strictEqual(scroll.scroll.axis, 'vertical');
assert.ok(Number.isFinite(scroll.scroll.constraints.absoluteDelta));

const fallbackScroll = sampledBehavior({
  baseline: null,
  mappedAction: mapAgentAction({ type: 'scrollVertical' }),
  rng: fixedRng
});
assert.strictEqual(fallbackScroll.profile, 'conservative-fallback');
assert.strictEqual(fallbackScroll.scroll.constraints.durationMs, null);
assert.strictEqual(fallbackScroll.scroll.constraints.eventCount, null);
assert.strictEqual(fallbackScroll.scroll.constraints.absoluteDelta, null);
assert.strictEqual(fallbackScroll.scroll.constraints.correctionRatio, null);

const typing = sampledBehavior({
  baseline,
  mappedAction: mapAgentAction({ type: 'typeText' }),
  rng: fixedRng
});
assert.ok(Number.isFinite(typing.keyboard.constraints.interKeyMedianMs));
assert.ok(Number.isFinite(typing.keyboard.constraints.holdMedianMs));

const drag = sampledBehavior({
  baseline,
  mappedAction: mapAgentAction({ type: 'drag', targetRef: 'slider' }),
  target: { rect: { width: 160, height: 20 } },
  rng: fixedRng
});
assert.strictEqual(drag.metadata.sparseFamily, true);
assert.strictEqual(drag.pointer.profile, 'fallback');
assert.strictEqual(drag.pointer.constraints.sparseFallback, true);

console.log('A3 empirical behavior policy contract: PASS');
