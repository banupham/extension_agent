'use strict';

const fs = require('fs');
const path = require('path');
const { validateAgentAction } = require('../../control-center/manager/strategy/agent_action_contract.js');
const {
  TASK_FEATURE_NAMES,
  tokenList,
  tokens,
  jaccard,
  bestSimilarity,
  taskSemanticFeatures,
  historyActionTypes,
  sameActionHistory,
  scorePrototypes,
  choosePrototype,
  chooseTargetRef
} = require('../../control-center/manager/strategy/offline_baseline_provider.js');
const {
  loadDataset,
  evaluateBaselineReadiness
} = require('./check_strategy_baseline_readiness.js');

const MODEL_VERSION = '0.3.3';

function die(message) {
  throw new Error(message);
}

function observationElements(observation) {
  const direct = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  if (direct.length) return direct;
  return Array.isArray(observation?.page?.interactiveElements) ? observation.page.interactiveElements : [];
}

function targetElementForStep(step) {
  const ref = step?.action?.targetRef;
  if (!ref) return null;
  return observationElements(step?.observation).find(element => element?.ref === ref) || null;
}

function targetLabelForStep(step) {
  const target = targetElementForStep(step);
  return typeof target?.label === 'string' && target.label.trim() ? target.label.trim() : null;
}

function newBucket(type, priorActionTypes = null) {
  return {
    type,
    ...(priorActionTypes == null ? {} : { priorActionTypes: [...priorActionTypes] }),
    examples: 0,
    instructions: new Set(),
    targetLabels: new Set(),
    targetRoles: new Set(),
    targetTags: new Set(),
    editableKnown: 0,
    editableTrue: 0,
    continuityKnown: 0,
    continuitySame: 0,
    taskFeatureTrue: Object.fromEntries(TASK_FEATURE_NAMES.map(name => [name, 0]))
  };
}

function addExample(bucket, instruction, targetElement, taskFeatures, sameAsPreviousTarget = null) {
  bucket.examples += 1;
  if (instruction) bucket.instructions.add(instruction);

  const label = typeof targetElement?.label === 'string' ? targetElement.label.trim() : '';
  const role = typeof targetElement?.role === 'string' ? targetElement.role.trim().toLowerCase() : '';
  const tag = String(targetElement?.tag || targetElement?.tagName || '').trim().toLowerCase();
  if (label) bucket.targetLabels.add(label);
  if (role) bucket.targetRoles.add(role);
  if (tag) bucket.targetTags.add(tag);
  if (typeof targetElement?.editable === 'boolean') {
    bucket.editableKnown += 1;
    if (targetElement.editable) bucket.editableTrue += 1;
  }

  if (typeof sameAsPreviousTarget === 'boolean') {
    bucket.continuityKnown += 1;
    if (sameAsPreviousTarget) bucket.continuitySame += 1;
  }

  for (const name of TASK_FEATURE_NAMES) {
    if (taskFeatures?.[name] === true) bucket.taskFeatureTrue[name] += 1;
  }
}

function ratio(trueCount, knownCount) {
  return knownCount > 0 ? trueCount / knownCount : null;
}

function serializeBucket(item) {
  const taskFeatures = {};
  for (const name of TASK_FEATURE_NAMES) {
    taskFeatures[name] = item.examples > 0 ? item.taskFeatureTrue[name] / item.examples : 0;
  }
  return {
    type: item.type,
    ...(Array.isArray(item.priorActionTypes) ? { priorActionTypes: [...item.priorActionTypes] } : {}),
    examples: item.examples,
    instructions: [...item.instructions].sort(),
    targetLabels: [...item.targetLabels].sort(),
    taskFeatures,
    targetTraits: {
      roles: [...item.targetRoles].sort(),
      tags: [...item.targetTags].sort(),
      editableKnown: item.editableKnown,
      editableRate: ratio(item.editableTrue, item.editableKnown)
    },
    targetContinuity: {
      known: item.continuityKnown,
      sameAsPreviousRate: ratio(item.continuitySame, item.continuityKnown)
    }
  };
}

function fitBaseline(trainRecords) {
  if (!Array.isArray(trainRecords) || !trainRecords.length) die('non-empty train records required');
  const byType = new Map();
  const byHistory = new Map();
  const episodeIds = [];

  for (const record of trainRecords) {
    episodeIds.push(String(record?.episodeId || ''));
    const instruction = String(record?.task?.instruction || '').trim();
    const taskFeatures = taskSemanticFeatures(record?.task || {});
    const priorActionTypes = [];
    let previousTargetRef = null;

    for (const step of record?.steps || []) {
      const action = validateAgentAction(step.action);
      const targetElement = targetElementForStep(step);
      const sameAsPreviousTarget = previousTargetRef && action.targetRef
        ? action.targetRef === previousTargetRef
        : null;

      if (!byType.has(action.type)) byType.set(action.type, newBucket(action.type));
      addExample(byType.get(action.type), instruction, targetElement, taskFeatures, sameAsPreviousTarget);

      const historyKey = `${JSON.stringify(priorActionTypes)}\u0000${action.type}`;
      if (!byHistory.has(historyKey)) byHistory.set(historyKey, newBucket(action.type, priorActionTypes));
      addExample(byHistory.get(historyKey), instruction, targetElement, taskFeatures, sameAsPreviousTarget);

      priorActionTypes.push(action.type);
      previousTargetRef = action.targetRef || null;
    }
  }

  if (!byType.size) die('train records contain no semantic actions');

  return {
    modelVersion: MODEL_VERSION,
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
    trainingEpisodeIds: episodeIds.filter(Boolean).sort(),
    actionPrototypes: [...byType.values()]
      .map(serializeBucket)
      .sort((a, b) => a.type.localeCompare(b.type)),
    historyPrototypes: [...byHistory.values()]
      .map(serializeBucket)
      .sort((a, b) => (
        a.priorActionTypes.length - b.priorActionTypes.length ||
        JSON.stringify(a.priorActionTypes).localeCompare(JSON.stringify(b.priorActionTypes)) ||
        a.type.localeCompare(b.type)
      ))
  };
}

function predictAction(model, task, observation, history = []) {
  const chosen = choosePrototype(model, task, observation, history);
  if (!chosen) die('model has no action prototypes');
  const targetRef = chooseTargetRef(chosen.proto, task, observation, history);
  const action = validateAgentAction({
    contractVersion: '0.1.0',
    type: chosen.proto.type,
    targetRef,
    args: {},
    intent: `offline-baseline:${chosen.proto.type}`,
    expectedOutcome: {}
  });
  return {
    action,
    score: chosen.score,
    evidence: {
      instructionScore: chosen.instructionScore,
      targetLabelScore: chosen.targetLabelScore,
      taskFeatureScore: chosen.featureScore,
      semanticTargetScore: chosen.semanticTargetScore,
      actionSelectionTargetIndependent: chosen.actionSelectionTargetIndependent === true,
      historyMatched: chosen.historyMatched,
      compositionMatched: chosen.compositionMatched === true,
      compositionSequence: chosen.compositionSequence || [],
      priorActionTypes: chosen.priorActionTypes,
      prototypeSource: chosen.prototypeSource
    }
  };
}

function evaluateRecords(model, records) {
  const details = [];
  let total = 0;
  let actionTypeCorrect = 0;
  let targetRefCorrect = 0;
  let exactSemanticCorrect = 0;

  for (const record of records || []) {
    const history = [];
    for (const step of record?.steps || []) {
      total += 1;
      const expected = validateAgentAction(step.action);
      const predicted = predictAction(model, record.task, step.observation, history);
      const typeOk = predicted.action.type === expected.type;
      const targetOk = predicted.action.targetRef === expected.targetRef;
      const exactOk = typeOk && targetOk;
      if (typeOk) actionTypeCorrect += 1;
      if (targetOk) targetRefCorrect += 1;
      if (exactOk) exactSemanticCorrect += 1;
      details.push({
        episodeId: record.episodeId,
        stepIndex: step.stepIndex,
        priorActionTypes: historyActionTypes(history),
        expectedType: expected.type,
        predictedType: predicted.action.type,
        expectedTargetRef: expected.targetRef,
        predictedTargetRef: predicted.action.targetRef,
        score: predicted.score,
        historyMatched: predicted.evidence.historyMatched,
        compositionMatched: predicted.evidence.compositionMatched,
        prototypeSource: predicted.evidence.prototypeSource,
        actionTypeCorrect: typeOk,
        targetRefCorrect: targetOk,
        exactSemanticCorrect: exactOk
      });
      history.push({
        stepIndex: history.length + 1,
        actionType: predicted.action.type,
        targetRef: predicted.action.targetRef,
        action: predicted.action
      });
    }
  }

  const ratioValue = value => total ? value / total : 0;
  return {
    total,
    actionTypeCorrect,
    targetRefCorrect,
    exactSemanticCorrect,
    actionTypeAccuracy: ratioValue(actionTypeCorrect),
    targetRefAccuracy: ratioValue(targetRefCorrect),
    exactSemanticAccuracy: ratioValue(exactSemanticCorrect),
    details
  };
}

function evaluateHeldOut(model, validation, test) {
  const validationResult = evaluateRecords(model, validation);
  const testResult = evaluateRecords(model, test);
  const pass = (
    validationResult.total > 0 &&
    testResult.total > 0 &&
    validationResult.actionTypeAccuracy === 1 &&
    testResult.actionTypeAccuracy === 1 &&
    validationResult.exactSemanticAccuracy === 1 &&
    testResult.exactSemanticAccuracy === 1
  );
  return {
    result: pass ? 'PASS' : 'FAIL',
    pass,
    fitPolicy: {
      trainOnly: true,
      validationUsedForFit: false,
      testUsedForFit: false,
      evaluationHistoryUsesModelPredictions: true
    },
    validation: validationResult,
    test: testResult
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const out = { datasetDir: null, outputDir: null };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--output') out.outputDir = argv[++i];
    else if (!out.datasetDir) out.datasetDir = value;
    else die(`unexpected argument: ${value}`);
  }
  if (!out.datasetDir) {
    die('Usage: node training-collector/tools/fit_strategy_offline_baseline.js <dataset-dir> [--output dir]');
  }
  return out;
}

function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    const datasetDir = path.resolve(args.datasetDir);
    const splits = loadDataset(datasetDir);
    const readiness = evaluateBaselineReadiness(splits);
    if (!readiness.ready) die(`baseline_readiness_failed: ${readiness.errors.join(', ')}`);

    const model = fitBaseline(splits.train);
    const evaluation = evaluateHeldOut(model, splits.validation, splits.test);
    const outputDir = path.resolve(args.outputDir || path.join(datasetDir, 'baseline-v033'));
    fs.mkdirSync(outputDir, { recursive: true });
    const modelFile = path.join(outputDir, 'model.json');
    const evaluationFile = path.join(outputDir, 'evaluation.json');
    fs.writeFileSync(modelFile, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
    fs.writeFileSync(evaluationFile, `${JSON.stringify(evaluation, null, 2)}\n`, 'utf8');

    console.log(JSON.stringify({
      ok: evaluation.pass,
      result: evaluation.result,
      gate: 'offline-strategy-baseline-fit-and-heldout-eval',
      modelVersion: model.modelVersion,
      datasetDir,
      outputDir,
      trainRecords: splits.train.length,
      validationRecords: splits.validation.length,
      testRecords: splits.test.length,
      actionPrototypeCount: model.actionPrototypes.length,
      historyPrototypeCount: model.historyPrototypes.length,
      validation: {
        total: evaluation.validation.total,
        actionTypeAccuracy: evaluation.validation.actionTypeAccuracy,
        exactSemanticAccuracy: evaluation.validation.exactSemanticAccuracy
      },
      test: {
        total: evaluation.test.total,
        actionTypeAccuracy: evaluation.test.actionTypeAccuracy,
        exactSemanticAccuracy: evaluation.test.exactSemanticAccuracy
      },
      files: { model: modelFile, evaluation: evaluationFile }
    }, null, 2));
    if (!evaluation.pass) process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  MODEL_VERSION,
  tokenList,
  tokens,
  jaccard,
  targetElementForStep,
  targetLabelForStep,
  historyActionTypes,
  sameActionHistory,
  newBucket,
  addExample,
  serializeBucket,
  fitBaseline,
  bestSimilarity,
  scorePrototypes,
  choosePrototype,
  chooseTargetRef,
  predictAction,
  evaluateRecords,
  evaluateHeldOut,
  parseArgs,
  main
};
