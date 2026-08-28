#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { readRaw } = require('./build_action_semantics.js');
const { collectFiles } = require('./curate_random_human_data.js');
const {
  buildDescriptorIndex,
  pageIdFromTransitionId,
  indexKey,
  proposalNeedsRecovery
} = require('./backfill_strategy_target_evidence.js');

const TARGET_BACKFILL_DIAGNOSTIC_VERSION = '0.1.0';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveFile(file) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.resolve(file);
}

function transitionById(review, transitionId) {
  return (Array.isArray(review?.transitions) ? review.transitions : [])
    .find(item => String(item?.transitionId || '') === String(transitionId || '')) || null;
}

function rawDescriptorCoverage(rawFiles) {
  let rawEventCount = 0;
  let pageScopedRawEventCount = 0;
  let targetDescriptorEventCount = 0;
  let resolvedTargetDescriptorEventCount = 0;
  let semanticSnapshotEventCount = 0;
  let semanticSnapshotElementCount = 0;
  const pagesWithDescriptor = new Set();
  const refsWithDescriptor = new Set();
  const readErrors = [];

  function noteDescriptor(pageInstanceId, ref) {
    if (typeof pageInstanceId === 'string' && pageInstanceId) pagesWithDescriptor.add(pageInstanceId);
    if (typeof ref === 'string' && ref) refsWithDescriptor.add(ref);
  }

  for (const file of rawFiles) {
    try {
      const raw = readRaw(file);
      for (const event of Array.isArray(raw?.events) ? raw.events : []) {
        rawEventCount += 1;
        const pageInstanceId = typeof event?.pageInstanceId === 'string' ? event.pageInstanceId : null;
        if (pageInstanceId) pageScopedRawEventCount += 1;
        if (event?.targetDescriptor && typeof event.targetDescriptor === 'object') {
          targetDescriptorEventCount += 1;
          noteDescriptor(pageInstanceId, event.targetDescriptor.elementRef || event.targetDescriptor.ref || event.targetRef || null);
        }
        if (event?.resolvedTargetDescriptor && typeof event.resolvedTargetDescriptor === 'object') {
          resolvedTargetDescriptorEventCount += 1;
          noteDescriptor(pageInstanceId, event.resolvedTargetDescriptor.elementRef || event.resolvedTargetDescriptor.ref || event.resolvedTargetRef || null);
        }
        if (event?.type === 'semantic-snapshot') {
          semanticSnapshotEventCount += 1;
          const observation = event?.observation || {};
          const snapshotPage = typeof observation?.pageInstanceId === 'string' ? observation.pageInstanceId : pageInstanceId;
          for (const element of Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : []) {
            semanticSnapshotElementCount += 1;
            noteDescriptor(snapshotPage, element?.ref || element?.elementRef || element?.targetRef || null);
          }
        }
      }
    } catch (error) {
      readErrors.push({ file: path.relative(process.cwd(), file), error: String(error?.message || error) });
    }
  }

  return {
    rawEventCount,
    pageScopedRawEventCount,
    targetDescriptorEventCount,
    resolvedTargetDescriptorEventCount,
    semanticSnapshotEventCount,
    semanticSnapshotElementCount,
    descriptorPageCount: pagesWithDescriptor.size,
    descriptorRefTokenCount: refsWithDescriptor.size,
    pagesWithDescriptor,
    refsWithDescriptor,
    readErrors
  };
}

function diagnose(packFile, rawRoot) {
  const fullPack = path.resolve(packFile);
  const fullRaw = path.resolve(rawRoot);
  const pack = readJson(fullPack);
  const rawFiles = collectFiles(fullRaw);
  const indexed = buildDescriptorIndex(rawFiles);
  const coverage = rawDescriptorCoverage(rawFiles);

  let requestedTransitionCount = 0;
  let requestedWithPageIdCount = 0;
  let requestedWithTargetRefCount = 0;
  let exactDescriptorKeyMatchCount = 0;
  let pagePresentButExactKeyMissingCount = 0;
  let targetRefSeenOnOtherPageCount = 0;
  let descriptorPageMissingCount = 0;
  let sourceReviewMissingCount = 0;
  let sourceTransitionMissingCount = 0;

  for (const packItem of (Array.isArray(pack?.items) ? pack.items : []).filter(item => item?.status === 'awaiting-human-review')) {
    const sourceFile = resolveFile(packItem?.sourceFile);
    if (!sourceFile || !fs.existsSync(sourceFile)) {
      sourceReviewMissingCount += 1;
      continue;
    }
    const review = readJson(sourceFile);
    for (const proposal of Array.isArray(packItem?.proposals) ? packItem.proposals : []) {
      if (!proposalNeedsRecovery(proposal)) continue;
      requestedTransitionCount += 1;
      const transitionId = String(proposal?.transitionId || '');
      const transition = transitionById(review, transitionId);
      if (!transition) {
        sourceTransitionMissingCount += 1;
        continue;
      }
      const pageInstanceId = pageIdFromTransitionId(transitionId);
      const targetRef = typeof transition?.rawAction?.targetRef === 'string' && transition.rawAction.targetRef.trim()
        ? transition.rawAction.targetRef.trim()
        : null;
      if (pageInstanceId) requestedWithPageIdCount += 1;
      if (targetRef) requestedWithTargetRefCount += 1;
      const key = indexKey(pageInstanceId, targetRef);
      if (key && indexed.index.has(key)) {
        exactDescriptorKeyMatchCount += 1;
        continue;
      }
      if (pageInstanceId && coverage.pagesWithDescriptor.has(pageInstanceId)) {
        pagePresentButExactKeyMissingCount += 1;
        continue;
      }
      if (targetRef && coverage.refsWithDescriptor.has(targetRef)) {
        targetRefSeenOnOtherPageCount += 1;
        continue;
      }
      if (pageInstanceId && !coverage.pagesWithDescriptor.has(pageInstanceId)) descriptorPageMissingCount += 1;
    }
  }

  const likelyBlocker = exactDescriptorKeyMatchCount > 0
    ? 'partial_exact_linkage_available'
    : coverage.targetDescriptorEventCount + coverage.resolvedTargetDescriptorEventCount + coverage.semanticSnapshotElementCount === 0
      ? 'raw_telemetry_contains_no_semantic_descriptor_evidence'
      : descriptorPageMissingCount === requestedTransitionCount
        ? 'review_transition_pages_not_present_in_raw_descriptor_evidence'
        : targetRefSeenOnOtherPageCount > 0
          ? 'element_refs_exist_but_page_identity_does_not_link'
          : pagePresentButExactKeyMissingCount > 0
            ? 'page_identity_links_but_element_ref_does_not_link'
            : 'insufficient_exact_provenance';

  return {
    targetBackfillDiagnosticVersion: TARGET_BACKFILL_DIAGNOSTIC_VERSION,
    generatedAt: new Date().toISOString(),
    sourcePack: path.relative(process.cwd(), fullPack),
    sourceRawRoot: path.relative(process.cwd(), fullRaw),
    sourceRawFileCount: rawFiles.length,
    rawReadErrorCount: Math.max(indexed.errors.length, coverage.readErrors.length),
    rawCoverage: {
      rawEventCount: coverage.rawEventCount,
      pageScopedRawEventCount: coverage.pageScopedRawEventCount,
      targetDescriptorEventCount: coverage.targetDescriptorEventCount,
      resolvedTargetDescriptorEventCount: coverage.resolvedTargetDescriptorEventCount,
      semanticSnapshotEventCount: coverage.semanticSnapshotEventCount,
      semanticSnapshotElementCount: coverage.semanticSnapshotElementCount,
      descriptorIndexKeyCount: indexed.index.size,
      descriptorPageCount: coverage.descriptorPageCount,
      descriptorRefTokenCount: coverage.descriptorRefTokenCount
    },
    requestedCoverage: {
      requestedTransitionCount,
      requestedWithPageIdCount,
      requestedWithTargetRefCount,
      exactDescriptorKeyMatchCount,
      pagePresentButExactKeyMissingCount,
      targetRefSeenOnOtherPageCount,
      descriptorPageMissingCount,
      sourceReviewMissingCount,
      sourceTransitionMissingCount
    },
    likelyBlocker,
    policy: {
      aggregateOnly: true,
      rawIdentifiersExcluded: true,
      rawTextValuesExcluded: true,
      selectorsExcluded: true,
      coordinatesExcluded: true,
      tabIdsExcluded: true,
      autoTrainEligible: false
    }
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
    if (!args.pack || !args.raw) throw new Error('Usage: node training-collector/tools/diagnose_strategy_target_backfill.js --pack <review-pack.json> --raw <socket-data-dir> [--out report.json]');
    const result = diagnose(args.pack, args.raw);
    if (args.out) {
      const output = path.resolve(args.out);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify({ ok: true, result: 'PASS', ...result }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  TARGET_BACKFILL_DIAGNOSTIC_VERSION,
  transitionById,
  rawDescriptorCoverage,
  diagnose,
  parseArgs,
  main
};
