'use strict';

const assert = require('assert');
const {
  candidateTargets,
  explorationCandidates,
  createSelfExplorationProvider,
  explorationStateSignature,
  stepChangedSemantically,
  progressiveExperienceResult
} = require('../../manager/strategy/self_exploration_provider.js');

function observation(id, enabled = {}, scrollY = 0) {
  return {
    observationId: id,
    url: 'http://127.0.0.1:8091/',
    title: enabled.pass ? 'DISCOVERY PASS' : 'PAGE_CDP Batch Lab',
    viewport: { width: 800, height: 600 },
    scroll: { x: 0, y: scrollY },
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
  assert.deepStrictEqual(explorationCandidates(initial).map(x => `${x.type}:${x.label}`), [
    'click:Discovery Alpha',
    'click:Discovery Beta',
    'click:Discovery Gamma',
    'scrollIntoView:Discovery Alpha',
    'scrollIntoView:Discovery Beta',
    'scrollIntoView:Discovery Gamma'
  ]);

  const provider = createSelfExplorationProvider();
  const first = await provider.decide({ observation: initial });
  const second = await provider.decide({ observation: initial });
  const third = await provider.decide({ observation: initial });
  const fourth = await provider.decide({ observation: initial });

  assert.equal(first.action.type, 'click');
  assert.equal(first.metadata.targetLabel, 'Discovery Alpha');
  assert.equal(second.action.type, 'click');
  assert.equal(second.metadata.targetLabel, 'Discovery Beta');
  assert.equal(third.action.type, 'click');
  assert.equal(third.metadata.targetLabel, 'Discovery Gamma');
  assert.equal(fourth.action.type, 'scrollIntoView');
  assert.equal(fourth.metadata.targetLabel, 'Discovery Alpha');

  const afterScroll = observation('obs-scroll', {}, 650);
  assert.notEqual(explorationStateSignature(initial), explorationStateSignature(afterScroll));
  const fifth = await provider.decide({ observation: afterScroll });
  assert.equal(fifth.action.type, 'click');
  assert.equal(fifth.metadata.targetLabel, 'Discovery Alpha');

  const afterBeta = observation('obs-beta', { beta: false }, 650);
  const sixth = await provider.decide({ observation: afterBeta });
  assert.equal(sixth.action.type, 'click');
  assert.equal(sixth.metadata.targetLabel, 'Discovery Alpha');

  const afterAlpha = observation('obs-alpha', { alpha: false, beta: false }, 650);
  const seventh = await provider.decide({ observation: afterAlpha });
  assert.equal(seventh.action.type, 'click');
  assert.equal(seventh.metadata.targetLabel, 'Discovery Gamma');

  const unchangedStep = {
    before: initial,
    after: { ...initial, observationId: 'obs-0b' },
    outcome: { taskSucceeded: false },
    action: first.action
  };
  const scrollStep = {
    before: initial,
    after: afterScroll,
    outcome: { taskSucceeded: false },
    action: fourth.action
  };
  const betaStep = {
    before: afterScroll,
    after: afterBeta,
    outcome: { taskSucceeded: false },
    action: second.action
  };
  const alphaStep = {
    before: afterBeta,
    after: afterAlpha,
    outcome: { taskSucceeded: false },
    action: sixth.action
  };
  const successStep = {
    before: afterAlpha,
    after: observation('obs-pass', { alpha: false, beta: false, gamma: false, pass: true }, 650),
    outcome: { taskSucceeded: true },
    action: seventh.action
  };

  assert.equal(stepChangedSemantically(unchangedStep), false);
  assert.equal(stepChangedSemantically(scrollStep), true);
  assert.equal(stepChangedSemantically(betaStep), true);

  const filtered = progressiveExperienceResult({ steps: [unchangedStep, scrollStep, betaStep, alphaStep, successStep] });
  assert.deepStrictEqual(filtered.steps.map(step => `${step.action.type}:${step.action.targetRef}`), [
    'scrollIntoView:e20',
    'click:e21',
    'click:e20',
    'click:e22'
  ]);

  for (const decision of [first, second, third, fourth, fifth, sixth, seventh]) {
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
