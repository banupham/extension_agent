'use strict';

const assert = require('assert');
const { createStrategy } = require('../../manager/strategy/index.js');
const {
  buildRecoveryRecords,
  createRecoveryPolicyProvider,
  selectRecovery
} = require('../../manager/strategy/recovery_policy_memory.js');
const { executeBoundedEpisodeLoop } = require('../../manager/agent/bounded_episode_loop.js');

function button(ref, label) {
  return {
    ref,
    tag: 'button',
    role: 'button',
    label,
    visible: true,
    enabled: true,
    editable: false,
    rect: { x: 100, y: 100, width: 120, height: 40 }
  };
}

function page(id, { title = 'READY', scrollY = 0, continueVisible = false, dismissVisible = false } = {}) {
  const interactiveElements = [button('e0', 'Probe')];
  if (continueVisible) interactiveElements.push(button('e1', 'Continue'));
  if (dismissVisible) interactiveElements.push(button('e2', 'Dismiss Overlay'));
  return {
    observationId: id,
    capturedAt: new Date().toISOString(),
    url: 'http://127.0.0.1:8091/',
    title,
    viewport: { width: 800, height: 600 },
    scroll: { x: 0, y: scrollY },
    focusedRef: null,
    interactiveElements,
    pageSignals: {},
    privacy: { redacted: true }
  };
}

function successfulTrainingEpisode({ instruction, recoveryType, recoveryTargetLabel = null }) {
  const triggerBefore = page('train-before');
  const triggerAfter = page('train-after');
  const recoveryBefore = recoveryTargetLabel
    ? page('train-recovery-before', { dismissVisible: true })
    : page('train-recovery-before');
  const recoveryAfter = recoveryType === 'scrollVertical'
    ? page('train-recovery-after', { scrollY: 500, continueVisible: true })
    : page('train-recovery-after', { title: 'TRAINING GOAL' });

  const recoveryTargetRef = recoveryTargetLabel ? 'e2' : null;
  return {
    finalOutcome: { taskSucceeded: true },
    finalControl: { status: 'done' },
    finalBudget: { terminal: true, reasonCode: 'goal_satisfied' },
    steps: [
      {
        action: { type: 'click', targetRef: 'e0', args: {} },
        before: triggerBefore,
        after: triggerAfter,
        effect: { status: 'no_effect', codes: [], confidence: 0.9 },
        outcome: { taskSucceeded: false, metadata: { progressDelta: 0 } },
        control: { status: 'failed', reasonCode: 'action_no_observable_effect' }
      },
      {
        action: { type: recoveryType, targetRef: recoveryTargetRef, args: {} },
        before: recoveryBefore,
        after: recoveryAfter,
        effect: {
          status: 'effect_observed',
          codes: recoveryType === 'scrollVertical' ? ['scroll_changed', 'elements_added'] : ['target_disappeared'],
          confidence: 0.95
        },
        outcome: { taskSucceeded: true, metadata: { progressDelta: 1 } },
        control: { status: 'done', reasonCode: 'goal_satisfied' }
      }
    ],
    task: { instruction }
  };
}

async function main() {
  const scrollTask = { instruction: 'Reveal the hidden continue control' };
  const scrollResult = successfulTrainingEpisode({
    instruction: scrollTask.instruction,
    recoveryType: 'scrollVertical'
  });
  const scrollRecords = buildRecoveryRecords({ task: scrollTask, result: scrollResult });
  assert.equal(scrollRecords.length, 1);
  assert.equal(scrollRecords[0].trigger.actionType, 'click');
  assert.equal(scrollRecords[0].trigger.targetLabel, 'Probe');
  assert.equal(scrollRecords[0].trigger.effectStatus, 'no_effect');
  assert.equal(scrollRecords[0].recovery.type, 'scrollVertical');
  assert.equal(scrollRecords[0].recovery.targetLabel, null);
  assert.equal(JSON.stringify(scrollRecords[0]).includes('targetRef'), false);
  assert.equal(JSON.stringify(scrollRecords[0]).includes('selector'), false);

  const dismissTask = { instruction: 'Close the blocking overlay' };
  const dismissResult = successfulTrainingEpisode({
    instruction: dismissTask.instruction,
    recoveryType: 'dismiss',
    recoveryTargetLabel: 'Dismiss Overlay'
  });
  const dismissRecords = buildRecoveryRecords({ task: dismissTask, result: dismissResult });
  assert.equal(dismissRecords.length, 1);
  assert.equal(dismissRecords[0].recovery.type, 'dismiss');
  assert.equal(dismissRecords[0].recovery.targetLabel, 'Dismiss Overlay');

  const failureHistory = [{
    stepIndex: 1,
    actionType: 'click',
    actionTargetLabel: 'Probe',
    controlStatus: 'failed',
    reasonCode: 'action_no_observable_effect',
    effectStatus: 'no_effect',
    effectCodes: [],
    shouldReplan: true
  }];
  const selectedScroll = selectRecovery([...scrollRecords, ...dismissRecords], scrollTask, failureHistory, 0.55);
  assert.ok(selectedScroll);
  assert.equal(selectedScroll.record.recovery.type, 'scrollVertical');
  const selectedDismiss = selectRecovery([...scrollRecords, ...dismissRecords], dismissTask, failureHistory, 0.55);
  assert.ok(selectedDismiss);
  assert.equal(selectedDismiss.record.recovery.type, 'dismiss');

  let observeCount = 0;
  let title = 'READY';
  let scrollY = 0;
  let continueVisible = false;
  const runtime = {
    async observe() {
      observeCount += 1;
      return page(`obs-${observeCount}`, { title, scrollY, continueVisible });
    },
    async executePlan({ plan }) {
      if (plan.actionType === 'click' && !continueVisible) {
        return { ok: true };
      }
      if (plan.actionType === 'scrollVertical') {
        scrollY = 500;
        continueVisible = true;
        return { ok: true };
      }
      if (plan.actionType === 'click' && continueVisible) {
        title = 'RECOVERY PASS';
        continueVisible = false;
        return { ok: true };
      }
      return { ok: true };
    }
  };

  const baseProvider = {
    name: 'recovery-contract-base',
    version: '0.1.0',
    async decide({ observation, history }) {
      if (!history.length) {
        return {
          status: 'act',
          action: { type: 'click', targetRef: 'e0', args: {} },
          reasonCode: 'initial_probe',
          expectedOutcome: {},
          recovery: {},
          metadata: { prototypeSource: 'base' }
        };
      }
      const continueTarget = (observation.interactiveElements || []).find(element => element.label === 'Continue');
      if (continueTarget) {
        return {
          status: 'act',
          action: { type: 'click', targetRef: continueTarget.ref, args: {} },
          reasonCode: 'continue_after_recovery',
          expectedOutcome: {},
          recovery: {},
          metadata: { prototypeSource: 'base' }
        };
      }
      return {
        status: 'act',
        action: { type: 'waitAndObserve', targetRef: null, args: {} },
        reasonCode: 'base_has_no_hardcoded_recovery',
        expectedOutcome: {},
        recovery: {},
        metadata: { prototypeSource: 'base' }
      };
    }
  };

  const provider = createRecoveryPolicyProvider({
    baseProvider,
    records: [...scrollRecords, ...dismissRecords],
    minimumScore: 0.55
  });
  const strategy = createStrategy({ provider });
  const result = await executeBoundedEpisodeLoop({
    runtime,
    strategy,
    postActionSettle: false,
    task: {
      taskId: 'learned-recovery-contract',
      type: 'controlled',
      instruction: scrollTask.instruction,
      args: {},
      successCriteria: [{ type: 'page', field: 'title', operator: 'equals', value: 'RECOVERY PASS' }],
      constraints: {},
      metadata: {}
    },
    budgets: {
      maxSteps: 5,
      maxDurationMs: 120000,
      maxConsecutiveFailures: 3,
      maxReplans: 4,
      maxStalledSteps: 3
    }
  });

  assert.equal(result.finalOutcome.taskSucceeded, true);
  assert.equal(result.finalBudget.reasonCode, 'goal_satisfied');
  assert.deepEqual(result.steps.map(step => step.action.type), ['click', 'scrollVertical', 'click']);
  assert.equal(result.steps[0].effect.status, 'no_effect');
  assert.equal(result.steps[0].control.status, 'failed');
  assert.equal(result.steps[0].control.reasonCode, 'action_no_observable_effect');
  assert.equal(result.steps[1].decision.metadata.prototypeSource, 'recoveryPolicy');
  assert.equal(result.steps[1].decision.reasonCode, 'learned_recovery_policy');
  assert.ok(result.steps[1].effect.codes.includes('scroll_changed'));
  assert.ok(result.steps[1].effect.codes.includes('elements_added'));
  assert.equal(result.steps[2].decision.metadata.prototypeSource, 'base');
  assert.equal(result.history[0].actionTargetLabel, 'Probe');
  assert.equal(result.history[0].effectStatus, 'no_effect');
  assert.equal(result.invariant.selectorUsedByStrategy, false);
  assert.equal(result.invariant.literalTrajectoryReplay, false);

  const unknownTaskDecision = await createRecoveryPolicyProvider({
    baseProvider,
    records: scrollRecords,
    minimumScore: 0.9
  }).decide({
    task: { instruction: 'Completely unrelated task' },
    observation: page('unknown'),
    history: failureHistory
  });
  assert.equal(unknownTaskDecision.metadata.prototypeSource, 'base');
  assert.equal(unknownTaskDecision.action.type, 'waitAndObserve');

  console.log('Learned recovery policy contract: PASS');
}

main().catch(error => {
  console.error('Learned recovery policy contract: FAIL');
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
