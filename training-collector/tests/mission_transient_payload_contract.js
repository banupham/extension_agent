'use strict';

const assert = require('assert');
const { executeMissionWithStrategy } = require('../../control-center/manager/mission/mission_strategy_executor.js');

const SECRET = 'MISSION-TRANSIENT-CANARY-9817';

function plan() {
  return {
    planVersion: '0.1.0',
    missionId: 'mission-transient-contract',
    instruction: 'Enter the relay note and submit it',
    subgoals: [{
      subgoalId: 'mission-transient-contract:sg-1',
      order: 0,
      instruction: 'Type the provided value into Relay Note and press Enter',
      status: 'pending',
      successCriteria: [],
      constraints: {},
      metadata: {}
    }],
    constraints: {},
    metadata: {}
  };
}

function observation(state, sequence) {
  return {
    observationId: `mission-obs-${sequence}`,
    capturedAt: new Date().toISOString(),
    url: 'http://mission-transient.test/',
    title: state === 0 ? 'READY' : state === 1 ? 'TYPED' : 'DONE',
    viewport: { width: 900, height: 700 },
    scroll: { x: 0, y: 0 },
    focusedRef: state >= 1 ? 'relay-note' : null,
    interactiveElements: [{
      ref: 'relay-note',
      tag: 'input',
      role: 'textbox',
      label: 'Relay Note',
      editable: true,
      enabled: true,
      visible: true,
      rect: { x: 80, y: 120, width: 320, height: 44 }
    }],
    pageSignals: {},
    privacy: { redacted: true }
  };
}

function runtime() {
  let state = 0;
  let sequence = 0;
  const rawPlans = [];
  return {
    rawPlans,
    async observe() {
      sequence += 1;
      return observation(state, sequence);
    },
    async executePlan({ plan: cdpPlan }) {
      rawPlans.push(cdpPlan);
      if (cdpPlan.actionType === 'typeText') {
        const text = cdpPlan.steps
          .filter(step => step.method === 'Input.insertText')
          .map(step => step.params.text)
          .join('');
        assert.equal(text, SECRET);
        state = 1;
      } else if (cdpPlan.actionType === 'submit') {
        assert.ok(cdpPlan.steps.some(step => step.method === 'Input.dispatchKeyEvent' && step.params?.key === 'Enter'));
        state = 2;
      } else {
        throw new Error(`unexpected_action:${cdpPlan.actionType}`);
      }
      return { ok: true };
    }
  };
}

function strategy() {
  return {
    async decide({ history }) {
      const first = history.length === 0;
      return {
        status: 'act',
        action: {
          contractVersion: '0.1.0',
          type: first ? 'typeText' : 'submit',
          targetRef: 'relay-note',
          args: {},
          intent: first ? 'enter-relay-note' : 'submit-relay-note',
          expectedOutcome: {}
        },
        confidence: 0.9,
        reasonCode: first ? 'contract_type' : 'contract_submit',
        recovery: {},
        metadata: { prototypeSource: 'contract' }
      };
    }
  };
}

async function main() {
  const rt = runtime();
  const seenSteps = [];
  const result = await executeMissionWithStrategy({
    plan: plan(),
    runtime: rt,
    strategy: strategy(),
    interpreter: {
      async interpretPlan(inputPlan) {
        return {
          semanticMissionInterpreterVersion: 'contract',
          missionId: inputPlan.missionId,
          subgoals: inputPlan.subgoals.map(item => ({ subgoalId: item.subgoalId }))
        };
      }
    },
    resolveSubgoalTask: ({ subgoal }) => ({
      taskId: `task-${subgoal.subgoalId}`,
      type: 'mission-transient-contract',
      instruction: subgoal.instruction,
      args: {},
      successCriteria: [{ type: 'page', field: 'title', operator: 'equals', value: 'DONE' }],
      constraints: {},
      metadata: { titlePassCriterionRequired: false }
    }),
    resolveTransientActionArgs: context => {
      assert.equal(context.mission.missionId, 'mission-transient-contract');
      assert.equal(context.subgoal.subgoalId, 'mission-transient-contract:sg-1');
      assert.equal(context.subgoalIndex, 0);
      return context.action?.type === 'typeText' ? { text: SECRET } : null;
    },
    onStep: context => {
      seenSteps.push({
        subgoalId: context.subgoal.subgoalId,
        stepIndex: context.step.stepIndex,
        actionType: context.step.action.type
      });
    },
    postActionSettle: false,
    episodeBudgets: {
      maxSteps: 4,
      maxDurationMs: 10000,
      maxConsecutiveFailures: 2,
      maxReplans: 3,
      maxStalledSteps: 2
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.reasonCode, 'mission_satisfied');
  assert.equal(result.missionStrategyExecutorVersion, '0.4.0');
  assert.equal(result.invariant.transientPayloadRedactedAcrossCompletedSubgoals, true);
  assert.deepStrictEqual(seenSteps.map(item => item.actionType), ['typeText', 'submit']);
  assert.ok(rt.rawPlans.length === 2);
  assert.equal(JSON.stringify(result).includes(SECRET), false, 'mission result must not persist transient text');
  assert.equal(result.subgoalResults[0].result.steps[0].transientPayload.applied, true);
  assert.equal(result.subgoalResults[0].result.steps[0].transientPayload.redacted, true);
  assert.equal(result.subgoalResults[0].result.steps[1].transientPayload.applied, false);

  console.log('Mission transient payload contract: PASS');
}

if (require.main === module) {
  main().catch(error => {
    console.error('Mission transient payload contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { SECRET, plan, observation, runtime, strategy, main };
