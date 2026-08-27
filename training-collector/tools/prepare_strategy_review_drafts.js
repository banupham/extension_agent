#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { DIRECT_ACTION_HINTS } = require('./score_strategy_review_pack.js');

const REVIEW_DRAFT_VERSION = '0.1.0';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function safeName(value) {
  return String(value || 'episode').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 140) || 'episode';
}

function resolveSourceFile(file) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.resolve(file);
}

function transitionById(review, transitionId) {
  return (Array.isArray(review?.transitions) ? review.transitions : [])
    .find(item => String(item?.transitionId || '') === String(transitionId || '')) || null;
}

function semanticTargetSummary(proposal) {
  const target = proposal?.evidence?.targetBefore || null;
  if (!target) return null;
  return {
    label: typeof target.label === 'string' ? target.label : null,
    role: typeof target.role === 'string' ? target.role : null,
    tag: typeof target.tag === 'string' ? target.tag : null,
    editable: target.editable === true,
    enabled: target.enabled !== false,
    visible: target.visible !== false
  };
}

function suggestedActionFor(proposal, score, rawTransition) {
  if (score?.fastLabelReviewCandidate !== true) return null;
  const type = String(score?.actionTypeHint || proposal?.proposal?.actionTypeHint || '').trim();
  if (!DIRECT_ACTION_HINTS.has(type)) return null;
  const targetRef = typeof rawTransition?.rawAction?.targetRef === 'string' && rawTransition.rawAction.targetRef.trim()
    ? rawTransition.rawAction.targetRef.trim()
    : null;
  if (!targetRef) return null;
  return {
    contractVersion: '0.1.0',
    type,
    targetRef,
    args: {},
    intent: null,
    expectedOutcome: {}
  };
}

function reviewerAid(proposal, score, rawTransition) {
  const suggestedAction = suggestedActionFor(proposal, score, rawTransition);
  return {
    reviewClass: score?.fastLabelReviewCandidate === true ? 'fast-label-review' : 'ambiguous-label-review',
    labelConfidence: Number(score?.labelConfidence || 0),
    reasons: Array.isArray(score?.reasons) ? [...score.reasons] : [],
    semanticTarget: semanticTargetSummary(proposal),
    capturedActionSucceeded: proposal?.evidence?.actionSucceededCaptured === true,
    suggestedAction,
    suggestedActionReadyForCopy: !!suggestedAction,
    reviewerMustVerify: {
      includeOrExclude: true,
      semanticAction: true,
      outcome: true,
      progress: true,
      taskRelevance: true
    }
  };
}

function draftForItem(packItem, triageItem, sourceReview) {
  const triageByTransition = new Map((Array.isArray(triageItem?.transitions) ? triageItem.transitions : [])
    .map(item => [String(item?.transitionId || ''), item]));
  const proposalByTransition = new Map((Array.isArray(packItem?.proposals) ? packItem.proposals : [])
    .map(item => [String(item?.transitionId || ''), item]));

  return {
    reviewDraftVersion: REVIEW_DRAFT_VERSION,
    contractVersion: '0.1.1',
    episodeId: packItem?.episodeId || null,
    splitGroup: null,
    review: {
      taskPrivacyReviewed: false,
      semanticLabelsVerified: false,
      outcomeVerified: false,
      credentialsExcluded: false,
      secretsExcluded: false
    },
    task: packItem?.task || null,
    finalOutcomeStatus: packItem?.finalOutcomeStatus || null,
    steps: (Array.isArray(packItem?.proposals) ? packItem.proposals : []).map(proposal => {
      const transitionId = String(proposal?.transitionId || '');
      const score = triageByTransition.get(transitionId) || null;
      const rawTransition = transitionById(sourceReview, transitionId);
      return {
        transitionId: proposal?.transitionId || null,
        include: null,
        action: null,
        outcome: null,
        reviewerAid: reviewerAid(proposalByTransition.get(transitionId) || proposal, score, rawTransition)
      };
    }),
    policy: {
      suggestionsAreEvidenceAidsOnly: true,
      suggestionsNeverCountAsHumanVerification: true,
      noReviewBooleanAutoApproved: true,
      noStepIncludeAutoApproved: true,
      noOutcomeAutoApproved: true,
      autoTrainEligible: false
    }
  };
}

function digestTransition(proposal, score, draftStep) {
  return {
    transitionId: proposal?.transitionId || null,
    reviewClass: draftStep?.reviewerAid?.reviewClass || 'ambiguous-label-review',
    actionTypeHint: score?.actionTypeHint || proposal?.proposal?.actionTypeHint || null,
    targetLabel: proposal?.evidence?.targetBefore?.label || null,
    targetRole: proposal?.evidence?.targetBefore?.role || null,
    targetTag: proposal?.evidence?.targetBefore?.tag || null,
    labelConfidence: Number(score?.labelConfidence || 0),
    capturedActionSucceeded: proposal?.evidence?.actionSucceededCaptured === true,
    suggestedActionReadyForCopy: draftStep?.reviewerAid?.suggestedActionReadyForCopy === true,
    reasons: Array.isArray(score?.reasons) ? [...score.reasons] : [],
    outcomeStillRequiresHumanReview: true,
    progressStillRequiresHumanReview: true
  };
}

function markdownForDigest(digest) {
  const lines = [
    '# Strategy human-review approval digest',
    '',
    `Episodes: ${digest.episodeCount}`,
    `Transitions: ${digest.transitionCount}`,
    `Fast semantic-label review: ${digest.fastLabelReviewCount}`,
    `Ambiguous semantic-label review: ${digest.ambiguousLabelReviewCount}`,
    `Fast-label coverage: ${(digest.fastLabelReviewCoverage * 100).toFixed(1)}%`,
    '',
    '> No transition is auto-approved. Outcomes, progress, task relevance, privacy, and include/exclude decisions still require human confirmation.',
    ''
  ];

  for (const item of digest.items) {
    lines.push(`## ${item.episodeId || '<unknown episode>'}`);
    lines.push('');
    lines.push(`Task: ${String(item.task?.instruction || '').replace(/\s+/g, ' ').trim()}`);
    lines.push(`Transitions: ${item.transitionCount}; fast: ${item.fastLabelReviewCount}; ambiguous: ${item.ambiguousLabelReviewCount}`);
    lines.push(`Draft: ${item.draftFile}`);
    lines.push('');
    for (const step of item.transitions) {
      const cls = step.reviewClass === 'fast-label-review' ? 'FAST' : 'AMBIGUOUS';
      const target = step.targetLabel || step.targetRole || step.targetTag || '<semantic target missing>';
      const hint = step.actionTypeHint || '<action type missing>';
      const reasons = step.reasons.length ? `; reasons=${step.reasons.join(',')}` : '';
      lines.push(`- [${cls} ${(step.labelConfidence * 100).toFixed(0)}%] ${step.transitionId}: ${hint} -> ${target}; capturedActionSucceeded=${step.capturedActionSucceeded}${reasons}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function prepareReviewDrafts(packFile, triageFile, outputDir) {
  const fullPack = path.resolve(packFile);
  const fullTriage = path.resolve(triageFile);
  const pack = readJson(fullPack);
  const triage = readJson(fullTriage);
  const outDir = path.resolve(outputDir || path.join(path.dirname(fullPack), 'review-drafts-v01'));
  const draftsDir = path.join(outDir, 'drafts');
  fs.mkdirSync(draftsDir, { recursive: true });

  const triageByEpisode = new Map((Array.isArray(triage?.items) ? triage.items : [])
    .map(item => [String(item?.episodeId || ''), item]));
  const items = [];

  for (const packItem of (Array.isArray(pack?.items) ? pack.items : []).filter(item => item?.status === 'awaiting-human-review')) {
    const triageItem = triageByEpisode.get(String(packItem?.episodeId || '')) || null;
    if (!triageItem) throw new Error(`triage episode missing: ${packItem?.episodeId || '<unknown>'}`);
    const sourceFile = resolveSourceFile(packItem?.sourceFile);
    if (!sourceFile || !fs.existsSync(sourceFile)) throw new Error(`review source missing: ${packItem?.sourceFile || '<none>'}`);
    const sourceReview = readJson(sourceFile);
    const draft = draftForItem(packItem, triageItem, sourceReview);
    const draftFile = path.join(draftsDir, `${safeName(packItem.episodeId)}.strategy-review.draft.json`);
    fs.writeFileSync(draftFile, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');

    const scoreByTransition = new Map((Array.isArray(triageItem?.transitions) ? triageItem.transitions : [])
      .map(item => [String(item?.transitionId || ''), item]));
    const stepByTransition = new Map(draft.steps.map(item => [String(item?.transitionId || ''), item]));
    const transitions = (Array.isArray(packItem?.proposals) ? packItem.proposals : []).map(proposal =>
      digestTransition(proposal, scoreByTransition.get(String(proposal?.transitionId || '')) || null, stepByTransition.get(String(proposal?.transitionId || '')) || null));
    const fastLabelReviewCount = transitions.filter(item => item.reviewClass === 'fast-label-review').length;
    items.push({
      episodeId: packItem.episodeId,
      task: packItem.task || null,
      finalOutcomeStatus: packItem.finalOutcomeStatus || null,
      transitionCount: transitions.length,
      fastLabelReviewCount,
      ambiguousLabelReviewCount: transitions.length - fastLabelReviewCount,
      draftFile: path.relative(process.cwd(), draftFile),
      transitions
    });
  }

  const transitionCount = items.reduce((sum, item) => sum + item.transitionCount, 0);
  const fastLabelReviewCount = items.reduce((sum, item) => sum + item.fastLabelReviewCount, 0);
  const ambiguousLabelReviewCount = transitionCount - fastLabelReviewCount;
  const digest = {
    reviewDraftVersion: REVIEW_DRAFT_VERSION,
    generatedAt: new Date().toISOString(),
    sourcePack: path.relative(process.cwd(), fullPack),
    sourceTriage: path.relative(process.cwd(), fullTriage),
    episodeCount: items.length,
    transitionCount,
    fastLabelReviewCount,
    ambiguousLabelReviewCount,
    fastLabelReviewCoverage: transitionCount ? fastLabelReviewCount / transitionCount : 0,
    reviewerWork: {
      episodePrivacyConfirmationsRequired: items.length,
      transitionIncludeDecisionsRequired: transitionCount,
      semanticActionConfirmationsRequired: transitionCount,
      outcomeReviewsRequired: transitionCount,
      progressReviewsRequired: transitionCount
    },
    policy: {
      rawEvidenceNeverAutoPromotedToStrategyLabel: true,
      suggestedActionsRequireHumanConfirmation: true,
      outcomesRequireHumanConfirmation: true,
      progressRequiresHumanConfirmation: true,
      autoTrainEligible: false
    },
    items
  };
  const digestFile = path.join(outDir, 'approval-digest.json');
  const markdownFile = path.join(outDir, 'approval-digest.md');
  fs.writeFileSync(digestFile, `${JSON.stringify(digest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownFile, markdownForDigest(digest), 'utf8');
  return { digest, digestFile, markdownFile, draftsDir };
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
    if (!args.pack || !args.triage) throw new Error('Usage: node training-collector/tools/prepare_strategy_review_drafts.js --pack <review-pack.json> --triage <triage.json> [--out dir]');
    const result = prepareReviewDrafts(args.pack, args.triage, args.out);
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      version: result.digest.reviewDraftVersion,
      episodeCount: result.digest.episodeCount,
      transitionCount: result.digest.transitionCount,
      fastLabelReviewCount: result.digest.fastLabelReviewCount,
      ambiguousLabelReviewCount: result.digest.ambiguousLabelReviewCount,
      fastLabelReviewCoverage: result.digest.fastLabelReviewCoverage,
      autoTrainEligible: result.digest.policy.autoTrainEligible,
      drafts: path.resolve(result.draftsDir),
      approvalDigest: path.resolve(result.digestFile),
      approvalMarkdown: path.resolve(result.markdownFile)
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  REVIEW_DRAFT_VERSION,
  safeName,
  resolveSourceFile,
  transitionById,
  semanticTargetSummary,
  suggestedActionFor,
  reviewerAid,
  draftForItem,
  digestTransition,
  markdownForDigest,
  prepareReviewDrafts,
  parseArgs,
  main
};
