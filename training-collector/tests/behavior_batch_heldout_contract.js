'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildBehaviorBatchBaseline } = require('../tools/build_behavior_batch_baseline.js');
const { evaluateBehaviorBatchBaseline } = require('../tools/evaluate_behavior_batch_baseline.js');

function featureSet(actionType, offset) {
  const rows = [];
  for (let i = 0; i < 3; i += 1) {
    if (actionType === 'click') {
      rows.push({ actionType, features: {
        approach: { durationMs: 100 + offset + i, straightness: 0.8, meanSpeedPxS: 500 + offset, meanAbsTurnDeg: 10, correctionCount45Deg: 1 },
        acquisitionPauseMs: 20 + i,
        press: { holdMs: 70 + i },
        acquisition: { endToCenterNormalized: 0.2 },
        target: { areaPx2: 5000 }
      } });
    } else if (actionType === 'focus') {
      rows.push({ actionType, features: {
        leadInTiming: { durationMs: 110 + offset + i, gapMedianMs: 18 },
        pointerLeadIn: { durationMs: 90 + offset + i, straightness: 0.84, meanSpeedPxS: 440 + offset, meanAbsTurnDeg: 11 },
        target: { areaPx2: 6000 }
      } });
    } else {
      rows.push({ actionType, features: {
        timing: { durationMs: 150 + offset + i, gapMedianMs: 20 },
        eventCount: 4,
        absolutePrimaryDelta: 300 + offset,
        primaryDeltaP90: 120,
        correctionRatio: 0.05
      } });
    }
  }
  return {
    behaviorFeatureVersion: '0.2.0',
    sourceActionWindowVersion: '0.1.4',
    privacy: { printableHumanKeyContentStored: false, credentialValuesExpected: false, observationLocalIdsStored: false, selectorsStored: false },
    rows
  };
}

function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'heldout-behavior-'));
  const oldCwd = process.cwd();
  try {
    process.chdir(temp);
    const behaviorDir = path.join(temp, 'behavior');
    fs.mkdirSync(behaviorDir, { recursive: true });
    const sessions = [];
    for (let i = 0; i < 30; i += 1) {
      const actionType = i % 3 === 0 ? 'focus' : i % 2 ? 'click' : 'scrollVertical';
      const output = path.join(behaviorDir, `s${i}.json`);
      fs.writeFileSync(output, `${JSON.stringify(featureSet(actionType, i), null, 2)}\n`, 'utf8');
      sessions.push({ file: `raw/s${i}.raw.jsonl`, status: 'behavior-features-ready', featureRows: 3, output });
    }
    const manifestFile = path.join(temp, 'manifest.json');
    fs.writeFileSync(manifestFile, `${JSON.stringify({ behavior: { sessions } }, null, 2)}\n`, 'utf8');
    const baseline = buildBehaviorBatchBaseline(manifestFile);
    const baselineFile = path.join(temp, 'baseline.json');
    fs.writeFileSync(baselineFile, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');

    assert.equal(baseline.model.behaviorBaselineVersion, '0.2.0');
    assert.equal(baseline.model.design.unmodeledRowCount, 0);
    assert.ok(baseline.model.families['form-control'].global.sampleCount > 0);

    const report = evaluateBehaviorBatchBaseline(manifestFile, baselineFile);
    assert.equal(report.evaluatorVersion, '0.2.0');
    assert.equal(report.trainOnlyUsedForFit, true);
    assert.equal(report.modelCoverage.unmodeledRowCount, 0);
    assert.ok(report.validation.rowCount > 0);
    assert.ok(report.test.rowCount > 0);
    assert.equal(report.validation.rowSupportCoverage, 1);
    assert.equal(report.test.rowSupportCoverage, 1);
    assert.ok(report.validation.assessedMetrics > 0);
    assert.ok(report.test.assessedMetrics > 0);
    assert.equal(Object.keys(report.validation.unsupportedActionCounts).length, 0);
    assert.equal(Object.keys(report.test.unsupportedActionCounts).length, 0);
    assert.equal(report.policy.heldoutSplitsNeverUsedForFit, true);
    assert.equal(report.policy.literalTrajectoryReplay, false);

    console.log('Behavior batch heldout contract: PASS');
  } finally {
    process.chdir(oldCwd);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error('Behavior batch heldout contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { featureSet, main };
