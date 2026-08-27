'use strict';

const assert = require('assert');
const {
  RECOVERY_EXPLORATION_VERSION,
  baseDecisionProgressesPastTrigger,
  createRecoveryExplorationProvider
} = require('../../control-center/manager/strategy/recovery_exploration_provider.js');

function observation() {
  return {
    observationId: 'obs-recovery-progression',
    capturedAt: new Date().toISOString(),
    url: 'http://recovery-progression.test/',
    title: 'Recovery Progression Contract',
    viewport: { width: 900, height: 700 },
    scroll: { x: 0, y: 0 },
    focusedRef: null,
    interactiveElements: [
      { ref: 'relay-note', tag: 'input', role: 'textbox', label: 'Relay Note', editable: true, enabled: true, visible: true },
      { ref: 'open-console', tag: 'button', role: 'button', label: 'Open Relay Console', editable: false, enabled: true, visible: true },
      { ref: 'step-one', tag: 'button', role: 'button', label: 'Step One', editable: false, enabled: true, visible: true },
      { ref: 'step-two', tag: 'button', role: 'button', label: 'Step Two', editable: false, enabled: true, visible: true }
    ],
    pageSignals: {},
    privacy: { redacted: true }
  };
}

function failedHistory(actionType, targetLabel) {
  return [{
    stepIndex: 0,
    actionType,
    actionTargetLabel: targetLabel,
    controlStatus: 'failed',
    reasonCode: 'action_no_observable_effect',
    effectStatus: 'no_effect',
    effectCodes: []
  }];
}

function act(type, targetRef) {
  return {
    status: 'act',
    action: {
      contractVersion: '0.1.0',
      type,
      targetRef,
      args: {},
      intent: `contract:${type}`,
      expectedOutcome: {}
    },
    confidence: 0.8,
    reasonCode: 'base_contract',
    recovery: {},
    metadata: { prototypeSource: 'baseContract' }
  };
}

async function decisionFor(baseDecision, history) {
  const provider = createRecoveryExplorationProvider({
    baseProvider: { async decide() { return baseDecision; } },
    actionTypes: ['waitAndObserve']
  });
  return provider.decide({
    task: { instruction: 'Contract recovery progression task' },
    observation: observation(),
    history
  });
}

async function main() {
  assert.equal(RECOVERY_EXPLORATION_VERSION, '0.5.0');

  const trigger = {
    actionType: 'typeText',
    targetLabel: 'Relay Note'
  };
  assert.equal(baseDecisionProgressesPastTrigger(trigger, act('submit', 'relay-note'), observation()), true);
  assert.equal(baseDecisionProgressesPastTrigger(trigger, act('typeText', 'relay-note'), observation()), false);

  const textProgression = await decisionFor(
    act('submit', 'relay-note'),
    failedHistory('typeText', 'Relay Note')
  );
  assert.equal(textProgression.action.type, 'submit', 'typeText -> submit must not be hijacked by recovery');
  assert.equal(textProgression.metadata.recoveryDeferredForBaseProgression, true);

  const repeatedClick = await decisionFor(
    act('click', 'open-console'),
    failedHistory('click', 'Open Relay Console')
  );
  assert.equal(repeatedClick.action.type, 'waitAndObserve', 'repeated failed click should permit recovery exploration');
  assert.equal(repeatedClick.reasonCode, 'recovery_self_exploration');
  assert.equal(repeatedClick.metadata.triggerActionType, 'click');
  assert.equal(repeatedClick.metadata.triggerTargetLabel, 'Open Relay Console');

  const nextClickProgression = await decisionFor(
    act('click', 'step-two'),
    failedHistory('click', 'Step One')
  );
  assert.equal(nextClickProgression.action.type, 'click');
  assert.equal(nextClickProgression.action.targetRef, 'step-two');
  assert.equal(nextClickProgression.metadata.recoveryDeferredForBaseProgression, true, 'click -> different semantic target is progression');

  console.log('Recovery planned progression guard contract: PASS');
}

if (require.main === module) {
  main().catch(error => {
    console.error('Recovery planned progression guard contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { observation, failedHistory, act, decisionFor, main };
