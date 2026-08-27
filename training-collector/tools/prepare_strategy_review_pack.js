#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const REVIEW_CONTRACT = require('../../control-center/HUMAN_STRATEGY_REVIEW_CONTRACT.json');

const REVIEW_PACK_VERSION = '0.1.0';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveSourceFile(file) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.resolve(file);
}

function semanticElements(observation) {
  const direct = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  const nested = Array.isArray(observation?.page?.interactiveElements) ? observation.page.interactiveElements : [];
  return direct.length ? direct : nested;
}

function semanticTarget(observation, targetRef) {
  if (!targetRef) return null;
  const target = semanticElements(observation).find(item => item?.ref === targetRef || item?.elementRef === targetRef || item?.targetRef === targetRef);
  if (!target) return null;
  return {
    label: typeof target.label === 'string' ? target.label : null,
    role: typeof target.role === 'string' ? target.role : null,
    tag: typeof target.tag === 'string' ? target.tag : null,
    editable: target.editable === true,
    enabled: target.enabled !== false,
    visible: target.visible !== false && target.rendered !== false
  };
}

function actionTypeHint(rawAction = {}) {
  const kind = String(rawAction.kind || '').toLowerCase();
  if (kind === 'dom-click' || kind === 'click') return 'click';
  if (kind === 'dom-focus' || kind === 'focus') return 'focus';
  if (kind === 'dom-submit' || kind === 'submit') return 'submit';
  if (kind.startsWith('dom-hover') || kind.includes('hover')) return 'hoverAndObserve';
  if (kind === 'dom-change') return 'form-control-review-required';
  if (kind === 'dom-input') return 'text-action-review-required';
  if (kind === 'keyboard') return 'keyboard-action-review-required';
  if (kind === 'wheel' || kind.includes('scroll')) return 'scroll-direction-review-required';
  return null;
}

function transitionProposal(transition) {
  const rawAction = transition?.rawAction || {};
  const targetRef = typeof rawAction.targetRef === 'string' ? rawAction.targetRef : null;
  return {
    transitionId: transition?.transitionId || null,
    status: transition?.status || null,
    evidence: {
      rawActionKind: rawAction.kind || null,
      rawActionOperation: rawAction.operation || null,
      targetBefore: semanticTarget(transition?.strategyObservationBefore, targetRef),
      targetAfter: semanticTarget(transition?.strategyObservationAfter, targetRef),
      actionSucceededCaptured: transition?.outcome?.actionSucceeded !== false
    },
    proposal: {
      actionTypeHint: actionTypeHint(rawAction),
      include: null,
      action: null,
      outcome: null,
      verifiedByHuman: false,
      note: 'Raw action is evidence only. Reviewer must verify semantic action, outcome, progress and task relevance.'
    }
  };
}

function splitGroupHint(review) {
  const instruction = String(review?.task?.instruction || '').trim().toLowerCase();
  const type = String(review?.task?.type || 'unspecified').trim().toLowerCase();
  const compact = `${type}:${instruction}`.replace(/\s+/g, ' ').slice(0, 160);
  return compact || `episode:${review?.episodeId || 'unknown'}`;
}

function annotationTemplate(review) {
  return {
    contractVersion: REVIEW_CONTRACT.contractVersion,
    episodeId: review.episodeId,
    splitGroup: splitGroupHint(review),
    review: {
      taskPrivacyReviewed: false,
      semanticLabelsVerified: false,
      outcomeVerified: false,
      credentialsExcluded: false,
      secretsExcluded: false
    },
    steps: (Array.isArray(review?.transitions) ? review.transitions : []).map(transition => ({
      transitionId: transition.transitionId,
      include: null,
      action: null,
      outcome: null
    }))
  };
}

function buildReviewPack(manifestFile, outputDir) {
  const fullManifest = path.resolve(manifestFile);
  const manifest = readJson(fullManifest);
  const queue = (Array.isArray(manifest?.strategy?.queue) ? manifest.strategy.queue : [])
    .filter(item => item?.queueStatus === 'ready-for-human-review');
  const outDir = path.resolve(outputDir || path.join(path.dirname(fullManifest), 'strategy-review-pack-v01'));
  const templatesDir = path.join(outDir, 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });

  const items = [];
  for (const queueItem of queue) {
    const sourceFile = resolveSourceFile(queueItem.file);
    if (!sourceFile || !fs.existsSync(sourceFile)) {
      items.push({ episodeId: queueItem.episodeId || null, sourceFile: queueItem.file, status: 'source-missing' });
      continue;
    }
    const review = readJson(sourceFile);
    const proposals = (Array.isArray(review?.transitions) ? review.transitions : []).map(transitionProposal);
    const template = annotationTemplate(review);
    const templateFile = path.join(templatesDir, `${review.episodeId}.strategy-review.template.json`);
    fs.writeFileSync(templateFile, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
    items.push({
      episodeId: review.episodeId,
      sourceFile: path.relative(process.cwd(), sourceFile),
      templateFile: path.relative(process.cwd(), templateFile),
      status: 'awaiting-human-review',
      task: {
        instruction: String(review?.task?.instruction || ''),
        type: String(review?.task?.type || 'unspecified')
      },
      finalOutcomeStatus: review?.finalOutcome?.status || null,
      transitionCount: proposals.length,
      proposals,
      autoTrainEligible: false
    });
  }

  const pack = {
    reviewPackVersion: REVIEW_PACK_VERSION,
    generatedAt: new Date().toISOString(),
    sourceManifest: path.relative(process.cwd(), fullManifest),
    sourceReadyForReviewCount: queue.length,
    itemCount: items.length,
    awaitingHumanReviewCount: items.filter(item => item.status === 'awaiting-human-review').length,
    sourceMissingCount: items.filter(item => item.status === 'source-missing').length,
    contractVersion: REVIEW_CONTRACT.contractVersion,
    policy: {
      proposalsAreEvidenceAidsOnly: true,
      semanticLabelsAutoVerified: false,
      outcomesAutoVerified: false,
      taskPrivacyAutoVerified: false,
      autoTrainEligible: false,
      rawActionNeverBecomesStrategyLabelWithoutReview: true
    },
    items
  };
  const packFile = path.join(outDir, 'review-pack.json');
  fs.writeFileSync(packFile, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
  return { pack, packFile, templatesDir };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    if (!args.manifest) throw new Error('Usage: node training-collector/tools/prepare_strategy_review_pack.js --manifest <manifest.json> [--out dir]');
    const result = buildReviewPack(args.manifest, args.out);
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      version: result.pack.reviewPackVersion,
      sourceReadyForReviewCount: result.pack.sourceReadyForReviewCount,
      awaitingHumanReviewCount: result.pack.awaitingHumanReviewCount,
      sourceMissingCount: result.pack.sourceMissingCount,
      autoTrainEligible: result.pack.policy.autoTrainEligible,
      pack: path.resolve(result.packFile),
      templates: path.resolve(result.templatesDir)
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  REVIEW_PACK_VERSION,
  semanticElements,
  semanticTarget,
  actionTypeHint,
  transitionProposal,
  splitGroupHint,
  annotationTemplate,
  buildReviewPack,
  parseArgs,
  main
};
