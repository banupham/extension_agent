'use strict';

const path = require('path');
const Semantics = require('./build_action_semantics.js');
const Windows = require('./build_action_windows.js');
const Features = require('./extract_behavior_features.js');

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rounded(value, digits = 6) {
  const n = finite(value);
  if (n == null) return null;
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

function distribution(values) {
  const xs = values.map(finite).filter(Number.isFinite).sort((a, b) => a - b);
  const q = p => Features.percentile(xs, p);
  if (!xs.length) return { count: 0, min: null, median: null, p90: null, p99: null, max: null, mean: null };
  return {
    count: xs.length,
    min: rounded(xs[0]),
    median: rounded(q(0.5)),
    p90: rounded(q(0.9)),
    p99: rounded(q(0.99)),
    max: rounded(xs.at(-1)),
    mean: rounded(xs.reduce((a, b) => a + b, 0) / xs.length)
  };
}

function summarizeBehaviorFeatures(featureSets) {
  const sets = Array.isArray(featureSets) ? featureSets : [featureSets];
  const rows = sets.flatMap(set => Array.isArray(set?.rows) ? set.rows : []);
  const byType = {};
  const sessions = new Set(sets.map(set => set?.sourceSessionId).filter(Boolean));

  for (const row of rows) {
    const type = row.actionType || 'unknown';
    const bucket = byType[type] = byType[type] || { count: 0, physical: 0, semantic: 0 };
    bucket.count += 1;
    if (row.quality?.physicalEvidencePresent) bucket.physical += 1;
    if (row.quality?.targetSemanticPresent) bucket.semantic += 1;
  }
  for (const bucket of Object.values(byType)) {
    bucket.physicalEvidenceRate = bucket.count ? rounded(bucket.physical / bucket.count) : 0;
    bucket.semanticTargetRate = bucket.count ? rounded(bucket.semantic / bucket.count) : 0;
  }

  const clickTypes = ['click', 'dismiss', 'toggle'];
  const hoverTypes = ['hover', 'hoverAndObserve'];
  const keyboardTypes = ['typeText', 'pressKey'];
  const select = (types, getter) => rows.filter(r => types.includes(r.actionType)).map(getter);
  const rate = (subset, predicate) => subset.length ? rounded(subset.filter(predicate).length / subset.length) : 0;
  const clickRows = rows.filter(r => clickTypes.includes(r.actionType));
  const hoverRows = rows.filter(r => hoverTypes.includes(r.actionType));
  const keyRows = rows.filter(r => keyboardTypes.includes(r.actionType));

  const summary = {
    behaviorFeatureVersion: sets.find(x => x?.behaviorFeatureVersion)?.behaviorFeatureVersion || null,
    sessionCount: sessions.size,
    rowCount: rows.length,
    byType,
    coverage: {
      physicalEvidenceRate: rate(rows, r => r.quality?.physicalEvidencePresent),
      semanticTargetRate: rate(rows, r => r.quality?.targetSemanticPresent),
      clickPressHoldRate: rate(clickRows, r => r.features?.press?.available),
      clickAcquisitionRate: rate(clickRows, r => r.features?.acquisition?.available),
      hoverApproachRate: rate(hoverRows, r => r.features?.approach?.available),
      hoverLeaveRate: rate(hoverRows, r => r.features?.leave?.available),
      keyboardHoldRate: rate(keyRows, r => Number(r.features?.rhythm?.holdCount || 0) > 0)
    },
    distributions: {
      clickApproachDurationMs: distribution(select(clickTypes, r => r.features?.approach?.durationMs)),
      clickApproachPathPx: distribution(select(clickTypes, r => r.features?.approach?.pathLengthPx)),
      clickStraightness: distribution(select(clickTypes, r => r.features?.approach?.straightness)),
      clickMeanSpeedPxS: distribution(select(clickTypes, r => r.features?.approach?.meanSpeedPxS)),
      clickMeanAbsTurnDeg: distribution(select(clickTypes, r => r.features?.approach?.meanAbsTurnDeg)),
      clickCorrectionCount: distribution(select(clickTypes, r => r.features?.approach?.correctionCount45Deg)),
      clickAcquisitionPauseMs: distribution(select(clickTypes, r => r.features?.acquisitionPauseMs)),
      clickHoldMs: distribution(select(clickTypes, r => r.features?.press?.holdMs)),
      clickEndToCenterNormalized: distribution(select(clickTypes, r => r.features?.acquisition?.endToCenterNormalized)),
      hoverDwellMs: distribution(select(hoverTypes, r => r.features?.dwellMs)),
      hoverApproachDurationMs: distribution(select(hoverTypes, r => r.features?.approach?.durationMs)),
      hoverLeaveDurationMs: distribution(select(hoverTypes, r => r.features?.leave?.durationMs)),
      verticalScrollAbsDelta: distribution(select(['scrollVertical'], r => r.features?.absolutePrimaryDelta)),
      horizontalScrollAbsDelta: distribution(select(['scrollHorizontal'], r => r.features?.absolutePrimaryDelta)),
      verticalScrollDurationMs: distribution(select(['scrollVertical'], r => r.features?.timing?.durationMs)),
      horizontalScrollDurationMs: distribution(select(['scrollHorizontal'], r => r.features?.timing?.durationMs)),
      keyboardInterKeyMedianMs: distribution(select(keyboardTypes, r => r.features?.rhythm?.interKeyMedianMs)),
      keyboardHoldMedianMs: distribution(select(keyboardTypes, r => r.features?.rhythm?.holdMedianMs)),
      dragDistancePx: distribution(select(['drag'], r => r.features?.displacementPx)),
      dragDurationMs: distribution(select(['drag'], r => r.features?.durationMs))
    },
    warnings: []
  };

  const dragCount = Number(byType.drag?.count || 0);
  if (dragCount < 20) summary.warnings.push({ code: 'drag_sparse', count: dragCount, recommendation: 'do_not_fit_confident_drag_distribution' });
  if (clickRows.length >= 10 && summary.coverage.clickPressHoldRate < 0.5) summary.warnings.push({ code: 'click_hold_low_coverage', rate: summary.coverage.clickPressHoldRate });
  if (hoverRows.length >= 10 && summary.coverage.hoverApproachRate < 0.7) summary.warnings.push({ code: 'hover_approach_low_coverage', rate: summary.coverage.hoverApproachRate });
  if (keyRows.length >= 10 && summary.coverage.keyboardHoldRate < 0.5) summary.warnings.push({ code: 'keyboard_hold_low_coverage', rate: summary.coverage.keyboardHoldRate });
  return summary;
}

function main(argv = process.argv.slice(2)) {
  if (!argv.length) {
    console.error('Usage: node training-collector/tools/analyze_behavior_features.js <session.raw.jsonl[.gz]> [more sessions...]');
    process.exitCode = 2;
    return;
  }
  const featureSets = argv.map(input => {
    const raw = Semantics.readRaw(input);
    const windows = Windows.buildActionWindows(raw);
    return Features.extractBehaviorFeatures(windows);
  });
  console.log(JSON.stringify({ inputs: argv.map(x => path.resolve(x)), ...summarizeBehaviorFeatures(featureSets) }, null, 2));
}

if (require.main === module) main();

module.exports = { distribution, summarizeBehaviorFeatures };
