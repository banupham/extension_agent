'use strict';

const assert = require('assert');
const {
  OUTCOME_CONTROL_VERSION,
  CONTROL_STATUSES,
  normalizeBlocker,
  reduceOutcomeToControl
} = require('../../manager/goal/outcome_controller.js');

function outcome(overrides = {}) {
  return {
    actionSucceeded: true,
    taskSucceeded: false,
    progress: 0,
    evidence: [],
    errorCode: null,
    metadata: { progressDelta: 0 },
    ...overrides
  };
}

function main() {
  assert.equal(OUTCOME_CONTROL_VERSION, '0.2.0');
  assert.deepEqual([...CONTROL_STATUSES].sort(), ['blocked', 'continue', 'done', 'failed']);

  const done = reduceOutcomeToControl({
    outcome: outcome({
      actionSucceeded: false,
      taskSucceeded: true,
      progress: 1,
      errorCode: 'late_execution_error',
      metadata: { progressDelta: 0 }
    }),
    blocker: { active: true, reasonCode: 'human_verification_required' }
  });
  assert.equal(done.status, 'done');
  assert.equal(done.terminal, true);
  assert.equal(done.shouldReplan, false);
  assert.equal(done.reasonCode, 'goal_satisfied');

  const unchanged = reduceOutcomeToControl({ outcome: outcome() });
  assert.equal(unchanged.status, 'continue');
  assert.equal(unchanged.terminal, false);
  assert.equal(unchanged.shouldReplan, true);
  assert.equal(unchanged.reasonCode, 'goal_not_yet_satisfied');

  const optionalNoEffect = reduceOutcomeToControl({
    outcome: outcome({
      metadata: {
        progressDelta: 0,
        actionEffectStatus: 'no_effect',
        actionEffectExpected: false,
        actionEffectCodes: []
      }
    })
  });
  assert.equal(optionalNoEffect.status, 'continue');
  assert.equal(optionalNoEffect.reasonCode, 'goal_not_yet_satisfied');

  const noEffect = reduceOutcomeToControl({
    outcome: outcome({
      metadata: {
        progressDelta: 0,
        actionEffectStatus: 'no_effect',
        actionEffectExpected: true,
        actionEffectCodes: []
      }
    })
  });
  assert.equal(noEffect.status, 'failed');
  assert.equal(noEffect.terminal, false);
  assert.equal(noEffect.shouldReplan, true);
  assert.equal(noEffect.reasonCode, 'action_no_observable_effect');
  assert.equal(noEffect.effectStatus, 'no_effect');
  assert.equal(noEffect.effectExpected, true);

  const observedEffect = reduceOutcomeToControl({
    outcome: outcome({
      metadata: {
        progressDelta: 0,
        actionEffectStatus: 'effect_observed',
        actionEffectExpected: true,
        actionEffectCodes: ['target_disappeared']
      }
    })
  });
  assert.equal(observedEffect.status, 'continue');
  assert.equal(observedEffect.reasonCode, 'action_effect_observed');
  assert.deepEqual(observedEffect.effectCodes, ['target_disappeared']);

  const progressed = reduceOutcomeToControl({
    outcome: outcome({ progress: 0.5, metadata: { progressDelta: 0.5 } })
  });
  assert.equal(progressed.status, 'continue');
  assert.equal(progressed.reasonCode, 'goal_progressed');
  assert.equal(progressed.progress, 0.5);
  assert.equal(progressed.progressDelta, 0.5);

  const failedExecution = reduceOutcomeToControl({
    outcome: outcome({ actionSucceeded: false, errorCode: 'target_geometry_changed' })
  });
  assert.equal(failedExecution.status, 'failed');
  assert.equal(failedExecution.terminal, false);
  assert.equal(failedExecution.shouldReplan, true);
  assert.equal(failedExecution.reasonCode, 'target_geometry_changed');

  const failedGoalContract = reduceOutcomeToControl({
    outcome: outcome({ actionSucceeded: true, errorCode: 'goal_criteria_invalid' })
  });
  assert.equal(failedGoalContract.status, 'failed');
  assert.equal(failedGoalContract.reasonCode, 'goal_criteria_invalid');

  const blocked = reduceOutcomeToControl({
    outcome: outcome({ actionSucceeded: true, progress: 0.25, metadata: { progressDelta: 0.25 } }),
    blocker: { active: true, reasonCode: 'human_verification_required' }
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.terminal, true);
  assert.equal(blocked.shouldReplan, false);
  assert.equal(blocked.reasonCode, 'human_verification_required');
  assert.equal(blocked.blockerReasonCode, 'human_verification_required');

  assert.equal(normalizeBlocker(null), null);
  assert.equal(normalizeBlocker({ active: false, reasonCode: 'ignored' }), null);
  assert.throws(() => normalizeBlocker({ active: true }), /outcome_blocker_reason_required/);
  assert.throws(() => normalizeBlocker('blocked'), /outcome_blocker_object_required/);

  console.log('A5.2 Outcome Controller contract: PASS');
}

try {
  main();
} catch (error) {
  console.error('A5.2 Outcome Controller contract: FAIL');
  console.error(error.stack || error.message || String(error));
  process.exit(1);
}
