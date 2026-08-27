'use strict';

const assert = require('assert');
const {
  GATE_VERSION,
  EVIDENCE_CLASS,
  EXPECTED_SUBGOAL_ACTIONS,
  EXPECTED_SUBGOAL_TARGETS,
  labHtml,
  missionPlan,
  successCriterionForSubgoal,
  evaluateResult
} = require('../../control-center/script/offline_strategy_fresh_long_mission_gate.js');

const SECRET = 'LONG-MISSION-TRANSIENT-CANARY-4412';

function element(ref, label, overrides = {}) {
  return {
    ref,
    tag: 'button',
    role: 'button',
    label,
    editable: false,
    enabled: true,
    visible: true,
    ...overrides
  };
}

function step({ type, ref = null, label = null, effectStatus = 'effect_observed', controlStatus = 'continue', source = 'historyPrototypes', recoveryDeferred = false, transient = false }) {
  return {
    stepIndex: 0,
    action: { type, targetRef: ref, args: {} },
    before: {
      interactiveElements: ref && label ? [element(ref, label, type === 'typeText' || type === 'submit' ? { tag: 'input', role: 'textbox', editable: true } : {})] : []
    },
    decision: {
      metadata: {
        prototypeSource: source,
        recoveryDeferredForBaseProgression: recoveryDeferred
      }
    },
    effect: { status: effectStatus, codes: effectStatus === 'no_effect' ? [] : ['elements_added'] },
    control: {
      status: controlStatus,
      reasonCode: controlStatus === 'failed' ? 'action_no_observable_effect' : 'goal_progressed'
    },
    transientPayload: {
      applied: transient,
      redacted: true,
      keys: transient ? ['text'] : []
    }
  };
}

function passingMissionResult() {
  return {
    ok: true,
    reasonCode: 'mission_satisfied',
    progress: { total: 3, done: 3, failed: 0, blocked: 0, progress: 1, missionDone: true },
    subgoalResults: [
      {
        subgoalId: 'fresh-long-signal-relay:sg-1',
        instruction: 'Click Open Relay Console',
        status: 'done',
        result: {
          steps: [
            step({ type: 'click', ref: 'open-relay', label: 'Open Relay Console', effectStatus: 'no_effect', controlStatus: 'failed' }),
            step({ type: 'waitAndObserve', source: 'recoveryExploration', effectStatus: 'effect_observed', controlStatus: 'done' })
          ],
          finalBudget: { reasonCode: 'goal_satisfied' }
        }
      },
      {
        subgoalId: 'fresh-long-signal-relay:sg-2',
        instruction: 'type the provided value into Relay Note and press Enter',
        status: 'done',
        result: {
          steps: [
            step({ type: 'typeText', ref: 'relay-note', label: 'Relay Note', effectStatus: 'no_effect', controlStatus: 'failed', transient: true }),
            step({ type: 'submit', ref: 'relay-note', label: 'Relay Note', recoveryDeferred: true, effectStatus: 'effect_observed', controlStatus: 'done' })
          ],
          finalBudget: { reasonCode: 'goal_satisfied' }
        }
      },
      {
        subgoalId: 'fresh-long-signal-relay:sg-3',
        instruction: 'click Finalize Relay',
        status: 'done',
        result: {
          steps: [
            step({ type: 'click', ref: 'finalize-relay', label: 'Finalize Relay', effectStatus: 'effect_observed', controlStatus: 'done' })
          ],
          finalBudget: { reasonCode: 'goal_satisfied' }
        }
      }
    ],
    invariant: {
      transientPayloadRedactedAcrossCompletedSubgoals: true,
      orderedExecution: true,
      semanticSubgoalCountMatchesPlan: true,
      allCompletedSubgoalsUsedGoalCheckedEpisodes: true,
      behaviorBaselineNeverReplaysLiteralTrajectory: true
    }
  };
}

function main() {
  assert.equal(GATE_VERSION, '0.1.1');
  assert.equal(EVIDENCE_CLASS, 'regression-after-diagnosis');
  assert.deepStrictEqual(EXPECTED_SUBGOAL_ACTIONS, [
    ['click', 'waitAndObserve'],
    ['typeText', 'submit'],
    ['click']
  ]);
  assert.deepStrictEqual(EXPECTED_SUBGOAL_TARGETS, [
    ['Open Relay Console', null],
    ['Relay Note', 'Relay Note'],
    ['Finalize Relay']
  ]);

  const plan = missionPlan();
  assert.equal(plan.subgoals.length, 3);
  assert.equal(plan.metadata.frozenEvaluationFamily, false);
  assert.equal(plan.metadata.evidenceClass, EVIDENCE_CLASS);
  assert.equal(plan.subgoals[0].instruction, 'Click Open Relay Console');
  assert.ok(plan.subgoals[1].instruction.includes('Relay Note'));
  assert.equal(plan.subgoals[2].instruction, 'click Finalize Relay');

  for (let index = 0; index < 3; index += 1) {
    const criterion = successCriterionForSubgoal(index);
    assert.equal(criterion.type, 'element');
    assert.ok(!JSON.stringify(criterion).includes('title'), 'long mission subgoals must use semantic element goals, not PASS titles');
  }

  const html = labHtml();
  assert.ok(html.includes('setTimeout'));
  assert.ok(html.includes('1200'));
  assert.ok(html.includes('Open Relay Console'));
  assert.ok(html.includes('Relay Note'));
  assert.ok(html.includes('Finalize Relay'));
  assert.ok(html.includes('Relay Complete'));

  const baseStrategy = {
    provider: { version: '0.3.3' },
    model: { loaded: true, source: 'file' }
  };
  const pass = evaluateResult(passingMissionResult(), baseStrategy, 'same-hash', 'same-hash', SECRET);
  assert.equal(pass.ok, true);
  assert.equal(pass.result, 'PASS');
  assert.equal(pass.evidenceClass, EVIDENCE_CLASS);
  assert.equal(pass.invariant.publicResultContainsTransientText, false);
  assert.equal(pass.invariant.transientPayloadRedacted, true);
  assert.deepStrictEqual(pass.actualSubgoalActions, EXPECTED_SUBGOAL_ACTIONS);
  assert.deepStrictEqual(pass.actualSubgoalTargets, EXPECTED_SUBGOAL_TARGETS);

  const missingRecovery = passingMissionResult();
  missingRecovery.subgoalResults[0].result.steps[1].decision.metadata.prototypeSource = 'historyPrototypes';
  const recoveryFail = evaluateResult(missingRecovery, baseStrategy, 'same-hash', 'same-hash', SECRET);
  assert.equal(recoveryFail.ok, false);
  assert.ok(recoveryFail.errors.includes('wait_recovery_not_used'));

  const missingProgressionGuard = passingMissionResult();
  missingProgressionGuard.subgoalResults[1].result.steps[1].decision.metadata.recoveryDeferredForBaseProgression = false;
  const progressionFail = evaluateResult(missingProgressionGuard, baseStrategy, 'same-hash', 'same-hash', SECRET);
  assert.equal(progressionFail.ok, false);
  assert.ok(progressionFail.errors.includes('recovery_progression_guard_not_observed'));

  const mutationFail = evaluateResult(passingMissionResult(), baseStrategy, 'before', 'after', SECRET);
  assert.equal(mutationFail.ok, false);
  assert.ok(mutationFail.errors.includes('model_file_mutated'));

  console.log('Signal Relay regression gate contract: PASS');
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error('Signal Relay regression gate contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { SECRET, element, step, passingMissionResult, main };
