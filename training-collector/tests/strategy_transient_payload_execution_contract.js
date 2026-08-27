'use strict';

const assert = require('assert');
const { executeBoundedEpisodeLoop } = require('../../control-center/manager/agent/bounded_episode_loop.js');
const { validateAgentAction, mapAgentAction } = require('../../control-center/manager/strategy/agent_action_contract.js');
const { sampledBehavior } = require('../../control-center/manager/behavior/empirical_policy.js');
const { buildSubmitCdpPlan } = require('../../control-center/manager/execution/submit_plan.js');

const SECRET = 'PRIVATE-CANARY-7429';

function element(ref, overrides = {}) {
  return {
    ref,
    tag: 'textarea',
    role: 'textbox',
    label: 'Dispatch Note',
    editable: true,
    enabled: true,
    visible: true,
    rect: { x: 80, y: 120, width: 320, height: 80 },
    ...overrides
  };
}

function observation(state, sequence) {
  return {
    observationId: `obs-${sequence}`,
    capturedAt: new Date().toISOString(),
    url: 'http://transient-payload.test/',
    title: state === 0 ? 'READY' : state === 1 ? 'TYPED' : 'DONE',
    viewport: { width: 900, height: 700 },
    scroll: { x: 0, y: 0 },
    focusedRef: state >= 1 ? 'dispatch-note' : null,
    interactiveElements: [
      element('dispatch-note'),
      element('other-note', { label: 'Other Note', rect: { x: 80, y: 240, width: 320, height: 80 } }),
      element('send-button', {
        tag: 'button', role: 'button', label: 'Send Dispatch', editable: false,
        rect: { x: 430, y: 120, width: 140, height: 44 }
      })
    ],
    pageSignals: {},
    privacy: { redacted: true }
  };
}

function task() {
  return {
    taskId: 'transient-payload-contract',
    type: 'controlled-native-text',
    instruction: 'Type the requested parcel code into Dispatch Note and press Enter',
    args: {},
    successCriteria: [{ type: 'page', field: 'title', operator: 'equals', value: 'DONE' }],
    constraints: {},
    metadata: { gate: 'transient-payload-contract' }
  };
}

function strategy() {
  return {
    async decide({ history }) {
      const first = history.length === 0;
      return {
        status: 'act',
        action: {
          type: first ? 'typeText' : 'submit',
          targetRef: 'dispatch-note',
          args: {},
          intent: first ? 'enter-dispatch-note' : 'submit-dispatch-note',
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

function makeRuntime() {
  let state = 0;
  let observationSequence = 0;
  const rawPlans = [];
  return {
    rawPlans,
    async observe() {
      observationSequence += 1;
      return observation(state, observationSequence);
    },
    async executePlan({ plan }) {
      rawPlans.push(plan);
      if (plan.actionType === 'typeText') {
        const inserts = plan.steps.filter(step => step.method === 'Input.insertText');
        assert.equal(inserts.map(step => step.params.text).join(''), SECRET);
        const firstInsert = plan.steps.findIndex(step => step.method === 'Input.insertText');
        const mouseDown = plan.steps.findIndex(step => step.method === 'Input.dispatchMouseEvent' && step.params?.type === 'mousePressed');
        assert.ok(mouseDown >= 0 && mouseDown < firstInsert, 'typeText must acquire target before inserting text');
        state = 1;
      } else if (plan.actionType === 'submit') {
        assert.ok(plan.steps.some(step => step.method === 'Input.dispatchKeyEvent' && step.params?.key === 'Enter'), 'editable submit must press Enter');
        state = 2;
      } else {
        throw new Error(`unexpected_action:${plan.actionType}`);
      }
      // Intentionally echo the raw plan. The bridge must redact it before returning public results.
      return { ok: true, echoedPlan: plan };
    }
  };
}

async function main() {
  assert.throws(
    () => validateAgentAction({ type: 'typeText', targetRef: null, args: {} }),
    /typeText requires targetRef/
  );

  const runtime = makeRuntime();
  const result = await executeBoundedEpisodeLoop({
    runtime,
    strategy: strategy(),
    task: task(),
    postActionSettle: false,
    resolveTransientActionArgs: ({ action }) => action?.type === 'typeText' ? { text: SECRET } : null,
    budgets: {
      maxSteps: 4,
      maxDurationMs: 10000,
      maxConsecutiveFailures: 2,
      maxReplans: 3,
      maxStalledSteps: 2
    }
  });

  assert.equal(result.finalOutcome.taskSucceeded, true);
  assert.equal(result.finalBudget.reasonCode, 'goal_satisfied');
  assert.deepStrictEqual(result.steps.map(step => step.action.type), ['typeText', 'submit']);
  assert.equal(result.steps[0].action.targetRef, 'dispatch-note');
  assert.equal(result.steps[1].action.targetRef, 'dispatch-note');
  assert.deepStrictEqual(result.steps[0].action.args, {});
  assert.equal(result.steps[0].transientPayload.applied, true);
  assert.equal(result.steps[0].transientPayload.redacted, true);
  assert.deepStrictEqual(result.steps[0].transientPayload.keys, ['text']);
  assert.equal(result.steps[1].transientPayload.applied, false);
  assert.equal(result.invariant.transientPayloadRedacted, true);
  assert.equal(runtime.rawPlans.length, 2);
  assert.ok(JSON.stringify(runtime.rawPlans[0]).includes(SECRET), 'raw execution plan must receive transient text');
  assert.equal(JSON.stringify(result).includes(SECRET), false, 'public bounded result must not persist transient text');
  assert.equal(JSON.stringify(result.history).includes(SECRET), false, 'Strategy history must not persist transient text');
  assert.equal(JSON.stringify(result.steps.map(step => step.decision)).includes(SECRET), false, 'Strategy decisions must not persist transient text');

  const buttonTarget = element('button-submit', {
    tag: 'button', role: 'button', label: 'Submit Parcel', editable: false,
    rect: { x: 40, y: 40, width: 140, height: 44 }
  });
  const buttonAction = mapAgentAction({ type: 'submit', targetRef: buttonTarget.ref, args: {} });
  const buttonBehavior = sampledBehavior({ mappedAction: buttonAction, target: buttonTarget, rng: () => 0.5 });
  const buttonPlan = buildSubmitCdpPlan({
    mappedAction: buttonAction,
    behavior: buttonBehavior,
    target: buttonTarget,
    context: { pointerStart: { x: 0, y: 0 }, viewportCenter: { x: 450, y: 350 }, rng: () => 0.5 }
  });
  assert.ok(buttonPlan.steps.some(step => step.method === 'Input.dispatchMouseEvent' && step.params?.type === 'mousePressed'));
  assert.equal(buttonPlan.steps.some(step => step.method === 'Input.dispatchKeyEvent' && step.params?.key === 'Enter'), false, 'button submit should click, not add Enter');

  console.log('Strategy transient payload execution contract: PASS');
}

if (require.main === module) {
  main().catch(error => {
    console.error('Strategy transient payload execution contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { SECRET, element, observation, task, strategy, makeRuntime, main };
