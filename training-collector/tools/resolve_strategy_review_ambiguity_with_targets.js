#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Base = require('./resolve_strategy_review_ambiguity.js');

const TARGET_AWARE_RESOLVER_VERSION = '0.2.0';
const MEDIA_TYPES = new Set(['play', 'pause', 'mute', 'unmute']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveFile(file) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.resolve(file);
}

function targetEvidenceIndex(value) {
  const byEpisode = new Map();
  for (const item of Array.isArray(value?.items) ? value.items : []) {
    const transitions = new Map((Array.isArray(item?.transitions) ? item.transitions : [])
      .map(entry => [String(entry?.transitionId || ''), entry]));
    byEpisode.set(String(item?.episodeId || ''), transitions);
  }
  return byEpisode;
}

function mediaType(target) {
  const tokens = new Set((String(target?.label || '').toLowerCase().match(/[a-z0-9]+/g) || []));
  if (tokens.has('unmute')) return 'unmute';
  if (tokens.has('pause')) return 'pause';
  if (tokens.has('mute')) return 'mute';
  if (tokens.has('play')) return 'play';
  return null;
}

function recoveredClickResolution(proposal, transition, targetEvidence) {
  const transitionId = proposal?.transitionId || transition?.transitionId || null;
  const hint = proposal?.proposal?.actionTypeHint || null;
  const ref = typeof transition?.rawAction?.targetRef === 'string' && transition.rawAction.targetRef.trim()
    ? transition.rawAction.targetRef.trim()
    : null;
  const capturedSuccess = proposal?.evidence?.actionSucceededCaptured !== false && transition?.outcome?.actionSucceeded !== false;
  const recovered = targetEvidence?.status === 'recovered-semantic-target' ? targetEvidence?.semanticTarget : null;

  if (!capturedSuccess) {
    return {
      transitionId,
      sourceHint: hint,
      status: 'needs-human-review',
      semanticActionType: null,
      suggestedAction: null,
      exclusionReason: null,
      reasonCode: 'captured_action_failure_requires_human_review',
      semanticTarget: recovered,
      targetEvidenceStatus: targetEvidence?.status || null,
      requiresHumanConfirmation: true,
      autoTrainEligible: false
    };
  }
  if (!ref || !recovered) {
    return {
      transitionId,
      sourceHint: hint,
      status: 'needs-human-review',
      semanticActionType: 'click',
      suggestedAction: null,
      exclusionReason: null,
      reasonCode: targetEvidence?.status === 'conflict-needs-human-review'
        ? 'click_target_backfill_conflict_requires_human_review'
        : 'click_semantic_target_unavailable_after_raw_backfill',
      semanticTarget: recovered,
      targetEvidenceStatus: targetEvidence?.status || null,
      requiresHumanConfirmation: true,
      autoTrainEligible: false
    };
  }

  const semanticMedia = mediaType(recovered);
  const actionType = semanticMedia && MEDIA_TYPES.has(semanticMedia) ? semanticMedia : 'click';
  const action = Base.safeAction(
    actionType,
    ref,
    {},
    actionType === 'click' ? 'semantic-click-from-reviewed-target-evidence' : `semantic-${actionType}-from-reviewed-target-evidence`
  );
  return {
    transitionId,
    sourceHint: hint,
    status: 'resolved-semantic-action',
    semanticActionType: action.type,
    suggestedAction: action,
    exclusionReason: null,
    reasonCode: actionType === 'click'
      ? 'click_target_recovered_from_raw_semantic_descriptor'
      : `media_${actionType}_target_recovered_from_raw_semantic_descriptor`,
    semanticTarget: recovered,
    targetEvidenceStatus: targetEvidence.status,
    targetEvidenceSources: Array.isArray(targetEvidence.evidenceSources) ? [...targetEvidence.evidenceSources] : [],
    requiresHumanConfirmation: true,
    autoTrainEligible: false
  };
}

function resolutionForItem(packItem, triageItem, sourceReview, targetEvidenceByTransition) {
  const scoreByTransition = new Map((Array.isArray(triageItem?.transitions) ? triageItem.transitions : [])
    .map(item => [String(item?.transitionId || ''), item]));
  const resolutions = [];

  for (const proposal of Array.isArray(packItem?.proposals) ? packItem.proposals : []) {
    const score = scoreByTransition.get(String(proposal?.transitionId || '')) || null;
    if (score?.fastLabelReviewCandidate === true) continue;
    const transition = Base.transitionById(sourceReview, proposal?.transitionId);
    const hint = proposal?.proposal?.actionTypeHint || null;
    if (hint === 'click') {
      const evidence = targetEvidenceByTransition?.get(String(proposal?.transitionId || '')) || null;
      resolutions.push(recoveredClickResolution(proposal, transition, evidence));
    } else {
      resolutions.push(Base.resolveAmbiguousTransition({ proposal, transition, task: packItem?.task || {} }));
    }
  }

  const resolvedCount = resolutions.filter(item => item.status === 'resolved-semantic-action').length;
  const captureNoiseCount = resolutions.filter(item => item.status === 'capture-noise').length;
  const unresolvedCount = resolutions.filter(item => item.status === 'needs-human-review').length;
  const targetBackfillResolvedCount = resolutions.filter(item => item.targetEvidenceStatus === 'recovered-semantic-target' && item.status === 'resolved-semantic-action').length;
  return {
    episodeId: packItem?.episodeId || null,
    task: packItem?.task || null,
    finalOutcomeStatus: packItem?.finalOutcomeStatus || null,
    ambiguousTransitionCount: resolutions.length,
    resolvedSemanticActionCount: resolvedCount,
    captureNoiseCount,
    unresolvedHumanReviewCount: unresolvedCount,
    targetBackfillResolvedCount,
    allAmbiguityResolvedForApprovalAid: resolutions.length > 0 && unresolvedCount === 0,
    resolutions
  };
}

function markdownFor(result) {
  const lines = [
    '# Strategy target-aware ambiguity resolution',
    '',
    `Episodes: ${result.episodeCount}`,
    `Ambiguous transitions: ${result.ambiguousTransitionCount}`,
    `Resolved semantic actions: ${result.resolvedSemanticActionCount}`,
    `Recovered-click resolutions: ${result.targetBackfillResolvedCount}`,
    `Capture noise: ${result.captureNoiseCount}`,
    `Still needs human review: ${result.unresolvedHumanReviewCount}`,
    `Episodes fully resolved as review aids: ${result.fullyResolvedEpisodeCount}`,
    '',
    '> Recovered target evidence is a review aid only and never counts as human verification.',
    ''
  ];
  for (const item of result.items) {
    lines.push(`## ${item.episodeId || '<unknown>'}`);
    lines.push('');
    lines.push(`Task: ${String(item.task?.instruction || '').replace(/\s+/g, ' ').trim()}`);
    for (const resolution of item.resolutions) {
      const target = resolution.semanticTarget?.label || resolution.semanticTarget?.role || resolution.semanticTarget?.tag || '<target missing>';
      const action = resolution.suggestedAction?.type || resolution.semanticActionType || '-';
      lines.push(`- ${resolution.transitionId}: ${resolution.status}; action=${action}; target=${target}; reason=${resolution.reasonCode}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function resolveReviewPack(packFile, triageFile, targetEvidenceFile, outputDir) {
  const fullPack = path.resolve(packFile);
  const fullTriage = path.resolve(triageFile);
  const fullTargetEvidence = path.resolve(targetEvidenceFile);
  const pack = readJson(fullPack);
  const triage = readJson(fullTriage);
  const targetEvidence = readJson(fullTargetEvidence);
  const triageByEpisode = new Map((Array.isArray(triage?.items) ? triage.items : [])
    .map(item => [String(item?.episodeId || ''), item]));
  const evidenceByEpisode = targetEvidenceIndex(targetEvidence);
  const items = [];

  for (const packItem of (Array.isArray(pack?.items) ? pack.items : []).filter(item => item?.status === 'awaiting-human-review')) {
    const triageItem = triageByEpisode.get(String(packItem?.episodeId || '')) || null;
    if (!triageItem) throw new Error(`triage_episode_missing:${packItem?.episodeId || '<unknown>'}`);
    const sourceFile = resolveFile(packItem?.sourceFile);
    if (!sourceFile || !fs.existsSync(sourceFile)) throw new Error(`review_source_missing:${packItem?.episodeId || '<unknown>'}`);
    const evidence = evidenceByEpisode.get(String(packItem?.episodeId || '')) || new Map();
    items.push(resolutionForItem(packItem, triageItem, readJson(sourceFile), evidence));
  }

  const result = {
    ambiguityResolverVersion: TARGET_AWARE_RESOLVER_VERSION,
    generatedAt: new Date().toISOString(),
    sourcePack: path.relative(process.cwd(), fullPack),
    sourceTriage: path.relative(process.cwd(), fullTriage),
    sourceTargetEvidence: path.relative(process.cwd(), fullTargetEvidence),
    episodeCount: items.length,
    ambiguousTransitionCount: items.reduce((sum, item) => sum + item.ambiguousTransitionCount, 0),
    resolvedSemanticActionCount: items.reduce((sum, item) => sum + item.resolvedSemanticActionCount, 0),
    targetBackfillResolvedCount: items.reduce((sum, item) => sum + item.targetBackfillResolvedCount, 0),
    captureNoiseCount: items.reduce((sum, item) => sum + item.captureNoiseCount, 0),
    unresolvedHumanReviewCount: items.reduce((sum, item) => sum + item.unresolvedHumanReviewCount, 0),
    fullyResolvedEpisodeCount: items.filter(item => item.allAmbiguityResolvedForApprovalAid).length,
    policy: {
      reviewAidOnly: true,
      targetEvidenceNeverAutoVerifiesHumanReview: true,
      rawSelectorsExcluded: true,
      coordinatesExcluded: true,
      tabIdsExcluded: true,
      autoTrainEligible: false
    },
    items
  };

  const outDir = path.resolve(outputDir || path.join(path.dirname(fullTriage), 'strategy-ambiguity-resolution-v02'));
  fs.mkdirSync(outDir, { recursive: true });
  const jsonFile = path.join(outDir, 'ambiguity-resolution.json');
  const markdownFile = path.join(outDir, 'ambiguity-resolution.md');
  fs.writeFileSync(jsonFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownFile, markdownFor(result), 'utf8');
  return { result, jsonFile, markdownFile };
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
    if (!args.pack || !args.triage || !args['target-evidence']) {
      throw new Error('Usage: node training-collector/tools/resolve_strategy_review_ambiguity_with_targets.js --pack <review-pack.json> --triage <triage.json> --target-evidence <target-evidence.json> [--out dir]');
    }
    const resolvedPack = resolveReviewPack(args.pack, args.triage, args['target-evidence'], args.out);
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      version: resolvedPack.result.ambiguityResolverVersion,
      episodeCount: resolvedPack.result.episodeCount,
      ambiguousTransitionCount: resolvedPack.result.ambiguousTransitionCount,
      resolvedSemanticActionCount: resolvedPack.result.resolvedSemanticActionCount,
      targetBackfillResolvedCount: resolvedPack.result.targetBackfillResolvedCount,
      captureNoiseCount: resolvedPack.result.captureNoiseCount,
      unresolvedHumanReviewCount: resolvedPack.result.unresolvedHumanReviewCount,
      fullyResolvedEpisodeCount: resolvedPack.result.fullyResolvedEpisodeCount,
      autoTrainEligible: resolvedPack.result.policy.autoTrainEligible,
      resolution: path.resolve(resolvedPack.jsonFile),
      markdown: path.resolve(resolvedPack.markdownFile)
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  TARGET_AWARE_RESOLVER_VERSION,
  targetEvidenceIndex,
  mediaType,
  recoveredClickResolution,
  resolutionForItem,
  markdownFor,
  resolveReviewPack,
  parseArgs,
  main
};
