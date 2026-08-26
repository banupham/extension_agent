'use strict';

const { validateExecutionBehavior } = require('../strategy/execution_behavior_contract');

const POLICY_VERSION = '0.1.1';

function targetSizeBucket(target) {
  const width = Number(target?.rect?.width ?? target?.widthPx);
  const height = Number(target?.rect?.height ?? target?.heightPx);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'unknown';
  const area = width * height;
  if (area < 2500) return 'small';
  if (area < 20000) return 'medium';
  return 'large';
}

function metricKnots(metric) {
  if (!metric || Number(metric.count || 0) <= 0) return [];
  return [metric.p10, metric.p25, metric.p50, metric.p75, metric.p90].map(Number).filter(Number.isFinite);
}

function sampleQuantiles(metric, rng = Math.random) {
  const knots = metricKnots(metric);
  if (!knots.length) return null;
  if (knots.length === 1) return knots[0];
  const u = Math.min(0.999999, Math.max(0, Number(rng())));
  const scaled = u * (knots.length - 1);
  const lo = Math.floor(scaled), hi = Math.min(knots.length - 1, lo + 1);
  const t = scaled - lo;
  return knots[lo] + (knots[hi] - knots[lo]) * t;
}

function baselineFamilyFor(behaviorFamily) {
  return behaviorFamily === 'focus-acquisition' ? 'pointer-click' : behaviorFamily;
}

function chooseProfile(baseline, behaviorFamily, target) {
  const family = baseline?.families?.[baselineFamilyFor(behaviorFamily)];
  if (!family) return null;
  const bucket = targetSizeBucket(target);
  return family.contexts?.[`targetSize:${bucket}`] || family.global || null;
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pointerClickBehavior(profile, rng) {
  return {
    profile: profile ? 'empirical' : 'fallback',
    targetAcquisition: 'adaptive',
    dwellBeforeDownMs: finiteOrNull(sampleQuantiles(profile?.acquisitionPauseMs, rng)),
    holdMs: finiteOrNull(sampleQuantiles(profile?.holdMs, rng)),
    trajectorySeed: null,
    constraints: {
      approachDurationMs: finiteOrNull(sampleQuantiles(profile?.approachDurationMs, rng)),
      straightness: finiteOrNull(sampleQuantiles(profile?.straightness, rng)),
      meanSpeedPxS: finiteOrNull(sampleQuantiles(profile?.meanSpeedPxS, rng)),
      meanAbsTurnDeg: finiteOrNull(sampleQuantiles(profile?.meanAbsTurnDeg, rng)),
      correctionCount45Deg: finiteOrNull(sampleQuantiles(profile?.correctionCount45Deg, rng)),
      endToCenterNormalized: finiteOrNull(sampleQuantiles(profile?.endToCenterNormalized, rng))
    }
  };
}

function sampledBehavior({ baseline, mappedAction, target = null, rng = Math.random }) {
  if (!mappedAction?.type) throw new Error('mappedAction required');
  const family = mappedAction.behaviorFamily || 'generic';
  const baselineFamily = baselineFamilyFor(family);
  const profile = chooseProfile(baseline, family, target);
  const sparse = !!baseline?.families?.[baselineFamily]?.sparse;

  const out = {
    actionId: mappedAction.actionId || null,
    actionType: mappedAction.type,
    targetRef: mappedAction.targetRef || null,
    profile: profile ? 'empirical-quantile-v01' : 'conservative-fallback',
    timing: { profile: profile ? 'empirical-quantile' : 'fallback' },
    metadata: {
      policyVersion: POLICY_VERSION,
      behaviorFamily: family,
      baselineFamily,
      baselineVersion: baseline?.behaviorBaselineVersion || null,
      sparseFamily: sparse,
      literalTrajectoryReplay: false
    }
  };

  if (family === 'pointer-click' || family === 'focus-acquisition') {
    out.pointer = pointerClickBehavior(profile, rng);
  } else if (family === 'pointer-hover') {
    out.pointer = {
      profile: profile ? 'empirical' : 'fallback', targetAcquisition: 'adaptive', dwellBeforeDownMs: null, holdMs: null, trajectorySeed: null,
      constraints: {
        approachDurationMs: finiteOrNull(sampleQuantiles(profile?.approachDurationMs, rng)), straightness: finiteOrNull(sampleQuantiles(profile?.straightness, rng)),
        meanSpeedPxS: finiteOrNull(sampleQuantiles(profile?.meanSpeedPxS, rng)), meanAbsTurnDeg: finiteOrNull(sampleQuantiles(profile?.meanAbsTurnDeg, rng)),
        dwellMs: finiteOrNull(sampleQuantiles(profile?.dwellMs, rng)), leaveDurationMs: finiteOrNull(sampleQuantiles(profile?.leaveDurationMs, rng))
      }
    };
  } else if (family === 'scroll-vertical' || family === 'scroll-horizontal') {
    out.scroll = {
      profile: profile ? 'empirical' : 'fallback', axis: family === 'scroll-horizontal' ? 'horizontal' : 'vertical', burstProfile: 'context-conditioned', timingSeed: null,
      constraints: {
        durationMs: finiteOrNull(sampleQuantiles(profile?.durationMs, rng)), eventCount: finiteOrNull(sampleQuantiles(profile?.eventCount, rng)),
        absoluteDelta: finiteOrNull(sampleQuantiles(profile?.absoluteDelta, rng)), eventDeltaP90: finiteOrNull(sampleQuantiles(profile?.eventDeltaP90, rng)),
        interEventGapMedianMs: finiteOrNull(sampleQuantiles(profile?.interEventGapMedianMs, rng)), correctionRatio: finiteOrNull(sampleQuantiles(profile?.correctionRatio, rng))
      }
    };
  } else if (family === 'keyboard-text' || family === 'keyboard-key') {
    out.keyboard = {
      profile: profile ? 'empirical' : 'fallback', initialPauseMs: null, burstProfile: 'context-conditioned', timingSeed: null,
      constraints: {
        eventDurationMs: finiteOrNull(sampleQuantiles(profile?.eventDurationMs, rng)), interKeyMedianMs: finiteOrNull(sampleQuantiles(profile?.interKeyMedianMs, rng)),
        interKeyP90Ms: finiteOrNull(sampleQuantiles(profile?.interKeyP90Ms, rng)), holdMedianMs: finiteOrNull(sampleQuantiles(profile?.holdMedianMs, rng)),
        holdP90Ms: finiteOrNull(sampleQuantiles(profile?.holdP90Ms, rng)), pauseCount450Ms: finiteOrNull(sampleQuantiles(profile?.pauseCount450Ms, rng))
      }
    };
  } else if (family === 'pointer-drag') {
    out.pointer = {
      profile: sparse || !profile ? 'fallback' : 'empirical', targetAcquisition: 'adaptive', dwellBeforeDownMs: null, holdMs: null, trajectorySeed: null,
      constraints: sparse ? { sparseFallback: true } : {
        durationMs: finiteOrNull(sampleQuantiles(profile?.durationMs, rng)), displacementPx: finiteOrNull(sampleQuantiles(profile?.displacementPx, rng)),
        straightness: finiteOrNull(sampleQuantiles(profile?.straightness, rng)), meanSpeedPxS: finiteOrNull(sampleQuantiles(profile?.meanSpeedPxS, rng))
      }
    };
  }

  return validateExecutionBehavior(out);
}

module.exports = { POLICY_VERSION, targetSizeBucket, baselineFamilyFor, sampleQuantiles, chooseProfile, sampledBehavior };
