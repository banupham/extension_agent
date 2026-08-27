'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMissionPlan } = require('../../manager/mission/mission_plan.js');
const { executeMissionWithStrategy } = require('../../manager/mission/mission_strategy_executor.js');
const { loadBehaviorBaselineFile } = require('../../manager/behavior/baseline_loader.js');

function artifact() {
  const q = { count: 20, p10: 10, p25: 20, p50: 30, p75: 40, p90: 50 };
  return {
    batchBehaviorBaselineVersion: '0.1.0',
    splitPolicy: { trainOnlyUsedForFit: true },
    privacy: {
      derivedFeaturesOnly: true,
      rawTelemetryStored: false,
      rawTextStored: false,
      selectorsStored: false,
      observationLocalIdsStored: false,
      credentialsStored: false,
      privateReasoningStored: false
    },
    model: {
      behaviorBaselineVersion: '0.2.0',
      design: { literalTrajectoryReplay: false, sourceRowCount: 20, modeledRowCount: 20, unmodeledRowCount: 0 },
      families: {
        'pointer-click': {
          global: {
            sampleCount: 20,
            approachDurationMs: q,
            straightness: { count: 20, p10: 0.7, p25: 0.75, p50: 0.8, p75: 0.85, p90: 0.9 },
            meanSpeedPxS: q,
            meanAbsTurnDeg: q,
            correctionCount45Deg: q,
            acquisitionPauseMs: q,
            holdMs: q,
            endToCenterNormalized: { count: 20, p10: 0.1, p25: 0.15, p50: 0.2, p75: 0.25, p90: 0.3 }
          },
          contexts: {}
        }
      }
    }
  };
}

function observation(id, title) {
  return {
    observationId: id,
    capturedAt: new Date().toISOString(),
    url: 'http://behavior-runtime.test/',
    title,
    viewport: { width: 1000, height: 700 },
    scroll: { x: 0, y: 0 },
    focusedElement: null,
    interactiveElements: [{ ref: 'go', tag: 'button', role: 'button', label: 'Go', visible: true, enabled: true, rect: { x: 100, y: 100, width: 100, height: 40 } }],
    pageSignals: {},
    privacy: { redacted: true }
  };
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'behavior-baseline-runtime-'));
  try {
    const baselineFile = path.join(temp, 'behavior-baseline.json');
    fs.writeFileSync(baselineFile, `${JSON.stringify(artifact(), null, 2)}\n`, 'utf8');
    const loaded = loadBehaviorBaselineFile(baselineFile);
    assert.equal(loaded.model.behaviorBaselineVersion, '0.2.0');

    let title = 'READY';
    let observations = 0;
    const runtime = {
      async observe() { observations += 1; return observation(`obs-${observations}`, title); },
      async executePlan({ plan }) {
        assert.equal(plan.behaviorProfile, 'empirical-quantile-v01');
        title = 'DONE';
        return { ok: true };
      }
    };
    const plan = createMissionPlan({ missionId: 'behavior-runtime', instruction: 'Open the task' });
    const result = await executeMissionWithStrategy({
      plan,
      runtime,
      baselineFile,
      resolveSubgoalTask: async ({ subgoal }) => ({
        taskId: 'behavior-runtime-task',
        type: 'behavior-runtime',
        instruction: subgoal.instruction,
        successCriteria: [{ type: 'page', field: 'title', operator: 'equals', value: 'DONE' }]
      }),
      strategy: {
        async decide() {
          return { status: 'act', action: { type: 'click', targetRef: 'go', args: {} }, confidence: 1, reasonCode: 'runtime_baseline_contract' };
        }
      },
      episodeBudgets: { maxSteps: 2, maxDurationMs: 10000, maxConsecutiveFailures: 1, maxReplans: 1, maxStalledSteps: 1 }
    });

    assert.equal(result.ok, true);
    assert.equal(result.behaviorBaseline.loaded, true);
    assert.equal(result.behaviorBaseline.source, 'file');
    assert.equal(result.behaviorBaseline.behaviorBaselineVersion, '0.2.0');
    assert.equal(result.behaviorBaseline.batchBehaviorBaselineVersion, '0.1.0');
    assert.equal(result.invariant.behaviorBaselineNeverReplaysLiteralTrajectory, true);
    console.log('Behavior baseline runtime loading contract: PASS');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Behavior baseline runtime loading contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { artifact, observation, main };
