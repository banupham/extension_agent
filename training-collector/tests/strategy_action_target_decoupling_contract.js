'use strict';

const assert = require('assert');
const {
  fitBaseline
} = require('../tools/fit_strategy_offline_baseline.js');
const {
  sameActionHistory,
  historyActionTypes,
  scorePrototypes,
  choosePrototype,
  chooseTargetRef,
  createOfflineBaselineProvider
} = require('../../control-center/manager/strategy/offline_baseline_provider.js');

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

function clickObservation() {
  return {
    observationId: 'train-click-observation',
    interactiveElements: [
      { ref: 'workspace-button', label: 'Workspace', role: 'button', tag: 'button', editable: false, visible: true, enabled: true }
    ],
    privacy: { redacted: true }
  };
}

function formObservation(ref = 'message-field', label = 'Message Field') {
  return {
    observationId: `form-${ref}`,
    interactiveElements: [
      { ref, label, role: 'textbox', tag: 'input', editable: true, visible: true, enabled: true },
      { ref: `${ref}-button`, label: 'Primary Action', role: 'button', tag: 'button', editable: false, visible: true, enabled: true }
    ],
    privacy: { redacted: true }
  };
}

const train = [
  {
    episodeId: 'train-click-family',
    task: { instruction: 'Open Workspace' },
    steps: [
      { stepIndex: 0, observation: clickObservation(), action: action('click', 'workspace-button') }
    ]
  },
  {
    episodeId: 'train-form-family',
    task: { instruction: 'Type sample into Message Field then submit' },
    steps: [
      { stepIndex: 0, observation: formObservation(), action: action('typeText', 'message-field') },
      { stepIndex: 1, observation: formObservation(), action: action('submit', 'message-field') }
    ]
  }
];

const model = fitBaseline(train);
const task = {
  instruction: 'Open the current panel, type a value into Query Entry, then submit'
};

const stableObservation = {
  observationId: 'stable-target-landscape',
  interactiveElements: [
    { ref: 'query-entry', label: 'Query Entry', role: 'textbox', tag: 'input', editable: true, visible: true, enabled: true },
    { ref: 'ordinary-button', label: 'Workspace', role: 'button', tag: 'button', editable: false, visible: true, enabled: true }
  ],
  privacy: { redacted: true }
};

const adversarialObservation = {
  observationId: 'adversarial-target-landscape',
  interactiveElements: [
    { ref: 'query-entry', label: 'Query Entry', role: 'textbox', tag: 'input', editable: true, visible: true, enabled: true },
    {
      ref: 'semantic-click-distractor',
      label: task.instruction,
      role: 'button',
      tag: 'button',
      editable: false,
      visible: true,
      enabled: true
    }
  ],
  privacy: { redacted: true }
};

function initialHistoryCandidates(observation) {
  const prior = [];
  const candidates = model.historyPrototypes.filter(proto => sameActionHistory(proto.priorActionTypes, prior));
  return scorePrototypes(candidates, task, observation);
}

const stableScores = initialHistoryCandidates(stableObservation);
const adversarialScores = initialHistoryCandidates(adversarialObservation);
const stableChoice = choosePrototype(model, task, stableObservation, []);
const adversarialChoice = choosePrototype(model, task, adversarialObservation, []);

assert.strictEqual(stableChoice.proto.type, 'typeText');
assert.strictEqual(adversarialChoice.proto.type, 'typeText');
assert.strictEqual(stableChoice.actionSelectionTargetIndependent, true);
assert.strictEqual(adversarialChoice.actionSelectionTargetIndependent, true);

const stableType = stableScores.find(item => item.proto.type === 'typeText');
const stableClick = stableScores.find(item => item.proto.type === 'click');
const adversarialType = adversarialScores.find(item => item.proto.type === 'typeText');
const adversarialClick = adversarialScores.find(item => item.proto.type === 'click');

assert.ok(stableType && stableClick && adversarialType && adversarialClick);
assert.strictEqual(stableType.score, adversarialType.score);
assert.strictEqual(stableClick.score, adversarialClick.score);
assert.ok(adversarialClick.semanticTargetScore > adversarialType.semanticTargetScore);
assert.ok(adversarialType.featureScore > adversarialClick.featureScore);
assert.ok(adversarialType.score > adversarialClick.score);

// Once WHAT=click has been selected, the current task must dominate target grounding.
// A familiar TRAIN target label is only a weak prior and may not override a different
// actionable target named by the current task. This is a generic target-grounding rule,
// not a site- or ref-specific exception.
const clickProto = model.actionPrototypes.find(proto => proto.type === 'click');
assert.ok(clickProto);
const currentTaskTargetObservation = {
  observationId: 'current-task-target-dominance',
  interactiveElements: [
    { ref: 'familiar-train-target', label: 'Workspace', role: 'button', tag: 'button', editable: false, visible: true, enabled: true },
    { ref: 'current-task-target', label: 'Reports', role: 'link', tag: 'a', editable: false, visible: true, enabled: true }
  ],
  privacy: { redacted: true }
};
assert.strictEqual(
  chooseTargetRef(clickProto, { instruction: 'Open Reports' }, currentTaskTargetObservation, []),
  'current-task-target'
);

// If the current task names a target only partially, semantic overlap still beats an
// unrelated high-affordance control.
const partialTaskTargetObservation = {
  observationId: 'partial-current-task-target-dominance',
  interactiveElements: [
    { ref: 'unrelated-control', label: 'Toggle navigation', role: 'button', tag: 'button', editable: false, visible: true, enabled: true },
    { ref: 'semantic-link', label: 'Report elements', role: 'link', tag: 'a', editable: false, visible: true, enabled: true }
  ],
  privacy: { redacted: true }
};
assert.strictEqual(
  chooseTargetRef(clickProto, { instruction: 'Open the Report elements section' }, partialTaskTargetObservation, []),
  'semantic-link'
);

// If WHAT=typeText is selected but no editable target exists, do not silently fall through
// to a different action. Grounding failure must block and request a fresh observation.
(async () => {
  const provider = createOfflineBaselineProvider({ model });
  const blocked = await provider.decide({
    task,
    observation: {
      observationId: 'missing-editable-target',
      interactiveElements: [
        {
          ref: 'only-button',
          label: task.instruction,
          role: 'button',
          tag: 'button',
          editable: false,
          visible: true,
          enabled: true
        }
      ],
      privacy: { redacted: true }
    },
    history: []
  });

  assert.strictEqual(blocked.status, 'blocked');
  assert.strictEqual(blocked.reasonCode, 'offline_baseline_target_not_found');
  assert.strictEqual(blocked.recovery.suggested, 'reobserve');
  assert.strictEqual(blocked.metadata.prototypeType, 'typeText');
  assert.strictEqual(blocked.metadata.actionSelectionTargetIndependent, true);

  console.log('Strategy action/target decoupling contract: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
