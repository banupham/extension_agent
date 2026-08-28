#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Base = require('./resolve_strategy_review_ambiguity.js');

const TRIAGE_VERSION = '0.2.0';
const DIRECT_ACTION_HINTS = new Set(['click', 'focus', 'submit']);
const TARGET_REQUIRED = new Set(['click', 'focus', 'submit', 'hoverAndObserve', 'doubleClick', 'drag']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function scoreProposal(proposal, task = null) {
  const hint = proposal?.proposal?.actionTypeHint || null;
  const target = proposal?.evidence?.targetBefore || null;
  const capturedSuccess = proposal?.evidence?.actionSucceededCaptured === true;
  const reasons = [];
  let labelConfidence = 0;

  if (!hint) {
    reasons.push('missing_action_type_hint');
  } else if (hint === 'click' && Base.taskRequestsDoubleClick(task || {})) {
    reasons.push('click_may_be_component_of_explicit_double_click');
    labelConfidence = 0.4;
  } else if (!DIRECT_ACTION_HINTS.has(hint)) {
    reasons.push('ambiguous_action_type_hint');
    labelConfidence = hint === 'hoverAndObserve' ? 0.65 : hint === 'doubleClick' || hint === 'drag' ? 0.7 : 0.35;
  } else {
    labelConfidence = hint === 'click' ? 0.95 : 0.85;
  }

  if (TARGET_REQUIRED.has(hint)) {
    if (!target?.label && !target?.role && !target?.tag) {
      reasons.push('semantic_target_missing');
      labelConfidence = Math.min(labelConfidence, 0.45);
    } else if (!target?.label) {
      reasons.push('semantic_target_label_missing');
      labelConfidence = Math.min(labelConfidence, 0.75);
    }
  }

  if (!capturedSuccess) reasons.push('captured_action_not_successful');

  return {
    transitionId: proposal?.transitionId || null,
    actionTypeHint: hint,
    labelConfidence,
    fastLabelReviewCandidate: labelConfidence >= 0.85 && capturedSuccess && !reasons.includes('semantic_target_missing'),
    outcomeStillRequiresHumanReview: true,
    progressStillRequiresHumanReview: true,
    reasons
  };
}

function scoreItem(item) {
  const scores = (Array.isArray(item?.proposals) ? item.proposals : []).map(proposal => scoreProposal(proposal, item?.task || null));
  const fast = scores.filter(score => score.fastLabelReviewCandidate).length;
  const ambiguous = scores.length - fast;
  return {
    episodeId: item?.episodeId || null,
    task: item?.task || null,
    transitionCount: scores.length,
    fastLabelReviewCount: fast,
    ambiguousLabelReviewCount: ambiguous,
    labelProposalCoverage: scores.length ? fast / scores.length : 0,
    episodeFastLabelReviewCandidate: scores.length > 0 && ambiguous === 0,
    outcomeReviewRequired: true,
    autoTrainEligible: false,
    transitions: scores
  };
}

function scoreReviewPack(packFile) {
  const full = path.resolve(packFile);
  const pack = readJson(full);
  const items = (Array.isArray(pack?.items) ? pack.items : [])
    .filter(item => item?.status === 'awaiting-human-review')
    .map(scoreItem);
  const transitionCount = items.reduce((sum, item) => sum + item.transitionCount, 0);
  const fastLabelReviewCount = items.reduce((sum, item) => sum + item.fastLabelReviewCount, 0);
  const ambiguousLabelReviewCount = items.reduce((sum, item) => sum + item.ambiguousLabelReviewCount, 0);
  return {
    triageVersion: TRIAGE_VERSION,
    generatedAt: new Date().toISOString(),
    sourcePack: path.relative(process.cwd(), full),
    episodeCount: items.length,
    transitionCount,
    fastLabelReviewCount,
    ambiguousLabelReviewCount,
    fastLabelReviewCoverage: transitionCount ? fastLabelReviewCount / transitionCount : 0,
    episodeFastLabelReviewCount: items.filter(item => item.episodeFastLabelReviewCandidate).length,
    policy: {
      proposalsNeverAutoVerifyHumanReview: true,
      outcomesAlwaysRequireHumanReview: true,
      progressAlwaysRequiresHumanReview: true,
      hoverRequiresSemanticStateChangeResolution: true,
      explicitDoubleClickComponentClicksRequireResolution: true,
      autoTrainEligible: false
    },
    items
  };
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
    if (!args.pack) throw new Error('Usage: node training-collector/tools/score_strategy_review_pack.js --pack <review-pack.json> [--out triage.json]');
    const result = scoreReviewPack(args.pack);
    if (args.out) {
      const output = path.resolve(args.out);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      version: result.triageVersion,
      episodeCount: result.episodeCount,
      transitionCount: result.transitionCount,
      fastLabelReviewCount: result.fastLabelReviewCount,
      ambiguousLabelReviewCount: result.ambiguousLabelReviewCount,
      fastLabelReviewCoverage: result.fastLabelReviewCoverage,
      episodeFastLabelReviewCount: result.episodeFastLabelReviewCount,
      autoTrainEligible: result.policy.autoTrainEligible
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  TRIAGE_VERSION,
  DIRECT_ACTION_HINTS,
  TARGET_REQUIRED,
  scoreProposal,
  scoreItem,
  scoreReviewPack,
  parseArgs,
  main
};
