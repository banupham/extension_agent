'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createStrategy,
  validateOfflineStrategyModelArtifact,
  loadOfflineStrategyModelFile,
  resolveOfflineStrategyModel
} = require('../../control-center/manager/strategy');

function prototype(type = 'click', priorActionTypes = null) {
  return {
    type,
    ...(priorActionTypes == null ? {} : { priorActionTypes: [...priorActionTypes] }),
    examples: 1,
    instructions: ['Click Approve Parcel'],
    targetLabels: ['Approve Parcel'],
    taskFeatures: {
      textEntryIntent: 0,
      submitIntent: 0,
      enterIntent: 0,
      clickIntent: 1
    },
    targetTraits: {
      roles: ['button'],
      tags: ['button'],
      editableKnown: 1,
      editableRate: 0
    },
    targetContinuity: { known: 0, sameAsPreviousRate: null }
  };
}

function validModel() {
  return {
    modelVersion: '0.3.3',
    kind: 'offline-semantic-prototype-baseline',
    fitSource: 'train-only',
    heldOutUsedForFit: false,
    historyAware: true,
    historyFeature: 'prior-semantic-action-types-and-local-target-continuity',
    actionSelectionPolicy: 'task-history-decoupled-from-current-target-ranking',
    actionSelectionUsesCurrentTargetRanking: false,
    semanticTargetFeatures: ['label', 'role', 'tag', 'editable'],
    targetGroundingPolicy: 'current-task-dominant-with-action-affordance',
    localTargetRefsPersisted: false,
    trainingEpisodeIds: ['train-episode-safe-id'],
    actionPrototypes: [prototype('click')],
    historyPrototypes: [prototype('click', [])]
  };
}

function observation() {
  return {
    observationId: 'obs-runtime-loader',
    url: 'http://runtime-loader.test/',
    title: 'Runtime Loader',
    viewport: { width: 900, height: 700 },
    scroll: { x: 0, y: 0 },
    interactiveElements: [
      { ref: 'approve', tag: 'button', role: 'button', label: 'Approve Parcel', editable: false, enabled: true, visible: true }
    ],
    pageSignals: {},
    privacy: { redacted: true }
  };
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-model-loader-'));
  try {
    const file = path.join(temp, 'model.json');
    const model = validModel();
    fs.writeFileSync(file, `${JSON.stringify(model, null, 2)}\n`, 'utf8');

    assert.strictEqual(validateOfflineStrategyModelArtifact(model), model);
    assert.deepStrictEqual(loadOfflineStrategyModelFile(file), model);

    const resolved = resolveOfflineStrategyModel({ modelFile: file });
    assert.equal(resolved.metadata.loaded, true);
    assert.equal(resolved.metadata.source, 'file');
    assert.equal(resolved.metadata.modelVersion, '0.3.3');
    assert.equal(resolved.metadata.heldOutUsedForFit, false);
    assert.equal(resolved.metadata.localTargetRefsPersisted, false);
    assert.equal(Object.prototype.hasOwnProperty.call(resolved.metadata, 'trainingEpisodeIds'), false);

    const strategy = createStrategy({ modelFile: file, minimumConfidence: 0 });
    assert.equal(strategy.provider.name, 'offline-semantic-prototype-baseline');
    assert.equal(strategy.provider.version, '0.3.3');
    assert.equal(strategy.model.loaded, true);
    assert.equal(strategy.model.source, 'file');

    const decision = await strategy.decide({
      task: {
        taskId: 'runtime-loader-task',
        type: 'controlled',
        instruction: 'Click Approve Parcel',
        args: {},
        successCriteria: [],
        constraints: {},
        metadata: {}
      },
      observation: observation(),
      history: []
    });
    assert.equal(decision.status, 'act');
    assert.equal(decision.action.type, 'click');
    assert.equal(decision.action.targetRef, 'approve');

    const selectorLeak = validModel();
    selectorLeak.actionPrototypes[0].selector = '#approve';
    assert.throws(
      () => validateOfflineStrategyModelArtifact(selectorLeak),
      /offline_strategy_model_forbidden_keys:.*selector/
    );

    const targetRefLeak = validModel();
    targetRefLeak.historyPrototypes[0].targetRef = 'e1';
    assert.throws(
      () => validateOfflineStrategyModelArtifact(targetRefLeak),
      /offline_strategy_model_forbidden_keys:.*targetRef/
    );

    const heldoutLeak = validModel();
    heldoutLeak.heldOutUsedForFit = true;
    assert.throws(
      () => validateOfflineStrategyModelArtifact(heldoutLeak),
      /offline_strategy_model_heldout_fit_boundary_failed/
    );

    const localRefLeak = validModel();
    localRefLeak.localTargetRefsPersisted = true;
    assert.throws(
      () => validateOfflineStrategyModelArtifact(localRefLeak),
      /offline_strategy_model_local_target_ref_boundary_failed/
    );

    assert.throws(
      () => resolveOfflineStrategyModel({ model, modelFile: file }),
      /offline_strategy_model_source_ambiguous/
    );
    assert.throws(
      () => createStrategy({ provider: 'baseline', modelFile: file }),
      /strategy_provider_and_model_source_ambiguous/
    );
    assert.throws(
      () => loadOfflineStrategyModelFile(path.join(temp, 'missing.json')),
      /offline_strategy_model_file_missing/
    );

    console.log('Strategy offline model loader contract: PASS');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Strategy offline model loader contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { prototype, validModel, observation, main };
