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
} = require('../../control-center/script/offline_strategy_fresh_long_harbor_gate.js');

const SECRET = 'HARBOR-TRANSIENT-CANARY-7721';

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
    decision: { metadata: { prototypeSource: source, recoveryDeferredForBaseProgression: recoveryDeferred } },
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
        subgoalId: 'fresh-long-harbor-dispatch:sg-1',
        status: 'done',
        result: {
          steps: [
            step({ type: 'typeText', ref: 'dispatch-token', label: 'Dispatch Token', effectStatus: 'no_effect', controlStatus: 'failed', transient: true }),
            step({ type: 'submit', ref: 'dispatch-token', label: 'Dispatch Token', recoveryDeferred: true, effectStatus: 'effect_observed', controlStatus: 'done' })
          ],
          finalBudget: { reasonCode: 'goal_satisfied' }
        }
      },
      {
        subgoalId: 'fresh-long-harbor-dispatch:sg-2',
        status: 'done',
        result: {
          steps: [
            step({ type: 'click', ref: 'open-schedule', label: 'Open Berth Schedule', effectStatus: 'no_effect', controlStatus: 'failed' }),
            step({ type: 'waitAndObserve', source: 'recoveryExploration', effectStatus: 'effect_observed', controlStatus: 'done' })
          ],
          finalBudget: { reasonCode: 'goal_satisfied' }
        }
      },
      {
        subgoalId: 'fresh-long-harbor-dispatch:sg-3',
        status: 'done',
        result: {
          steps: [
            step({ type: 'click', ref: 'confirm-berth', label: 'Confirm Berth', effectStatus: 'effect_observed', controlStatus: 'done' })
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
  assert.equal(GATE_VERSION, '0.1.0');
  assert.equal(EVIDENCE_CLASS, 'fresh-unseen-controlled-native');
  assert.deepStrictEqual(EXPECTED_SUBGOAL_ACTIONS, [
    ['typeText', 'submit'],
    ['click', 'waitAndObserve'],
    ['click']
  ]);
  assert.deepStrictEqual(EXPECTED_SUBGOAL_TARGETS, [
    ['Dispatch Token', 'Dispatch Token'],
    ['Open Berth Schedule', null],
    ['Confirm Berth']
  ]);

  const plan = missionPlan();
  assert.equal(plan.subgoals.length, 3);
  assert.ok(plan.subgoals[0].instruction.includes('Dispatch Token'));
  assert.equal(plan.subgoals[1].instruction, 'click Open Berth Schedule');
  assert.equal(plan.subgoals[2].instruction, 'click Confirm Berth');
  assert.equal(plan.metadata.frozenEvaluationFamily, true);
  assert.equal(plan.metadata.evidenceClass, EVIDENCE_CLASS);

  for (let index = 0; index < 3; index += 1) {
    const criterion = successCriterionForSubgoal(index);
    assert.equal(criterion.type, 'element');
    assert.ok(!JSON.stringify(criterion).includes('title'));
  }

  const html = labHtml();
  assert.ok(/<button[^>]+type="submit"[^>]+hidden/i.test(html), 'fresh form must have native hidden submit control');
  assert.ok(html.includes('Dispatch Token'));
  assert.ok(html.includes('Open Berth Schedule'));
  assert.ok(html.includes('Confirm Berth'));
  assert.ok(html.includes('Berth Confirmed'));
  assert.ok(html.includes('setTimeout'));
  assert.ok(html.includes('1200'));
  assert.ok(!/addEventListener\(['"]keydown/i.test(html), 'must not force Enter with keydown handler');
  assert.ok(!/requestSubmit\s*\(/i.test(html), 'must not bypass native form semantics with requestSubmit');
  assert.ok(!/\.submit\s*\(/i.test(html), 'must not bypass native form semantics with direct submit');

  const baseStrategy = { provider: { version: '0.3.3' }, model: { loaded: true, source: 'file' } };
  const pass = evaluateResult(passingMissionResult(), baseStrategy, 'same-hash', 'same-hash', SECRET);
  assert.equal(pass.ok, true);
  assert.equal(pass.result, 'PASS');
  assert.equal(pass.evidenceClass, EVIDENCE_CLASS);
  assert.deepStrictEqual(pass.actualSubgoalActions, EXPECTED_SUBGOAL_ACTIONS);
  assert.deepStrictEqual(pass.actualSubgoalTargets, EXPECTED_SUBGOAL_TARGETS);
  assert.equal(pass.invariant.publicResultContainsTransientText, false);

  const noProgressionGuard = passingMissionResult();
  noProgressionGuard.subgoalResults[0].result.steps[1].decision.metadata.recoveryDeferredForBaseProgression = false;
  const progressionFail = evaluateResult(noProgressionGuard, baseStrategy, 'same-hash', 'same-hash', SECRET);
  assert.equal(progressionFail.ok, false);
  assert.ok(progressionFail.errors.includes('recovery_progression_guard_not_observed'));

  const noRecovery = passingMissionResult();
  noRecovery.subgoalResults[1].result.steps[1].decision.metadata.prototypeSource = 'historyPrototypes';
  const recoveryFail = evaluateResult(noRecovery, baseStrategy, 'same-hash', 'same-hash', SECRET);
  assert.equal(recoveryFail.ok, false);
  assert.ok(recoveryFail.errors.includes('wait_recovery_not_used'));

  const mutationFail = evaluateResult(passingMissionResult(), baseStrategy, 'before', 'after', SECRET);
  assert.equal(mutationFail.ok, false);
  assert.ok(mutationFail.errors.includes('model_file_mutated'));

  console.log('Fresh Harbor long mission gate contract: PASS');
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error('Fresh Harbor long mission gate contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { SECRET, element, step, passingMissionResult, main };
