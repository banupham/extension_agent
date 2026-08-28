'use strict';

const path = require('path');
const { validateAgentAction } = require('../../control-center/manager/strategy/agent_action_contract.js');
const {
  taskSemanticFeatures,
  historyActionTypes,
  sameActionHistory,
  scorePrototypes,
  choosePrototype,
  chooseTargetRef,
  actionTargetEligible
} = require('../../control-center/manager/strategy/offline_baseline_provider.js');
const {
  loadDataset,
  evaluateBaselineReadiness
} = require('./check_strategy_baseline_readiness.js');
const {
  fitBaseline
} = require('./fit_strategy_offline_baseline.js');

const DIAGNOSTIC_VERSION = '0.1.0';

function observationElements(observation) {
  const direct = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  if (direct.length) return direct;
  return Array.isArray(observation?.page?.interactiveElements) ? observation.page.interactiveElements : [];
}

function eligibleTargetCount(proto, observation) {
  return observationElements(observation).filter(element =>
    typeof element?.ref === 'string' && element.ref.trim() && actionTargetEligible(proto, element)
  ).length;
}

function safeActionCandidateSummary(scored, observation, selectedType = null) {
  const proto = scored?.proto || {};
  return {
    type: String(proto.type || '') || null,
    selected: !!selectedType && proto.type === selectedType,
    score: Number(scored?.score || 0),
    instructionSimilarity: Number(scored?.instructionScore || 0),
    learnedTargetLabelSimilarity: Number(scored?.targetLabelScore || 0),
    taskFeatureScore: Number(scored?.featureScore || 0),
    semanticTargetScore: Number(scored?.semanticTargetScore || 0),
    eligibleTargetCount: eligibleTargetCount(proto, observation),
    learnedTaskFeatures: {
      textEntryIntent: Number(proto?.taskFeatures?.textEntryIntent || 0),
      submitIntent: Number(proto?.taskFeatures?.submitIntent || 0),
      enterIntent: Number(proto?.taskFeatures?.enterIntent || 0),
      clickIntent: Number(proto?.taskFeatures?.clickIntent || 0)
    }
  };
}

function diagnoseStep(model, record, step, history) {
  const expected = validateAgentAction(step.action);
  const priorActionTypes = historyActionTypes(history);
  const chosen = choosePrototype(model, record.task, step.observation, history);
  if (!chosen) throw new Error(`no_strategy_prototype:${record.episodeId}:${step.stepIndex}`);

  const historyMatches = (model.historyPrototypes || []).filter(proto =>
    sameActionHistory(proto.priorActionTypes, priorActionTypes)
  );
  const historyScored = scorePrototypes(historyMatches, record.task, step.observation);
  const actionScored = scorePrototypes(model.actionPrototypes || [], record.task, step.observation);
  const predictedTargetRef = chooseTargetRef(chosen.proto, record.task, step.observation, history);

  return {
    episodeId: record.episodeId,
    splitGroup: record.splitGroup || null,
    stepIndex: step.stepIndex,
    expectedType: expected.type,
    predictedType: chosen.proto.type,
    actionTypeCorrect: chosen.proto.type === expected.type,
    priorActionTypes,
    currentTaskFeatures: taskSemanticFeatures(record.task || {}),
    historyMatched: chosen.historyMatched === true,
    compositionMatched: chosen.compositionMatched === true,
    compositionSequence: Array.isArray(chosen.compositionSequence) ? chosen.compositionSequence : [],
    prototypeSource: chosen.prototypeSource,
    historyCandidates: historyScored.map(item => safeActionCandidateSummary(item, step.observation, chosen.proto.type)),
    actionCandidates: actionScored.map(item => safeActionCandidateSummary(item, step.observation, chosen.proto.type)),
    predictedTargetPresent: typeof predictedTargetRef === 'string' && !!predictedTargetRef
  };
}

function diagnoseRecords(model, records) {
  const details = [];
  for (const record of records || []) {
    const history = [];
    for (const step of record?.steps || []) {
      const detail = diagnoseStep(model, record, step, history);
      details.push(detail);
      const chosen = choosePrototype(model, record.task, step.observation, history);
      const predictedTargetRef = chosen
        ? chooseTargetRef(chosen.proto, record.task, step.observation, history)
        : null;
      history.push({
        stepIndex: history.length + 1,
        actionType: detail.predictedType,
        targetRef: predictedTargetRef,
        action: {
          contractVersion: '0.1.0',
          type: detail.predictedType,
          targetRef: predictedTargetRef,
          args: {},
          intent: null,
          expectedOutcome: {}
        }
      });
    }
  }
  return details;
}

function parseArgs(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || !argv[0]) {
    throw new Error('Usage: node training-collector/tools/diagnose_strategy_action_selection.js <dataset-dir>');
  }
  return { datasetDir: argv[0] };
}

function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    const datasetDir = path.resolve(args.datasetDir);
    const splits = loadDataset(datasetDir);
    const readiness = evaluateBaselineReadiness(splits);
    if (!readiness.ready) throw new Error(`baseline_readiness_failed:${readiness.errors.join(',')}`);
    const model = fitBaseline(splits.train);

    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      diagnosticVersion: DIAGNOSTIC_VERSION,
      modelVersion: model.modelVersion,
      datasetDir,
      fitPolicy: {
        trainOnly: true,
        validationUsedForFit: false,
        testUsedForFit: false,
        evaluationHistoryUsesModelPredictions: true
      },
      privacy: {
        rawInstructionsIncluded: false,
        rawLabelsIncluded: false,
        typedValuesIncluded: false,
        selectorsIncluded: false,
        coordinatesIncluded: false,
        tabIdsIncluded: false,
        rawCdpIncluded: false
      },
      validation: diagnoseRecords(model, splits.validation),
      test: diagnoseRecords(model, splits.test)
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  DIAGNOSTIC_VERSION,
  observationElements,
  eligibleTargetCount,
  safeActionCandidateSummary,
  diagnoseStep,
  diagnoseRecords,
  parseArgs,
  main
};
