'use strict';

const assert = require('assert');
const { fitBaseline } = require('../tools/fit_strategy_offline_baseline.js');
const { runGate } = require('../../control-center/script/offline_strategy_fresh_unseen_decision_gate.js');

function action(type, targetRef) {
  return {
    contractVersion: '0.1.0',
    type,
    targetRef,
    args: {},
    intent: type,
    expectedOutcome: {}
  };
}

function observation(id, elements) {
  return {
    observationId: id,
    interactiveElements: elements,
    privacy: { redacted: true }
  };
}

function trainClick() {
  return {
    episodeId: 'contract-train-click',
    task: { instruction: 'Click Launch Control' },
    steps: [{
      stepIndex: 0,
      observation: observation('contract-click', [
        { ref: 'launch', label: 'Launch Control', role: 'button', tag: 'button', editable: false, visible: true, enabled: true }
      ]),
      action: action('click', 'launch')
    }]
  };
}

function trainForm() {
  const obs = observation('contract-form', [
    { ref: 'message', label: 'Message Field', role: 'textbox', tag: 'input', editable: true, visible: true, enabled: true },
    { ref: 'send', label: 'Send Message', role: 'button', tag: 'button', editable: false, visible: true, enabled: true }
  ]);
  return {
    episodeId: 'contract-train-form',
    task: { instruction: 'Type sample into Message Field and press Enter' },
    steps: [
      { stepIndex: 0, observation: obs, action: action('typeText', 'message') },
      { stepIndex: 1, observation: obs, action: action('submit', 'message') }
    ]
  };
}

async function main() {
  const model = fitBaseline([trainClick(), trainForm()]);
  assert.strictEqual(model.modelVersion, '0.3.3');
  const serializedBefore = JSON.stringify(model);
  assert.ok(!serializedBefore.includes('fresh-parcel-approval'));
  assert.ok(!serializedBefore.includes('fresh-dispatch-note'));
  assert.ok(!serializedBefore.includes('Approve Parcel'));
  assert.ok(!serializedBefore.includes('Dispatch Note'));

  const result = await runGate({ model, minimumConfidence: 0 });
  assert.strictEqual(result.result, 'PASS');
  assert.strictEqual(result.trainingOrFitPerformed, false);
  assert.strictEqual(result.modelMutatedInMemory, false);
  assert.strictEqual(result.freshFamilyCount, 2);
  assert.strictEqual(result.invariant.frozenModelOnly, true);
  assert.strictEqual(result.invariant.noFitPathImported, true);

  const click = result.scenarios.find(item => item.id === 'fresh-parcel-approval');
  assert.ok(click);
  assert.deepStrictEqual(click.actualSequence, ['click']);
  assert.deepStrictEqual(click.actualTargetRefs, ['fresh-approve']);

  const text = result.scenarios.find(item => item.id === 'fresh-dispatch-note');
  assert.ok(text);
  assert.deepStrictEqual(text.actualSequence, ['typeText', 'submit']);
  assert.deepStrictEqual(text.actualTargetRefs, ['fresh-dispatch-note', 'fresh-dispatch-note']);
  assert.strictEqual(text.decisions[0].actionSelectionTargetIndependent, true);
  assert.strictEqual(text.decisions[1].historyMatched, true);

  assert.strictEqual(JSON.stringify(model), serializedBefore);
  const serializedResult = JSON.stringify(result);
  assert.ok(!serializedResult.includes('selector'));
  assert.ok(!serializedResult.includes('rawCdp'));
  assert.ok(!serializedResult.includes('tabId'));

  console.log('Strategy fresh unseen decision contract: PASS');
}

if (require.main === module) {
  main().catch(error => {
    console.error('Strategy fresh unseen decision contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { action, observation, trainClick, trainForm, main };
