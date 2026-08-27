#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { readRaw } = require('./build_action_semantics.js');
const { collectFiles } = require('./curate_random_human_data.js');

const TARGET_BACKFILL_VERSION = '0.1.0';
const MAX_LABEL_LENGTH = 160;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveFile(file) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.resolve(file);
}

function cleanText(value, max = MAX_LABEL_LENGTH) {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : null;
}

function cleanToken(value, max = 80) {
  const text = cleanText(value, max);
  return text ? text.toLowerCase() : null;
}

function safeSemanticTarget(descriptor) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) return null;
  const label = cleanText(descriptor.label);
  const role = cleanToken(descriptor.role);
  const tag = cleanToken(descriptor.tag);
  if (!label && !role && !tag) return null;
  return {
    label,
    role,
    tag,
    editable: descriptor.editable === true,
    enabled: descriptor.enabled !== false,
    rendered: descriptor.rendered !== false,
    inViewport: descriptor.inViewport === true,
    interactable: descriptor.interactable === true,
    visible: descriptor.visible !== false && descriptor.rendered !== false
  };
}

function pageIdFromTransitionId(transitionId) {
  const match = String(transitionId || '').match(/^(.*)-t\d+$/);
  return match ? match[1] : null;
}

function descriptorRef(descriptor, fallbackRef) {
  const direct = descriptor && typeof descriptor === 'object'
    ? (descriptor.elementRef || descriptor.ref || descriptor.targetRef)
    : null;
  const value = typeof direct === 'string' && direct.trim() ? direct.trim() : fallbackRef;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function indexKey(pageInstanceId, targetRef) {
  if (!pageInstanceId || !targetRef) return null;
  return `${pageInstanceId}::${targetRef}`;
}

function addDescriptor(index, pageInstanceId, targetRef, descriptor, sourceType) {
  const key = indexKey(pageInstanceId, targetRef);
  const semanticTarget = safeSemanticTarget(descriptor);
  if (!key || !semanticTarget) return;
  if (!index.has(key)) index.set(key, []);
  index.get(key).push({ semanticTarget, sourceType });
}

function indexRawEvent(index, event) {
  const pageInstanceId = typeof event?.pageInstanceId === 'string' ? event.pageInstanceId : null;
  if (!pageInstanceId) return;

  if (event?.targetDescriptor) {
    addDescriptor(
      index,
      pageInstanceId,
      descriptorRef(event.targetDescriptor, event.targetRef),
      event.targetDescriptor,
      'dom-target-descriptor'
    );
  }
  if (event?.resolvedTargetDescriptor) {
    addDescriptor(
      index,
      pageInstanceId,
      descriptorRef(event.resolvedTargetDescriptor, event.resolvedTargetRef),
      event.resolvedTargetDescriptor,
      'dom-resolved-target-descriptor'
    );
  }

  if (event?.type === 'semantic-snapshot') {
    const observation = event?.observation || {};
    const snapshotPage = typeof observation?.pageInstanceId === 'string' ? observation.pageInstanceId : pageInstanceId;
    for (const element of Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : []) {
      addDescriptor(index, snapshotPage, descriptorRef(element, null), element, 'semantic-snapshot');
    }
  }
}

function buildDescriptorIndex(rawFiles) {
  const index = new Map();
  const errors = [];
  let eventCount = 0;
  for (const file of rawFiles) {
    try {
      const raw = readRaw(file);
      for (const event of Array.isArray(raw?.events) ? raw.events : []) {
        eventCount += 1;
        indexRawEvent(index, event);
      }
    } catch (error) {
      errors.push({ file: path.relative(process.cwd(), file), error: String(error?.message || error) });
    }
  }
  return { index, errors, eventCount };
}

function identityFieldConflict(a, b, key) {
  const left = a?.[key];
  const right = b?.[key];
  if (left == null || left === '' || right == null || right === '') return false;
  return left !== right;
}

function compatibleTargets(a, b) {
  return !['label', 'role', 'tag', 'editable'].some(key => identityFieldConflict(a, b, key));
}

function mergeTargets(entries) {
  if (!entries.length) return { status: 'missing', semanticTarget: null, sources: [] };
  const targets = entries.map(entry => entry.semanticTarget);
  for (let i = 0; i < targets.length; i += 1) {
    for (let j = i + 1; j < targets.length; j += 1) {
      if (!compatibleTargets(targets[i], targets[j])) {
        return {
          status: 'conflict',
          semanticTarget: null,
          sources: [...new Set(entries.map(entry => entry.sourceType))].sort()
        };
      }
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
  return {
    status: 'recovered',
    semanticTarget: merged,
    sources: [...new Set(entries.map(entry => entry.sourceType))].sort()
  };
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

function recoverProposal(packItem, proposal, review, descriptorIndex) {
  const transitionId = String(proposal?.transitionId || '');
  const transition = transitionById(review, transitionId);
  const pageInstanceId = pageIdFromTransitionId(transitionId);
  const targetRef = typeof transition?.rawAction?.targetRef === 'string' && transition.rawAction.targetRef.trim()
    ? transition.rawAction.targetRef.trim()
    : null;
  const key = indexKey(pageInstanceId, targetRef);
  const merged = key ? mergeTargets(descriptorIndex.get(key) || []) : { status: 'missing', semanticTarget: null, sources: [] };

  if (merged.status === 'recovered') {
    return {
      transitionId,
      status: 'recovered-semantic-target',
      semanticTarget: merged.semanticTarget,
      evidenceSources: merged.sources,
      descriptorEvidenceCount: key ? (descriptorIndex.get(key) || []).length : 0,
      requiresHumanConfirmation: true,
      autoTrainEligible: false
    };
  }
  return {
    transitionId,
    status: merged.status === 'conflict' ? 'conflict-needs-human-review' : 'target-evidence-unavailable',
    semanticTarget: null,
    evidenceSources: merged.sources,
    descriptorEvidenceCount: key ? (descriptorIndex.get(key) || []).length : 0,
    requiresHumanConfirmation: true,
    autoTrainEligible: false
  };
}

function increment(counts, key) {
  const normalized = String(key || '<none>');
  counts[normalized] = (counts[normalized] || 0) + 1;
}

function buildTargetEvidence(packFile, rawRoot, outputFile) {
  const fullPack = path.resolve(packFile);
  const fullRaw = path.resolve(rawRoot);
  const pack = readJson(fullPack);
  const rawFiles = collectFiles(fullRaw);
  const indexed = buildDescriptorIndex(rawFiles);
  const items = [];
  const byTargetRole = {};
  const byTargetTag = {};
  const byEvidenceSource = {};
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
        for (const source of recovered.evidenceSources) increment(byEvidenceSource, source);
      } else {
        unresolvedTargetCount += 1;
        if (recovered.status === 'conflict-needs-human-review') conflictTargetCount += 1;
      }
    }
    if (transitions.length) {
      items.push({
        episodeId: packItem?.episodeId || null,
        transitionCount: transitions.length,
        transitions
      });
    }
  }

  const result = {
    targetBackfillVersion: TARGET_BACKFILL_VERSION,
    generatedAt: new Date().toISOString(),
    sourcePack: path.relative(process.cwd(), fullPack),
    sourceRawRoot: path.relative(process.cwd(), fullRaw),
    sourceRawFileCount: rawFiles.length,
    indexedRawEventCount: indexed.eventCount,
    rawReadErrorCount: indexed.errors.length,
    requestedTransitionCount,
    recoveredSemanticTargetCount,
    unresolvedTargetCount,
    conflictTargetCount,
    byTargetRole,
    byTargetTag,
    byEvidenceSource,
    policy: {
      reviewAidOnly: true,
      pageScopedRefMatchingInternalOnly: true,
      rawSelectorsExcluded: true,
      selectorCandidatesExcluded: true,
      coordinatesExcluded: true,
      pageInstanceIdFieldExcluded: true,
      targetRefFieldExcluded: true,
      tabIdsExcluded: true,
      rawFieldValuesExcluded: true,
      requiresHumanConfirmation: true,
      autoTrainEligible: false
    },
    items
  };

  const output = path.resolve(outputFile || path.join(path.dirname(fullPack), 'strategy-target-evidence-v01', 'target-evidence.json'));
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
      throw new Error('Usage: node training-collector/tools/backfill_strategy_target_evidence.js --pack <review-pack.json> --raw <socket-data-dir> [--out target-evidence.json]');
    }
    const built = buildTargetEvidence(args.pack, args.raw, args.out);
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      version: built.result.targetBackfillVersion,
      sourceRawFileCount: built.result.sourceRawFileCount,
      requestedTransitionCount: built.result.requestedTransitionCount,
      recoveredSemanticTargetCount: built.result.recoveredSemanticTargetCount,
      unresolvedTargetCount: built.result.unresolvedTargetCount,
      conflictTargetCount: built.result.conflictTargetCount,
      byTargetRole: built.result.byTargetRole,
      byTargetTag: built.result.byTargetTag,
      byEvidenceSource: built.result.byEvidenceSource,
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
  TARGET_BACKFILL_VERSION,
  cleanText,
  cleanToken,
  safeSemanticTarget,
  pageIdFromTransitionId,
  descriptorRef,
  indexKey,
  indexRawEvent,
  buildDescriptorIndex,
  compatibleTargets,
  mergeTargets,
  proposalNeedsRecovery,
  recoverProposal,
  buildTargetEvidence,
  parseArgs,
  main
};
