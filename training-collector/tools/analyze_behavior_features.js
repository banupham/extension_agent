'use strict';

const path = require('path');
const Semantics = require('./build_action_semantics.js');
const Windows = require('./build_action_windows.js');
const Features = require('./extract_behavior_features.js');

function finiteValues(values) {
  return values.map(Number).filter(Number.isFinite);
}

function quantile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}

function distribution(values) {
  const xs = finiteValues(values).sort((a, b) => a - b);
  if (!xs.length) return { count: 0, min: null, p10: null, median: null, p90: null, max: null };
  return {
    count: xs.length,
    min: round(xs[0]),
    p10: round(quantile(xs, 0.1)),
    median: round(quantile(xs, 0.5)),
    p90: round(quantile(xs, 0.9)),
    max: round(xs.at(-1))
  };
}

function summarizeBehaviorFeatures(result) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const byType = {};
  let semanticTargetPresent = 0;
  let physicalEvidencePresent = 0;

  const clickApproach = [];
  const clickStraightness = [];
  const clickSpeed = [];
  const clickPause = [];
  const hoverApproach = [];
  const hoverLeave = [];
  const hoverDwell = [];
  const dragDistance = [];
  const dragDuration = [];
  const horizontalDuration = [];
  const horizontalDelta = [];
  const verticalDuration = [];
  const verticalDelta = [];
  const keyboardDuration = [];
  const keyboardGapMedian = [];

  for (const row of rows) {
    const type = row.actionType || 'unknown';
    const bucket = byType[type] = byType[type] || { count: 0, semanticTarget: 0, physicalEvidence: 0 };
    bucket.count += 1;
    if (row.quality?.targetSemanticPresent) { semanticTargetPresent += 1; bucket.semanticTarget += 1; }
    if (row.quality?.physicalEvidencePresent) { physicalEvidencePresent += 1; bucket.physicalEvidence += 1; }

    const f = row.features || {};
    if (['click', 'dismiss', 'toggle'].includes(type)) {
      if (f.approach?.available) {
        clickApproach.push(f.approach.pathLengthPx);
        clickStraightness.push(f.approach.straightness);
        clickSpeed.push(f.approach.meanSpeedPxS);
      }
      clickPause.push(f.acquisitionPauseMs);
    } else if (['hover', 'hoverAndObserve'].includes(type)) {
      if (f.approach?.available) hoverApproach.push(f.approach.pathLengthPx);
      if (f.leave?.available) hoverLeave.push(f.leave.pathLengthPx);
      hoverDwell.push(f.dwellMs);
    } else if (type === 'drag') {
      dragDistance.push(f.displacementPx);
      dragDuration.push(f.durationMs);
    } else if (type === 'scrollHorizontal') {
      horizontalDuration.push(f.timing?.durationMs);
      horizontalDelta.push(f.absolutePrimaryDelta);
    } else if (type === 'scrollVertical') {
      verticalDuration.push(f.timing?.durationMs);
      verticalDelta.push(f.absolutePrimaryDelta);
    } else if (type === 'typeText' || type === 'pressKey') {
      keyboardDuration.push(f.timing?.durationMs);
      keyboardGapMedian.push(f.timing?.gapMedianMs);
    }
  }

  for (const bucket of Object.values(byType)) {
    bucket.semanticTargetRate = bucket.count ? round(bucket.semanticTarget / bucket.count) : 0;
    bucket.physicalEvidenceRate = bucket.count ? round(bucket.physicalEvidence / bucket.count) : 0;
  }

  return {
    behaviorFeatureVersion: result?.behaviorFeatureVersion || null,
    sourceSessionId: result?.sourceSessionId || null,
    totalRows: rows.length,
    byType,
    coverage: {
      semanticTargetPresent,
      semanticTargetRate: rows.length ? round(semanticTargetPresent / rows.length) : 0,
      physicalEvidencePresent,
      physicalEvidenceRate: rows.length ? round(physicalEvidencePresent / rows.length) : 0
    },
    pointerClick: {
      approachPathLengthPx: distribution(clickApproach),
      straightness: distribution(clickStraightness),
      meanSpeedPxS: distribution(clickSpeed),
      acquisitionPauseMs: distribution(clickPause)
    },
    hover: {
      approachPathLengthPx: distribution(hoverApproach),
      leavePathLengthPx: distribution(hoverLeave),
      dwellMs: distribution(hoverDwell)
    },
    drag: {
      count: Number(byType.drag?.count || 0),
      distancePx: distribution(dragDistance),
      durationMs: distribution(dragDuration)
    },
    scroll: {
      horizontal: { durationMs: distribution(horizontalDuration), absoluteDelta: distribution(horizontalDelta) },
      vertical: { durationMs: distribution(verticalDuration), absoluteDelta: distribution(verticalDelta) }
    },
    keyboard: {
      durationMs: distribution(keyboardDuration),
      medianEventGapMs: distribution(keyboardGapMedian)
    },
    privacy: result?.privacy || {}
  };
}

function main(argv = process.argv.slice(2)) {
  const input = argv[0];
  if (!input) {
    console.error('Usage: node training-collector/tools/analyze_behavior_features.js <session.raw.jsonl[.gz]>');
    process.exitCode = 2;
    return;
  }
  const raw = Semantics.readRaw(input);
  const windows = Windows.buildActionWindows(raw);
  const features = Features.extractBehaviorFeatures(windows);
  const summary = summarizeBehaviorFeatures(features);
  console.log(JSON.stringify({ input: path.resolve(input), sourceEvents: raw.events.length, ...summary }, null, 2));
}

if (require.main === module) main();

module.exports = { distribution, summarizeBehaviorFeatures };
