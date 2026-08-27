#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  stableSplit,
  loadFeatureSet
} = require('./build_behavior_batch_baseline.js');

const EVALUATOR_VERSION = '0.2.0';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function actionFamily(actionType) {
  if (['click', 'dismiss', 'toggle'].includes(actionType)) return 'pointer-click';
  if (['hover', 'hoverAndObserve'].includes(actionType)) return 'pointer-hover';
  if (actionType === 'scrollVertical') return 'scroll-vertical';
  if (actionType === 'scrollHorizontal') return 'scroll-horizontal';
  if (actionType === 'typeText') return 'keyboard-text';
  if (actionType === 'pressKey') return 'keyboard-key';
  if (actionType === 'drag') return 'pointer-drag';
  if (['focus', 'selectOption', 'submit'].includes(actionType)) return 'form-control';
  return null;
}

const METRICS = {
  'pointer-click': {
    approachDurationMs: row => row.features?.approach?.durationMs,
    straightness: row => row.features?.approach?.straightness,
    meanSpeedPxS: row => row.features?.approach?.meanSpeedPxS,
    meanAbsTurnDeg: row => row.features?.approach?.meanAbsTurnDeg,
    acquisitionPauseMs: row => row.features?.acquisitionPauseMs,
    holdMs: row => row.features?.press?.holdMs,
    endToCenterNormalized: row => row.features?.acquisition?.endToCenterNormalized
  },
  'pointer-hover': {
    approachDurationMs: row => row.features?.approach?.durationMs,
    straightness: row => row.features?.approach?.straightness,
    meanSpeedPxS: row => row.features?.approach?.meanSpeedPxS,
    meanAbsTurnDeg: row => row.features?.approach?.meanAbsTurnDeg,
    dwellMs: row => row.features?.dwellMs,
    leaveDurationMs: row => row.features?.leave?.durationMs
  },
  'scroll-vertical': {
    durationMs: row => row.features?.timing?.durationMs,
    eventCount: row => row.features?.eventCount,
    absoluteDelta: row => row.features?.absolutePrimaryDelta,
    eventDeltaP90: row => row.features?.primaryDeltaP90,
    interEventGapMedianMs: row => row.features?.timing?.gapMedianMs,
    correctionRatio: row => row.features?.correctionRatio
  },
  'scroll-horizontal': {
    durationMs: row => row.features?.timing?.durationMs,
    eventCount: row => row.features?.eventCount,
    absoluteDelta: row => row.features?.absolutePrimaryDelta,
    eventDeltaP90: row => row.features?.primaryDeltaP90,
    interEventGapMedianMs: row => row.features?.timing?.gapMedianMs,
    correctionRatio: row => row.features?.correctionRatio
  },
  'keyboard-text': {
    eventDurationMs: row => row.features?.timing?.durationMs,
    interKeyMedianMs: row => row.features?.rhythm?.interKeyMedianMs,
    interKeyP90Ms: row => row.features?.rhythm?.interKeyP90Ms,
    holdMedianMs: row => row.features?.rhythm?.holdMedianMs,
    holdP90Ms: row => row.features?.rhythm?.holdP90Ms,
    pauseCount450Ms: row => row.features?.rhythm?.pauseCount450Ms
  },
  'keyboard-key': {
    eventDurationMs: row => row.features?.timing?.durationMs,
    interKeyMedianMs: row => row.features?.rhythm?.interKeyMedianMs,
    interKeyP90Ms: row => row.features?.rhythm?.interKeyP90Ms,
    holdMedianMs: row => row.features?.rhythm?.holdMedianMs,
    holdP90Ms: row => row.features?.rhythm?.holdP90Ms,
    pauseCount450Ms: row => row.features?.rhythm?.pauseCount450Ms
  },
  'pointer-drag': {
    durationMs: row => row.features?.durationMs,
    displacementPx: row => row.features?.displacementPx,
    straightness: row => row.features?.path?.straightness,
    meanSpeedPxS: row => row.features?.path?.meanSpeedPxS
  },
  'form-control': {
    leadInDurationMs: row => row.features?.leadInTiming?.durationMs,
    leadInGapMedianMs: row => row.features?.leadInTiming?.gapMedianMs,
    pointerApproachDurationMs: row => row.features?.pointerLeadIn?.durationMs,
    pointerStraightness: row => row.features?.pointerLeadIn?.straightness,
    pointerMeanSpeedPxS: row => row.features?.pointerLeadIn?.meanSpeedPxS,
    pointerMeanAbsTurnDeg: row => row.features?.pointerLeadIn?.meanAbsTurnDeg
  }
};

function envelope(metric) {
  const p10 = finite(metric?.p10);
  const p90 = finite(metric?.p90);
  const count = Number(metric?.count || 0);
  return count > 0 && p10 != null && p90 != null ? { p10, p90 } : null;
}

function evaluateRows(rows, model) {
  const familyRows = {};
  const unsupportedActionCounts = {};
  let supportedRows = 0;
  let assessedMetrics = 0;
  let withinMetrics = 0;
  let belowMetrics = 0;
  let aboveMetrics = 0;

  for (const row of rows) {
    const family = actionFamily(row.actionType);
    const profile = family ? model?.families?.[family]?.global : null;
    const familySupported = !!profile && Number(profile.sampleCount || 0) > 0;
    if (!family || !familySupported) {
      unsupportedActionCounts[row.actionType] = (unsupportedActionCounts[row.actionType] || 0) + 1;
      continue;
    }
    supportedRows += 1;
    if (!familyRows[family]) familyRows[family] = { rowCount: 0, assessedMetrics: 0, withinMetrics: 0, belowMetrics: 0, aboveMetrics: 0, metricCoverage: null };
    familyRows[family].rowCount += 1;

    for (const [name, getter] of Object.entries(METRICS[family] || {})) {
      const value = finite(getter(row));
      const range = envelope(profile?.[name]);
      if (value == null || !range) continue;
      assessedMetrics += 1;
      familyRows[family].assessedMetrics += 1;
      if (value < range.p10) {
        belowMetrics += 1;
        familyRows[family].belowMetrics += 1;
      } else if (value > range.p90) {
        aboveMetrics += 1;
        familyRows[family].aboveMetrics += 1;
      } else {
        withinMetrics += 1;
        familyRows[family].withinMetrics += 1;
      }
    }
  }

  for (const stats of Object.values(familyRows)) {
    stats.metricCoverage = stats.assessedMetrics ? stats.withinMetrics / stats.assessedMetrics : null;
  }

  return {
    rowCount: rows.length,
    supportedRows,
    unsupportedRows: rows.length - supportedRows,
    rowSupportCoverage: rows.length ? supportedRows / rows.length : null,
    assessedMetrics,
    withinMetrics,
    belowMetrics,
    aboveMetrics,
    metricEnvelopeCoverage: assessedMetrics ? withinMetrics / assessedMetrics : null,
    unsupportedActionCounts: Object.fromEntries(Object.entries(unsupportedActionCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    families: familyRows
  };
}

function flattenRows(featureSets) {
  return featureSets.flatMap(set => Array.isArray(set?.rows) ? set.rows : []);
}

function evaluateBehaviorBatchBaseline(manifestFile, baselineFile) {
  const fullManifest = path.resolve(manifestFile);
  const fullBaseline = path.resolve(baselineFile);
  const manifest = readJson(fullManifest);
  const baseline = readJson(fullBaseline);
  const model = baseline?.model?.families ? baseline.model : baseline;
  if (!model?.families) throw new Error('behavior baseline model families required');

  const readySessions = (Array.isArray(manifest?.behavior?.sessions) ? manifest.behavior.sessions : [])
    .filter(session => session?.status === 'behavior-features-ready' && session?.output);
  if (!readySessions.length) throw new Error('no behavior-features-ready sessions in manifest');
  const splitSessions = stableSplit(readySessions);
  const splitFeatures = {};
  for (const split of ['train', 'validation', 'test']) {
    splitFeatures[split] = splitSessions[split].map(session => loadFeatureSet(fullManifest, session));
  }

  const validation = evaluateRows(flattenRows(splitFeatures.validation), model);
  const test = evaluateRows(flattenRows(splitFeatures.test), model);
  const warnings = [];
  for (const [split, report] of [['validation', validation], ['test', test]]) {
    if (report.rowSupportCoverage != null && report.rowSupportCoverage < 0.95) warnings.push({ code: 'heldout_action_support_below_95pct', split, value: report.rowSupportCoverage });
    if (report.assessedMetrics > 0 && report.metricEnvelopeCoverage < 0.5) warnings.push({ code: 'heldout_metric_shift_large', split, value: report.metricEnvelopeCoverage });
    for (const [actionType, count] of Object.entries(report.unsupportedActionCounts)) warnings.push({ code: 'heldout_action_family_not_modeled', split, actionType, count });
  }

  return {
    evaluatorVersion: EVALUATOR_VERSION,
    generatedAt: new Date().toISOString(),
    sourceManifest: path.relative(process.cwd(), fullManifest),
    sourceBaseline: path.relative(process.cwd(), fullBaseline),
    trainOnlyUsedForFit: baseline?.splitPolicy?.trainOnlyUsedForFit !== false,
    modelCoverage: model?.design ? {
      sourceRowCount: Number(model.design.sourceRowCount || 0),
      modeledRowCount: Number(model.design.modeledRowCount || 0),
      unmodeledRowCount: Number(model.design.unmodeledRowCount || 0),
      unmodeledActionCounts: model.design.unmodeledActionCounts || {}
    } : null,
    validation,
    test,
    warnings,
    policy: {
      heldoutSplitsNeverUsedForFit: true,
      p10ToP90EnvelopeIsDiagnosticNotGroundTruth: true,
      literalTrajectoryReplay: false
    }
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    if (!args.manifest || !args.baseline) throw new Error('Usage: node training-collector/tools/evaluate_behavior_batch_baseline.js --manifest <manifest.json> --baseline <behavior-baseline.json> [--out report.json]');
    const report = evaluateBehaviorBatchBaseline(args.manifest, args.baseline);
    if (args.out) {
      const output = path.resolve(args.out);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      evaluatorVersion: report.evaluatorVersion,
      modelCoverage: report.modelCoverage,
      validation: {
        rowCount: report.validation.rowCount,
        rowSupportCoverage: report.validation.rowSupportCoverage,
        metricEnvelopeCoverage: report.validation.metricEnvelopeCoverage,
        unsupportedActionCounts: report.validation.unsupportedActionCounts
      },
      test: {
        rowCount: report.test.rowCount,
        rowSupportCoverage: report.test.rowSupportCoverage,
        metricEnvelopeCoverage: report.test.metricEnvelopeCoverage,
        unsupportedActionCounts: report.test.unsupportedActionCounts
      },
      warnings: report.warnings,
      trainOnlyUsedForFit: report.trainOnlyUsedForFit
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  EVALUATOR_VERSION,
  actionFamily,
  envelope,
  evaluateRows,
  flattenRows,
  evaluateBehaviorBatchBaseline,
  parseArgs,
  main
};
