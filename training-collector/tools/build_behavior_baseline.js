'use strict';

const fs = require('fs');
const path = require('path');
const Semantics = require('./build_action_semantics.js');
const Windows = require('./build_action_windows.js');
const Features = require('./extract_behavior_features.js');

const BASELINE_VERSION = '0.1.0';

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 6) {
  const n = finite(value);
  if (n == null) return null;
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

function quantiles(values) {
  const xs = values.map(finite).filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return { count: 0, p10: null, p25: null, p50: null, p75: null, p90: null };
  const q = p => round(Features.percentile(xs, p));
  return { count: xs.length, p10: q(0.10), p25: q(0.25), p50: q(0.50), p75: q(0.75), p90: q(0.90) };
}

function targetSizeBucket(target) {
  const area = finite(target?.areaPx2);
  if (area == null || area <= 0) return 'unknown';
  if (area < 2500) return 'small';
  if (area < 20000) return 'medium';
  return 'large';
}

function metric(rows, getter) {
  return quantiles(rows.map(getter));
}

function fitPointerClick(rows) {
  return {
    sampleCount: rows.length,
    approachDurationMs: metric(rows, r => r.features?.approach?.durationMs),
    straightness: metric(rows, r => r.features?.approach?.straightness),
    meanSpeedPxS: metric(rows, r => r.features?.approach?.meanSpeedPxS),
    meanAbsTurnDeg: metric(rows, r => r.features?.approach?.meanAbsTurnDeg),
    correctionCount45Deg: metric(rows, r => r.features?.approach?.correctionCount45Deg),
    acquisitionPauseMs: metric(rows, r => r.features?.acquisitionPauseMs),
    holdMs: metric(rows, r => r.features?.press?.holdMs),
    endToCenterNormalized: metric(rows, r => r.features?.acquisition?.endToCenterNormalized)
  };
}

function fitPointerHover(rows) {
  return {
    sampleCount: rows.length,
    approachDurationMs: metric(rows, r => r.features?.approach?.durationMs),
    straightness: metric(rows, r => r.features?.approach?.straightness),
    meanSpeedPxS: metric(rows, r => r.features?.approach?.meanSpeedPxS),
    meanAbsTurnDeg: metric(rows, r => r.features?.approach?.meanAbsTurnDeg),
    dwellMs: metric(rows, r => r.features?.dwellMs),
    leaveDurationMs: metric(rows, r => r.features?.leave?.durationMs)
  };
}

function fitScroll(rows) {
  return {
    sampleCount: rows.length,
    durationMs: metric(rows, r => r.features?.timing?.durationMs),
    eventCount: metric(rows, r => r.features?.eventCount),
    absoluteDelta: metric(rows, r => r.features?.absolutePrimaryDelta),
    eventDeltaP90: metric(rows, r => r.features?.primaryDeltaP90),
    interEventGapMedianMs: metric(rows, r => r.features?.timing?.gapMedianMs),
    correctionRatio: metric(rows, r => r.features?.correctionRatio)
  };
}

function fitKeyboard(rows) {
  return {
    sampleCount: rows.length,
    eventDurationMs: metric(rows, r => r.features?.timing?.durationMs),
    interKeyMedianMs: metric(rows, r => r.features?.rhythm?.interKeyMedianMs),
    interKeyP90Ms: metric(rows, r => r.features?.rhythm?.interKeyP90Ms),
    holdMedianMs: metric(rows, r => r.features?.rhythm?.holdMedianMs),
    holdP90Ms: metric(rows, r => r.features?.rhythm?.holdP90Ms),
    pauseCount450Ms: metric(rows, r => r.features?.rhythm?.pauseCount450Ms)
  };
}

function fitDrag(rows) {
  return {
    sampleCount: rows.length,
    durationMs: metric(rows, r => r.features?.durationMs),
    displacementPx: metric(rows, r => r.features?.displacementPx),
    straightness: metric(rows, r => r.features?.path?.straightness),
    meanSpeedPxS: metric(rows, r => r.features?.path?.meanSpeedPxS)
  };
}

function fitBehaviorBaseline(featureSets, options = {}) {
  const sets = Array.isArray(featureSets) ? featureSets : [featureSets];
  const rows = sets.flatMap(set => Array.isArray(set?.rows) ? set.rows : []);
  const minContextSamples = Number(options.minContextSamples || 12);
  const families = {};

  const clickRows = rows.filter(r => ['click', 'dismiss', 'toggle'].includes(r.actionType));
  const hoverRows = rows.filter(r => ['hover', 'hoverAndObserve'].includes(r.actionType));
  const verticalRows = rows.filter(r => r.actionType === 'scrollVertical');
  const horizontalRows = rows.filter(r => r.actionType === 'scrollHorizontal');
  const textRows = rows.filter(r => r.actionType === 'typeText');
  const keyRows = rows.filter(r => r.actionType === 'pressKey');
  const dragRows = rows.filter(r => r.actionType === 'drag');

  families['pointer-click'] = { global: fitPointerClick(clickRows), contexts: {} };
  for (const bucket of ['small', 'medium', 'large', 'unknown']) {
    const subset = clickRows.filter(r => targetSizeBucket(r.features?.target) === bucket);
    if (subset.length >= minContextSamples) families['pointer-click'].contexts[`targetSize:${bucket}`] = fitPointerClick(subset);
  }

  families['pointer-hover'] = { global: fitPointerHover(hoverRows), contexts: {} };
  for (const bucket of ['small', 'medium', 'large', 'unknown']) {
    const subset = hoverRows.filter(r => targetSizeBucket(r.features?.target) === bucket);
    if (subset.length >= minContextSamples) families['pointer-hover'].contexts[`targetSize:${bucket}`] = fitPointerHover(subset);
  }

  families['scroll-vertical'] = { global: fitScroll(verticalRows), contexts: {} };
  families['scroll-horizontal'] = { global: fitScroll(horizontalRows), contexts: {} };
  families['keyboard-text'] = { global: fitKeyboard(textRows), contexts: {} };
  families['keyboard-key'] = { global: fitKeyboard(keyRows), contexts: {} };
  families['pointer-drag'] = { global: fitDrag(dragRows), contexts: {}, sparse: dragRows.length < 20 };

  return {
    behaviorBaselineVersion: BASELINE_VERSION,
    sourceFeatureVersions: [...new Set(sets.map(x => x?.behaviorFeatureVersion).filter(Boolean))],
    sourceSessionCount: new Set(sets.map(x => x?.sourceSessionId).filter(Boolean)).size,
    design: {
      representation: 'aggregated_quantiles_only',
      literalTrajectoryReplay: false,
      quantiles: ['p10', 'p25', 'p50', 'p75', 'p90'],
      contextRule: `context bucket emitted only when sampleCount >= ${minContextSamples}`
    },
    families,
    warnings: dragRows.length < 20 ? [{ code: 'drag_sparse', sampleCount: dragRows.length }] : []
  };
}

function main(argv = process.argv.slice(2)) {
  if (!argv.length) {
    console.error('Usage: node training-collector/tools/build_behavior_baseline.js <session.raw.jsonl[.gz]> [more sessions...] [--out baseline.json]');
    process.exitCode = 2;
    return;
  }
  const outIndex = argv.indexOf('--out');
  const output = outIndex >= 0 ? argv[outIndex + 1] : null;
  const inputs = argv.filter((_, i) => i !== outIndex && i !== outIndex + 1);
  const featureSets = inputs.map(input => {
    const raw = Semantics.readRaw(input);
    const windows = Windows.buildActionWindows(raw);
    return Features.extractBehaviorFeatures(windows);
  });
  const baseline = fitBehaviorBaseline(featureSets);
  const text = `${JSON.stringify(baseline, null, 2)}\n`;
  if (output) fs.writeFileSync(output, text, 'utf8');
  else process.stdout.write(text);
  if (output) console.error(JSON.stringify({ output: path.resolve(output), inputs: inputs.length, version: BASELINE_VERSION }));
}

if (require.main === module) main();

module.exports = { BASELINE_VERSION, quantiles, targetSizeBucket, fitBehaviorBaseline };
