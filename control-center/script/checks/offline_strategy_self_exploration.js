'use strict';

const assert = require('assert');
const {
  candidateTargets,
  createSelfExplorationProvider,
  explorationStateSignature,
  stepChangedSemantically,
  progressiveExperienceResult
} = require('../../manager/strategy/self_exploration_provider.js');

function observation(id, enabled = {}) {
  return {
    observationId: id,
    url: 'http://127.0.0.1:8091/',
    title: enabled.pass ? 'DISCOVERY PASS' : 'PAGE_CDP Batch Lab',
    interactiveElements: [
      { ref: 'e20', tag: 'button', role: 'button', label: 'Discovery Alpha', visible: true, enabled: enabled.alpha !== false },
      { ref: 'e21', tag: 'button', role: 'button', label: 'Discovery Beta', visible: true, enabled: enabled.beta !== false },
      { ref: 'e22', tag: 'button', role: 'button', label: 'Discovery Gamma', visible: true, enabled: enabled.gamma !== false },
      { ref: 'e6', tag: 'button', role: 'button', label: 'Media Play', visible: true, enabled: true }
    ],
    pageSignals: {},
    privacy: { redacted: true }
  };
}

(async () => {
  const initial = observation('obs-0');
  assert.deepStrictEqual(candidateTargets(initial).map(x => x.label), [
    'Discovery Alpha',
    'Discovery Beta',
    'Discovery Gamma'
  ]);

  const provider = createSelfExplorationProvider();
  const first = await provider.decide({ observation: initial });
  assert.equal(first.status, 'act');
  assert.equal(first.action.type, 'click');
  assert.equal(first.action.targetRef, 'e20');
  assert.equal(first.metadata.targetLabel, 'Discovery Alpha');

  const second = await provider.decide({ observation: initial });
  assert.equal(second.action.targetRef, 'e21');
  assert.equal(second.metadata.targetLabel, 'Discovery Beta');

  const afterBeta = observation('obs-1', { beta: false });
  const third = await provider.decide({ observation: afterBeta });
  assert.equal(third.action.targetRef, 'e20');
  assert.equal(third.metadata.targetLabel, 'Discovery Alpha');

  const afterAlpha = observation('obs-2', { alpha: false, beta: false });
  const fourth = await provider.decide({ observation: afterAlpha });
  assert.equal(fourth.action.targetRef, 'e22');
  assert.equal(fourth.metadata.targetLabel, 'Discovery Gamma');

  assert.notEqual(explorationStateSignature(initial), explorationStateSignature(afterBeta));

  const unchangedStep = {
    before: initial,
    after: { ...initial, observationId: 'obs-0b' },
    outcome: { taskSucceeded: false },
    action: first.action
  };
  const changedStep = {
    before: initial,
    after: afterBeta,
    outcome: { taskSucceeded: false },
    action: second.action
  };
  const successStep = {
    before: afterAlpha,
    after: observation('obs-3', { alpha: false, beta: false, gamma: false, pass: true }),
    outcome: { taskSucceeded: true },
    action: fourth.action
  };
  assert.equal(stepChangedSemantically(unchangedStep), false);
  assert.equal(stepChangedSemantically(changedStep), true);

  const filtered = progressiveExperienceResult({ steps: [unchangedStep, changedStep, successStep] });
  assert.equal(filtered.steps.length, 2);
  assert.equal(filtered.steps[0].action.targetRef, 'e21');
  assert.equal(filtered.steps[1].action.targetRef, 'e22');

  for (const decision of [first, second, third, fourth]) {
    const text = JSON.stringify(decision);
    assert(!text.includes('selector'));
    assert(!text.includes('cdpMethod'));
    assert(!Object.prototype.hasOwnProperty.call(decision.action, 'x'));
    assert(!Object.prototype.hasOwnProperty.call(decision.action, 'y'));
  }

  console.log('Offline Strategy self exploration contract: PASS');
})().catch(error => {
  console.error(`Offline Strategy self exploration contract: FAIL\n${error.stack || error}`);
  process.exitCode = 1;
});
