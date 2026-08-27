#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { readRaw } = require('./build_action_semantics.js');
const { collectFiles } = require('./curate_random_human_data.js');

const EPISODE_PROVENANCE_BACKFILL_VERSION = '0.1.0';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveFile(file) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.resolve(file);
}

function cleanText(value, max = 160) {
  if (typeof value !== 'string') return null;
  const text = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function cleanToken(value, max = 80) {
  const text = cleanText(value, max);
  return text ? text.toLowerCase() : null;
}

function safeSemanticTarget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const label = cleanText(value.label);
  const role = cleanToken(value.role);
  const tag = cleanToken(value.tag);
  if (!label && !role && !tag) return null;
  return {
    label,
    role,
    tag,
    editable: value.editable === true,
    enabled: value.enabled !== false,
    rendered: value.rendered !== false,
    inViewport: value.inViewport === true,
    interactable: value.interactable === true,
    visible: value.visible !== false && value.rendered !== false
  };
}

function episodeRefKey(episodeId, targetRef) {
  const ep = typeof episodeId === 'string' && episodeId.trim() ? episodeId.trim() : null;
  const ref = typeof targetRef === 'string' && targetRef.trim() ? targetRef.trim() : null;
  return ep && ref ? `${ep}::${ref}` : null;
}

function identityConflict(a, b, key) {
  const left = a?.[key];
  const right = b?.[key];
  if (left == null || left === '' || right == null || right === '') return false;
  return left !== right;
}

function compatibleTargets(a, b) {
  return !['label', 'role', 'tag', 'editable'].some(key => identityConflict(a, b, key));
}

function mergeTargets(entries) {
  if (!entries.length) return { status: 'missing', semanticTarget: null };
  const targets = entries.map(entry => entry.semanticTarget);
  for (let i = 0; i < targets.length; i += 1) {
    for (let j = i + 1; j < targets.length; j += 1) {
      if (!compatibleTargets(targets[i], targets[j])) return { status: 'conflict', semanticTarget: null };
    }
  }
  const merged = {
    label: null,
    role: null,
    tag: null,
    editable: false,
    enabled: true,
    rendered: false,
    inViewport: false,
    interactable: false,
    visible: false
  };
  for (const target of targets) {
    if (!merged.label && target.label) merged.label = target.label;
    if (!merged.role && target.role) merged.role = target.role;
    if (!merged.tag && target.tag) merged.tag = target.tag;
    merged.editable = merged.editable || target.editable === true;
    merged.enabled = merged.enabled && target.enabled !== false;
    merged.rendered = merged.rendered || target.rendered === true;
    merged.inViewport = merged.inViewport || target.inViewport === true;
    merged.interactable = merged.interactable || target.interactable === true;
    merged.visible = merged.visible || target.visible === true;
  }
  return { status: 'recovered', semanticTarget: merged };
}

function buildEpisodeIndex(rawFiles) {
  const index = new Map();
  const errors = [];
  let rawEventCount = 0;
  let provenanceAnchorCount = 0;
  for (const file of rawFiles) {
    try {
      const raw = readRaw(file);
      for (const event of Array.isArray(raw?.events) ? raw.events : []) {
        rawEventCount += 1;
        if (event?.type !== 'episode-action-anchor') continue;
        const key = episodeRefKey(event.episodeId, event.targetRef);
        const semanticTarget = safeSemanticTarget(event.semanticTarget);
        if (!key || !semanticTarget) continue;
        provenanceAnchorCount += 1;
        if (!index.has(key)) index.set(key, []);
        index.get(key).push({ semanticTarget, sourceType: 'episode-action-anchor' });
      }
    } catch (error) {
      errors.push({ file: path.relative(process.cwd(), file), error: String(error?.message || error) });
    }
  }
  return { index, errors, rawEventCount, provenanceAnchorCount };
}

function proposalNeedsRecovery(proposal) {
  if (proposal?.proposal?.actionTypeHint !== 'click') return false;
  const target = proposal?.evidence?.targetBefore;
  return !(target?.label || target?.role || target?.tag);
}

function transitionById(review, transitionId) {
  return (Array.isArray(review?.transitions) ? review.transitions : [])
    .find(item => String(item?.transitionId || '') === String(transitionId || '')) || null;
}

function recoverProposal(packItem, proposal, review, episodeIndex) {
  const transitionId = String(proposal?.transitionId || '');
  const transition = transitionById(review, transitionId);
  const targetRef = typeof transition?.rawAction?.targetRef === 'string' && transition.rawAction.targetRef.trim()
    ? transition.rawAction.targetRef.trim()
    : null;
  const key = episodeRefKey(packItem?.episodeId, targetRef);
  const merged = key ? mergeTargets(episodeIndex.get(key) || []) : { status: 'missing', semanticTarget: null };
  if (merged.status === 'recovered') {
    return {
      transitionId,
      status: 'recovered-semantic-target',
      semanticTarget: merged.semanticTarget,
      evidenceSources: ['episode-action-anchor'],
      descriptorEvidenceCount: key ? (episodeIndex.get(key) || []).length : 0,
      requiresHumanConfirmation: true,
      autoTrainEligible: false
    };
  }
  return {
    transitionId,
    status: merged.status === 'conflict' ? 'conflict-needs-human-review' : 'target-evidence-unavailable',
    semanticTarget: null,
    evidenceSources: merged.status === 'conflict' ? ['episode-action-anchor'] : [],
    descriptorEvidenceCount: key ? (episodeIndex.get(key) || []).length : 0,
    requiresHumanConfirmation: true,
    autoTrainEligible: false
  };
}

function increment(counts, key) {
  const normalized = String(key || '<none>');
  counts[normalized] = (counts[normalized] || 0) + 1;
}

function buildEpisodeProvenanceEvidence(packFile, rawRoot, outputFile) {
  const fullPack = path.resolve(packFile);
  const fullRaw = path.resolve(rawRoot);
  const pack = readJson(fullPack);
  const rawFiles = collectFiles(fullRaw);
  const indexed = buildEpisodeIndex(rawFiles);
  const items = [];
  const byTargetRole = {};
  const byTargetTag = {};
  let requestedTransitionCount = 0;
  let recoveredSemanticTargetCount = 0;
  let unresolvedTargetCount = 0;
  let conflictTargetCount = 0;

  for (const packItem of (Array.isArray(pack?.items) ? pack.items : []).filter(item => item?.status === 'awaiting-human-review')) {
    const sourceFile = resolveFile(packItem?.sourceFile);
    if (!sourceFile || !fs.existsSync(sourceFile)) continue;
    const review = readJson(sourceFile);
    const transitions = [];
    for (const proposal of Array.isArray(packItem?.proposals) ? packItem.proposals : []) {
      if (!proposalNeedsRecovery(proposal)) continue;
      requestedTransitionCount += 1;
      const recovered = recoverProposal(packItem, proposal, review, indexed.index);
      transitions.push(recovered);
      if (recovered.status === 'recovered-semantic-target') {
        recoveredSemanticTargetCount += 1;
        increment(byTargetRole, recovered.semanticTarget?.role || '<none>');
        increment(byTargetTag, recovered.semanticTarget?.tag || '<none>');
      } else {
        unresolvedTargetCount += 1;
        if (recovered.status === 'conflict-needs-human-review') conflictTargetCount += 1;
      }
    }
    if (transitions.length) items.push({ episodeId: packItem?.episodeId || null, transitionCount: transitions.length, transitions });
  }

  const result = {
    episodeProvenanceBackfillVersion: EPISODE_PROVENANCE_BACKFILL_VERSION,
    generatedAt: new Date().toISOString(),
    sourcePack: path.relative(process.cwd(), fullPack),
    sourceRawRoot: path.relative(process.cwd(), fullRaw),
    sourceRawFileCount: rawFiles.length,
    rawReadErrorCount: indexed.errors.length,
    rawEventCount: indexed.rawEventCount,
    provenanceAnchorCount: indexed.provenanceAnchorCount,
    requestedTransitionCount,
    recoveredSemanticTargetCount,
    unresolvedTargetCount,
    conflictTargetCount,
    byTargetRole,
    byTargetTag,
    byEvidenceSource: recoveredSemanticTargetCount ? { 'episode-action-anchor': recoveredSemanticTargetCount } : {},
    policy: {
      reviewAidOnly: true,
      episodeScopedTargetRefMatching: true,
      rawSelectorsExcluded: true,
      selectorCandidatesExcluded: true,
      coordinatesExcluded: true,
      tabIdsExcluded: true,
      privateReasoningExcluded: true,
      requiresHumanConfirmation: true,
      autoTrainEligible: false
    },
    items
  };

  const output = path.resolve(outputFile || path.join(path.dirname(fullPack), 'strategy-episode-provenance-v01', 'target-evidence.json'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return { result, output };
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
    if (!args.pack || !args.raw) {
      throw new Error('Usage: node training-collector/tools/backfill_strategy_episode_provenance.js --pack <review-pack.json> --raw <socket-data-dir> [--out target-evidence.json]');
    }
    const built = buildEpisodeProvenanceEvidence(args.pack, args.raw, args.out);
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      version: built.result.episodeProvenanceBackfillVersion,
      sourceRawFileCount: built.result.sourceRawFileCount,
      provenanceAnchorCount: built.result.provenanceAnchorCount,
      requestedTransitionCount: built.result.requestedTransitionCount,
      recoveredSemanticTargetCount: built.result.recoveredSemanticTargetCount,
      unresolvedTargetCount: built.result.unresolvedTargetCount,
      conflictTargetCount: built.result.conflictTargetCount,
      byTargetRole: built.result.byTargetRole,
      byTargetTag: built.result.byTargetTag,
      autoTrainEligible: built.result.policy.autoTrainEligible,
      output: built.output
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  EPISODE_PROVENANCE_BACKFILL_VERSION,
  cleanText,
  cleanToken,
  safeSemanticTarget,
  episodeRefKey,
  compatibleTargets,
  mergeTargets,
  buildEpisodeIndex,
  proposalNeedsRecovery,
  transitionById,
  recoverProposal,
  buildEpisodeProvenanceEvidence,
  parseArgs,
  main
};
