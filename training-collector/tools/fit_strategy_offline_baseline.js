'use strict';

const fs = require('fs');
const path = require('path');
const { validateAgentAction } = require('../../control-center/manager/strategy/agent_action_contract.js');
const {
  loadDataset,
  evaluateBaselineReadiness
} = require('./check_strategy_baseline_readiness.js');

const MODEL_VERSION = '0.2.0';

function die(message) {
  throw new Error(message);
}

function tokens(value) {
  return new Set((String(value || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter(Boolean));
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  const union = new Set([...a, ...b]);
  if (!union.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / union.size;
}

function targetLabelForStep(step) {
  const ref = step?.action?.targetRef;
  if (!ref) return null;
  const elements = Array.isArray(step?.observation?.interactiveElements)
    ? step.observation.interactiveElements
    : [];
  const hit = elements.find(el => el?.ref === ref);
  return typeof hit?.label === 'string' && hit.label.trim() ? hit.label.trim() : null;
}

function historyActionTypes(history) {
  return (Array.isArray(history) ? history : [])
    .map(item => String(item?.actionType || item?.action?.type || '').trim())
    .filter(Boolean);
}

function sameActionHistory(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function newBucket(type, priorActionTypes = null) {
  return {
    type,
    ...(priorActionTypes == null ? {} : { priorActionTypes: [...priorActionTypes] }),
    examples: 0,
    instructions: new Set(),
    targetLabels: new Set()
  };
}

function addExample(bucket, instruction, targetLabel) {
  bucket.examples += 1;
  if (instruction) bucket.instructions.add(instruction);
  if (targetLabel) bucket.targetLabels.add(targetLabel);
}

function serializeBucket(item) {
  return {
    type: item.type,
    ...(Array.isArray(item.priorActionTypes) ? { priorActionTypes: [...item.priorActionTypes] } : {}),
    examples: item.examples,
    instructions: [...item.instructions].sort(),
    targetLabels: [...item.targetLabels].sort()
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
    const priorActionTypes = [];

    for (const step of record?.steps || []) {
      const action = validateAgentAction(step.action);
      const targetLabel = targetLabelForStep(step);

      if (!byType.has(action.type)) byType.set(action.type, newBucket(action.type));
      addExample(byType.get(action.type), instruction, targetLabel);

      const historyKey = `${JSON.stringify(priorActionTypes)}\u0000${action.type}`;
      if (!byHistory.has(historyKey)) byHistory.set(historyKey, newBucket(action.type, priorActionTypes));
      addExample(byHistory.get(historyKey), instruction, targetLabel);

      priorActionTypes.push(action.type);
    }
  }

  if (!byType.size) die('train records contain no semantic actions');

  return {
    modelVersion: MODEL_VERSION,
    kind: 'offline-semantic-prototype-baseline',
    fitSource: 'train-only',
    heldOutUsedForFit: false,
    historyAware: true,
    historyFeature: 'prior-semantic-action-types',
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

function bestSimilarity(needleTokens, phrases) {
  let best = 0;
  for (const phrase of phrases || []) best = Math.max(best, jaccard(needleTokens, tokens(phrase)));
  return best;
}

function scorePrototypes(prototypes, task) {
  const taskTokens = tokens(task?.instruction);
  return (prototypes || []).map(proto => {
    const instructionScore = bestSimilarity(taskTokens, proto.instructions);
    const targetLabelScore = bestSimilarity(taskTokens, proto.targetLabels);
    const score = (0.35 * instructionScore) + (0.65 * targetLabelScore);
    return { proto, score, instructionScore, targetLabelScore };
  }).sort((a, b) => (
    b.score - a.score ||
    b.targetLabelScore - a.targetLabelScore ||
    b.instructionScore - a.instructionScore ||
    a.proto.type.localeCompare(b.proto.type)
  ));
}

function choosePrototype(model, task, history = []) {
  const priorActionTypes = historyActionTypes(history);
  const historyMatches = (model?.historyPrototypes || []).filter(proto =>
    sameActionHistory(proto?.priorActionTypes, priorActionTypes)
  );
  const useHistory = historyMatches.length > 0;
  const candidates = useHistory ? historyMatches : (model?.actionPrototypes || []);
  const scored = scorePrototypes(candidates, task);
  if (!scored.length) die('model has no action prototypes');
  return {
    ...scored[0],
    historyMatched: useHistory,
    priorActionTypes,
    prototypeSource: useHistory ? 'historyPrototypes' : 'actionPrototypes'
  };
}

function chooseTargetRef(proto, task, observation) {
  const elements = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  if (!elements.length || !(proto?.targetLabels || []).length) return null;
  const taskTokens = tokens(task?.instruction);
  const candidates = elements
    .filter(el => typeof el?.ref === 'string' && el.ref.trim() && typeof el?.label === 'string' && el.label.trim())
    .map(el => {
      const labelTokens = tokens(el.label);
      const prototypeLabelScore = Math.max(...proto.targetLabels.map(label => jaccard(labelTokens, tokens(label))));
      const taskLabelScore = jaccard(taskTokens, labelTokens);
      return {
        ref: el.ref.trim(),
        label: el.label.trim(),
        score: (0.75 * prototypeLabelScore) + (0.25 * taskLabelScore),
        prototypeLabelScore,
        taskLabelScore
      };
    })
    .sort((a, b) => (
      b.score - a.score ||
      b.prototypeLabelScore - a.prototypeLabelScore ||
      b.taskLabelScore - a.taskLabelScore ||
      a.ref.localeCompare(b.ref)
    ));
  return candidates[0]?.ref || null;
}

function predictAction(model, task, observation, history = []) {
  const chosen = choosePrototype(model, task, history);
  const targetRef = chooseTargetRef(chosen.proto, task, observation);
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
      historyMatched: chosen.historyMatched,
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
        prototypeSource: predicted.evidence.prototypeSource,
        actionTypeCorrect: typeOk,
        targetRefCorrect: targetOk,
        exactSemanticCorrect: exactOk
      });
      history.push({ stepIndex: history.length + 1, actionType: expected.type });
    }
  }

  const ratio = value => total ? value / total : 0;
  return {
    total,
    actionTypeCorrect,
    targetRefCorrect,
    exactSemanticCorrect,
    actionTypeAccuracy: ratio(actionTypeCorrect),
    targetRefAccuracy: ratio(targetRefCorrect),
    exactSemanticAccuracy: ratio(exactSemanticCorrect),
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
      testUsedForFit: false
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
    const outputDir = path.resolve(args.outputDir || path.join(datasetDir, 'baseline-v01'));
    fs.mkdirSync(outputDir, { recursive: true });
    const modelFile = path.join(outputDir, 'model.json');
    const evaluationFile = path.join(outputDir, 'evaluation.json');
    fs.writeFileSync(modelFile, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
    fs.writeFileSync(evaluationFile, `${JSON.stringify(evaluation, null, 2)}\n`, 'utf8');

    console.log(JSON.stringify({
      ok: evaluation.pass,
      result: evaluation.result,
      gate: 'offline-strategy-baseline-fit-and-heldout-eval',
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
  tokens,
  jaccard,
  targetLabelForStep,
  historyActionTypes,
  sameActionHistory,
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
