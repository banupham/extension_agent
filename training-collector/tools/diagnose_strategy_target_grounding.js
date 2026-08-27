'use strict';

const path = require('path');
const { validateAgentAction } = require('../../control-center/manager/strategy/agent_action_contract.js');
const {
  normalizedElementTag,
  normalizedElementRole,
  actionTargetEligible,
  elementTargetCompatibility,
  choosePrototype,
  chooseTargetRef,
  tokens
} = require('../../control-center/manager/strategy/offline_baseline_provider.js');
const {
  loadDataset,
  evaluateBaselineReadiness
} = require('./check_strategy_baseline_readiness.js');
const {
  fitBaseline
} = require('./fit_strategy_offline_baseline.js');

const DIAGNOSTIC_VERSION = '0.1.0';

function boolOrNull(value) {
  return typeof value === 'boolean' ? value : null;
}

function safeCandidateSummary({ element, expectedRef, predictedRef, observation, task, proto }) {
  const ref = typeof element?.ref === 'string' ? element.ref.trim() : '';
  const compatibility = elementTargetCompatibility(proto, task, element);
  const label = typeof element?.label === 'string' ? element.label.trim() : '';
  return {
    ref: ref || null,
    isExpectedTarget: !!ref && ref === expectedRef,
    isPredictedTarget: !!ref && ref === predictedRef,
    isFocusedTarget: !!ref && ref === observation?.focusedElementRef,
    tag: normalizedElementTag(element) || null,
    role: normalizedElementRole(element) || null,
    editable: boolOrNull(element?.editable),
    enabled: boolOrNull(element?.enabled),
    visible: boolOrNull(element?.visible),
    rendered: boolOrNull(element?.rendered),
    inViewport: boolOrNull(element?.inViewport),
    interactable: boolOrNull(element?.interactable),
    affordanceEligible: actionTargetEligible(proto, element),
    labelPresent: !!label,
    labelTokenCount: label ? tokens(label).size : 0,
    taskLabelSimilarity: Number(compatibility.taskLabelScore || 0),
    prototypeLabelSimilarity: Number(compatibility.prototypeLabelScore || 0),
    traitScore: Number(compatibility.traitScore || 0),
    compatibilityScore: Number(compatibility.score || 0)
  };
}

function diagnoseStep(model, record, step, history) {
  const expected = validateAgentAction(step.action);
  const chosen = choosePrototype(model, record.task, step.observation, history);
  if (!chosen) throw new Error(`no_strategy_prototype:${record.episodeId}:${step.stepIndex}`);
  const predictedRef = chooseTargetRef(chosen.proto, record.task, step.observation, history);
  const elements = Array.isArray(step?.observation?.interactiveElements)
    ? step.observation.interactiveElements
    : [];
  const candidates = elements
    .filter(element => typeof element?.ref === 'string' && element.ref.trim())
    .map(element => safeCandidateSummary({
      element,
      expectedRef: expected.targetRef,
      predictedRef,
      observation: step.observation,
      task: record.task,
      proto: chosen.proto
    }))
    .filter(item => item.isExpectedTarget || item.isPredictedTarget || item.affordanceEligible)
    .sort((a, b) => (
      Number(b.isExpectedTarget) - Number(a.isExpectedTarget) ||
      Number(b.isPredictedTarget) - Number(a.isPredictedTarget) ||
      b.compatibilityScore - a.compatibilityScore ||
      String(a.ref || '').localeCompare(String(b.ref || ''))
    ))
    .slice(0, 12);

  return {
    episodeId: record.episodeId,
    splitGroup: record.splitGroup || null,
    stepIndex: step.stepIndex,
    expectedType: expected.type,
    predictedType: chosen.proto.type,
    expectedTargetRef: expected.targetRef,
    predictedTargetRef: predictedRef,
    focusedElementRefPresent: typeof step?.observation?.focusedElementRef === 'string' && !!step.observation.focusedElementRef,
    focusedIsExpectedTarget: step?.observation?.focusedElementRef === expected.targetRef,
    focusedIsPredictedTarget: step?.observation?.focusedElementRef === predictedRef,
    historyMatched: chosen.historyMatched === true,
    prototypeSource: chosen.prototypeSource,
    candidateCount: elements.length,
    candidates
  };
}

function diagnoseRecords(model, records, actionType = 'typeText') {
  const details = [];
  for (const record of records || []) {
    const history = [];
    for (const step of record?.steps || []) {
      const expected = validateAgentAction(step.action);
      const detail = diagnoseStep(model, record, step, history);
      if (!actionType || expected.type === actionType) details.push(detail);
      history.push({
        stepIndex: history.length + 1,
        actionType: detail.predictedType,
        targetRef: detail.predictedTargetRef,
        action: {
          contractVersion: '0.1.0',
          type: detail.predictedType,
          targetRef: detail.predictedTargetRef,
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
  const out = { datasetDir: null, actionType: 'typeText' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--action') out.actionType = String(argv[++i] || '').trim() || null;
    else if (token === '--all-actions') out.actionType = null;
    else if (!out.datasetDir) out.datasetDir = token;
    else throw new Error(`unexpected_argument:${token}`);
  }
  if (!out.datasetDir) {
    throw new Error('Usage: node training-collector/tools/diagnose_strategy_target_grounding.js <dataset-dir> [--action typeText|--all-actions]');
  }
  return out;
}

function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    const datasetDir = path.resolve(args.datasetDir);
    const splits = loadDataset(datasetDir);
    const readiness = evaluateBaselineReadiness(splits);
    if (!readiness.ready) throw new Error(`baseline_readiness_failed:${readiness.errors.join(',')}`);
    const model = fitBaseline(splits.train);
    const validation = diagnoseRecords(model, splits.validation, args.actionType);
    const test = diagnoseRecords(model, splits.test, args.actionType);
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      diagnosticVersion: DIAGNOSTIC_VERSION,
      modelVersion: model.modelVersion,
      datasetDir,
      fitPolicy: {
        trainOnly: true,
        validationUsedForFit: false,
        testUsedForFit: false
      },
      privacy: {
        rawLabelsIncluded: false,
        typedValuesIncluded: false,
        selectorsIncluded: false,
        coordinatesIncluded: false,
        tabIdsIncluded: false,
        rawCdpIncluded: false
      },
      actionFilter: args.actionType,
      validation,
      test
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  DIAGNOSTIC_VERSION,
  boolOrNull,
  safeCandidateSummary,
  diagnoseStep,
  diagnoseRecords,
  parseArgs,
  main
};
