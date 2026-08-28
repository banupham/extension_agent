'use strict';

const fs = require('fs');
const path = require('path');
const REVIEW_CONTRACT = require('../../control-center/HUMAN_STRATEGY_REVIEW_CONTRACT.json');

function loadReviewExport(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Task Episode review JSON object required');
  if (value.reviewExportVersion !== '0.1.0') throw new Error(`unsupported reviewExportVersion: ${value.reviewExportVersion || '<missing>'}`);
  if (value.strategyReady !== true) throw new Error('Task Episode review must be strategyReady=true');
  return value;
}

function stateSummary(observation = {}) {
  return {
    url: typeof observation.url === 'string' ? observation.url : '',
    focusedElementRef: typeof observation.focusedElement?.ref === 'string' ? observation.focusedElement.ref : null,
    interactiveElementCount: Array.isArray(observation.interactiveElements) ? observation.interactiveElements.length : 0
  };
}

function evidenceForTransition(transition = {}) {
  const raw = transition.rawAction && typeof transition.rawAction === 'object' ? transition.rawAction : {};
  const before = transition.strategyObservationBefore && typeof transition.strategyObservationBefore === 'object' ? transition.strategyObservationBefore : {};
  const after = transition.strategyObservationAfter && typeof transition.strategyObservationAfter === 'object' ? transition.strategyObservationAfter : {};
  const targetRef = typeof raw.targetRef === 'string' ? raw.targetRef : null;
  const target = targetRef && Array.isArray(before.interactiveElements)
    ? before.interactiveElements.find(element => element?.ref === targetRef) || null
    : null;
  return {
    rawActionKind: typeof raw.kind === 'string' ? raw.kind : null,
    rawTargetRef: targetRef,
    rawOperation: typeof raw.operation === 'string' ? raw.operation : null,
    observedActionSucceeded: transition.outcome?.actionSucceeded === true,
    before: stateSummary(before),
    after: stateSummary(after),
    targetSummary: target ? {
      ref: target.ref || null,
      role: target.role || null,
      tag: target.tag || null,
      label: target.label || '',
      editable: target.editable === true,
      enabled: target.enabled !== false,
      interactable: target.interactable === true
    } : null
  };
}

function buildAnnotationTemplate(reviewExport) {
  if (!reviewExport || typeof reviewExport !== 'object') throw new Error('review export object required');
  const transitions = Array.isArray(reviewExport.transitions) ? reviewExport.transitions : [];
  if (!transitions.length) throw new Error('review export has no transitions');
  return {
    contractVersion: REVIEW_CONTRACT.contractVersion,
    episodeId: reviewExport.episodeId || null,
    splitGroup: 'REVIEW_REQUIRED',
    review: {
      taskPrivacyReviewed: false,
      semanticLabelsVerified: false,
      outcomeVerified: false,
      credentialsExcluded: false,
      secretsExcluded: false
    },
    taskOverride: null,
    steps: transitions.map(transition => ({
      transitionId: transition.transitionId || null,
      evidence: evidenceForTransition(transition),
      include: null,
      exclusionReason: null,
      action: null,
      outcome: null,
      blocker: null,
      decisionReasonCode: 'verified_human_demonstration'
    }))
  };
}

function defaultOutputPath(inputPath) {
  const parsed = path.parse(path.resolve(inputPath));
  return path.join(parsed.dir, `${parsed.name}.strategy-review.json`);
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { input: null, output: null };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--output') args.output = argv[++i];
    else if (!args.input) args.input = value;
    else throw new Error(`unexpected argument: ${value}`);
  }
  if (!args.input) throw new Error('Usage: node training-collector/tools/make_strategy_review_template.js <task-episode-review.json> [--output file]');
  return args;
}

function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    const reviewExport = loadReviewExport(args.input);
    const template = buildAnnotationTemplate(reviewExport);
    const output = path.resolve(args.output || defaultOutputPath(args.input));
    fs.writeFileSync(output, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      reviewContractVersion: template.contractVersion,
      episodeId: template.episodeId,
      transitionCount: template.steps.length,
      verified: false,
      trainingEligible: false,
      output
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  loadReviewExport,
  stateSummary,
  evidenceForTransition,
  buildAnnotationTemplate,
  defaultOutputPath,
  parseArgs,
  main
};
