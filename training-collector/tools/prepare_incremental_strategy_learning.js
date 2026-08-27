#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { prepareBatch } = require('./prepare_human_learning_batch.js');
const { buildReviewPack } = require('./prepare_strategy_review_pack.js');
const { scoreReviewPack } = require('./score_strategy_review_pack.js');
const { prepareReviewDrafts } = require('./prepare_strategy_review_drafts.js');
const { resolveTeachingBatch } = require('./resolve_strategy_teaching_batch.js');
const {
  prepareApprovalCandidates,
  verifyDigest,
  HUMAN_CONFIRMATION_PHRASE
} = require('./prepare_strategy_approval_candidates.js');

const INCREMENTAL_STRATEGY_LEARNING_VERSION = '0.1.0';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return file;
}

function normalizeEpisodeId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function collectApprovedEpisodeIds(root) {
  const ids = new Set();
  if (!root) return ids;
  const full = path.resolve(root);
  if (!fs.existsSync(full)) return ids;
  const stat = fs.statSync(full);
  const files = [];
  if (stat.isFile()) files.push(full);
  else {
    const stack = [full];
    while (stack.length) {
      const dir = stack.pop();
      for (const name of fs.readdirSync(dir)) {
        const child = path.join(dir, name);
        const childStat = fs.statSync(child);
        if (childStat.isDirectory()) stack.push(child);
        else if (/\.strategy-review\.approved\.json$/i.test(name)) files.push(child);
      }
    }
  }
  for (const file of files.sort()) {
    const episodeId = normalizeEpisodeId(readJson(file)?.episodeId);
    if (episodeId) ids.add(episodeId);
  }
  return ids;
}

function episodeIdsFromValue(value) {
  const ids = new Set();
  const add = item => {
    const episodeId = normalizeEpisodeId(typeof item === 'string' ? item : item?.episodeId);
    if (episodeId) ids.add(episodeId);
  };
  if (Array.isArray(value)) value.forEach(add);
  else if (value && typeof value === 'object') {
    for (const key of ['episodeIds', 'processedEpisodeIds', 'excludedEpisodeIds', 'items']) {
      if (Array.isArray(value[key])) value[key].forEach(add);
    }
  }
  return ids;
}

function collectEpisodeIdsFromFile(file) {
  const ids = new Set();
  if (!file) return ids;
  const full = path.resolve(file);
  if (!fs.existsSync(full)) throw new Error(`exclude_episode_file_missing:${full}`);
  const text = fs.readFileSync(full, 'utf8');
  try {
    for (const id of episodeIdsFromValue(JSON.parse(text))) ids.add(id);
    return ids;
  } catch (_) {
    for (const line of text.split(/\r?\n/)) {
      const id = normalizeEpisodeId(line.replace(/^\s*[-*]\s*/, ''));
      if (id) ids.add(id);
    }
    return ids;
  }
}

function combinedExcludedEpisodeIds(options = {}) {
  const ids = collectApprovedEpisodeIds(options.excludeApprovedDir || null);
  for (const id of collectEpisodeIdsFromFile(options.excludeEpisodeFile || null)) ids.add(id);
  return ids;
}

function filterLearningManifest(manifest, excludedEpisodeIds = new Set()) {
  const queue = Array.isArray(manifest?.strategy?.queue) ? manifest.strategy.queue : [];
  const kept = [];
  const excludedPreviouslyProcessed = [];
  const duplicateCurrent = [];
  const seen = new Set();

  for (const item of queue) {
    const episodeId = normalizeEpisodeId(item?.episodeId);
    if (episodeId && excludedEpisodeIds.has(episodeId)) {
      excludedPreviouslyProcessed.push(episodeId);
      continue;
    }
    if (episodeId && seen.has(episodeId)) {
      duplicateCurrent.push(episodeId);
      continue;
    }
    if (episodeId) seen.add(episodeId);
    kept.push(item);
  }

  const readyForHumanReviewCount = kept.filter(item => item?.queueStatus === 'ready-for-human-review').length;
  return {
    ...manifest,
    incrementalFilter: {
      sourceStrategyQueueCount: queue.length,
      retainedStrategyQueueCount: kept.length,
      excludedPreviouslyProcessedCount: excludedPreviouslyProcessed.length,
      duplicateCurrentEpisodeCount: duplicateCurrent.length,
      excludedEpisodeIdsStoredAsSemanticEpisodeIdsOnly: true
    },
    strategy: {
      ...(manifest?.strategy || {}),
      sourceReviewFileCount: Number(manifest?.strategy?.reviewFileCount || queue.length),
      reviewFileCount: kept.length,
      readyForHumanReviewCount,
      autoTrainEligibleCount: 0,
      queue: kept
    }
  };
}

function forbiddenTrainingModulesImported() {
  const files = Object.keys(require.cache);
  return {
    approvalApplicator: files.some(file => /apply_strategy_approval_candidates\.js$/i.test(file)),
    datasetBuilder: files.some(file => /build_strategy_dataset_from_approvals\.js$/i.test(file)),
    fitter: files.some(file => /fit_strategy_offline_baseline\.js$/i.test(file))
  };
}

function relativeToCwd(file) {
  return path.relative(process.cwd(), path.resolve(file));
}

function markdownForBundle(bundle) {
  const lines = [
    '# Incremental Strategy learning candidate bundle',
    '',
    `Bundle version: ${bundle.incrementalStrategyLearningVersion}`,
    `Status: ${bundle.status}`,
    `Candidate episodes: ${bundle.candidateEpisodeCount}`,
    `Blocked episodes: ${bundle.blockedEpisodeCount}`,
    `Excluded previously processed episodes: ${bundle.excludedPreviouslyProcessedCount}`,
    `Duplicate current episode exports: ${bundle.duplicateCurrentEpisodeCount}`,
    `Still unresolved for human review: ${bundle.unresolvedHumanReviewCount}`,
    '',
    `Approval digest: \`${bundle.digestHash || '<none>'}\``,
    `Required confirmation phrase: \`${HUMAN_CONFIRMATION_PHRASE}\``,
    '',
    '> This bundle is review-only. It does not apply approval, build a Strategy dataset, or fit a model.',
    '> Raw interaction never becomes Strategy training data without explicit digest-bound human approval.',
    ''
  ];
  return `${lines.join('\n')}\n`;
}

function prepareIncrementalStrategyLearning(options = {}) {
  if (!options.reviewRoot) throw new Error('incremental_review_root_required');
  const reviewRoot = path.resolve(options.reviewRoot);
  if (!fs.existsSync(reviewRoot)) throw new Error(`incremental_review_root_missing:${reviewRoot}`);
  const rawRoot = options.rawRoot ? path.resolve(options.rawRoot) : null;
  const outDir = path.resolve(options.outputDir || 'training-collector/learning-batches/incremental-latest');
  fs.mkdirSync(outDir, { recursive: true });

  const batch = prepareBatch({
    rawRoot,
    reviewRoot,
    outputDir: path.join(outDir, '01-learning-batch')
  });

  const excludedIds = combinedExcludedEpisodeIds(options);
  const filteredManifest = filterLearningManifest(batch.manifest, excludedIds);
  const filteredManifestFile = writeJson(
    path.join(outDir, '02-incremental-filter', 'incremental-manifest.json'),
    filteredManifest
  );

  const reviewPack = buildReviewPack(filteredManifestFile, path.join(outDir, '03-review-pack'));
  const triage = scoreReviewPack(reviewPack.packFile);
  const triageFile = writeJson(path.join(outDir, '04-triage', 'triage.json'), triage);
  const drafts = prepareReviewDrafts(reviewPack.packFile, triageFile, path.join(outDir, '05-review-drafts'));
  const resolution = resolveTeachingBatch(reviewPack.packFile, triageFile, path.join(outDir, '06-resolution'));
  const candidates = prepareApprovalCandidates(
    drafts.digestFile,
    path.join(outDir, '07-approval-candidates'),
    { resolutionFile: resolution.jsonFile }
  );

  if (!verifyDigest(candidates.result)) throw new Error('incremental_candidate_digest_integrity_failed');
  if (candidates.result?.policy?.autoTrainEligible !== false) throw new Error('incremental_candidate_auto_train_boundary_failed');

  const imported = forbiddenTrainingModulesImported();
  if (imported.approvalApplicator) throw new Error('incremental_approval_applicator_must_not_be_imported');
  if (imported.datasetBuilder) throw new Error('incremental_dataset_builder_must_not_be_imported');
  if (imported.fitter) throw new Error('incremental_fitter_must_not_be_imported');

  const candidateEpisodeCount = Number(candidates.result?.candidateEpisodeCount || 0);
  const bundle = {
    incrementalStrategyLearningVersion: INCREMENTAL_STRATEGY_LEARNING_VERSION,
    generatedAt: new Date().toISOString(),
    status: candidateEpisodeCount > 0 ? 'awaiting-explicit-human-approval' : 'no-eligible-candidates',
    source: {
      reviewRoot: relativeToCwd(reviewRoot),
      rawRoot: rawRoot ? relativeToCwd(rawRoot) : null,
      excludeApprovedDir: options.excludeApprovedDir ? relativeToCwd(options.excludeApprovedDir) : null,
      excludeEpisodeFile: options.excludeEpisodeFile ? relativeToCwd(options.excludeEpisodeFile) : null
    },
    sourceReviewFileCount: Number(batch.manifest?.strategy?.reviewFileCount || 0),
    retainedReviewFileCount: Number(filteredManifest?.strategy?.reviewFileCount || 0),
    readyForHumanReviewCount: Number(filteredManifest?.strategy?.readyForHumanReviewCount || 0),
    excludedPreviouslyProcessedCount: Number(filteredManifest?.incrementalFilter?.excludedPreviouslyProcessedCount || 0),
    duplicateCurrentEpisodeCount: Number(filteredManifest?.incrementalFilter?.duplicateCurrentEpisodeCount || 0),
    candidateEpisodeCount,
    blockedEpisodeCount: Number(candidates.result?.blockedEpisodeCount || 0),
    unresolvedHumanReviewCount: Number(resolution.result?.unresolvedHumanReviewCount || 0),
    fullyResolvedEpisodeCount: Number(resolution.result?.fullyResolvedEpisodeCount || 0),
    digestHash: candidates.result?.digestHash || null,
    requiredHumanConfirmationPhrase: HUMAN_CONFIRMATION_PHRASE,
    stages: {
      learningBatchManifest: relativeToCwd(batch.manifestFile),
      incrementalManifest: relativeToCwd(filteredManifestFile),
      reviewPack: relativeToCwd(reviewPack.packFile),
      triage: relativeToCwd(triageFile),
      reviewDraftDigest: relativeToCwd(drafts.digestFile),
      ambiguityResolution: relativeToCwd(resolution.jsonFile),
      approvalCandidates: relativeToCwd(candidates.jsonFile),
      approvalCandidateMarkdown: relativeToCwd(candidates.markdownFile)
    },
    invariants: {
      rawInteractionAutoPromotedToStrategyTraining: false,
      privacyBatchAppliedBeforeStrategyCandidate: true,
      previouslyProcessedEpisodesExcludedBeforeReviewPack: true,
      duplicateCurrentEpisodeExportsDeduplicated: true,
      resolverOutputsAreReviewAidsOnly: resolution.result?.policy?.reviewAidOnly === true,
      candidateDigestVerified: true,
      explicitHumanDigestApprovalRequired: true,
      approvalApplied: false,
      datasetBuilt: false,
      trainingPerformed: false,
      autoTrainEligible: false,
      approvalApplicatorImported: imported.approvalApplicator,
      datasetBuilderImported: imported.datasetBuilder,
      fitterImported: imported.fitter
    }
  };

  const bundleFile = writeJson(path.join(outDir, 'incremental-strategy-learning-manifest.json'), bundle);
  const markdownFile = path.join(outDir, 'incremental-strategy-learning-review.md');
  fs.writeFileSync(markdownFile, markdownForBundle(bundle), 'utf8');
  return { bundle, bundleFile, markdownFile, candidates };
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
    if (!args.reviews) {
      throw new Error('Usage: node training-collector/tools/prepare_incremental_strategy_learning.js --reviews <task-episode-review-dir> [--raw <raw-session-dir>] [--exclude-approved <approved-annotations-dir>] [--exclude-episodes <episode-id-file>] [--out dir]');
    }
    const prepared = prepareIncrementalStrategyLearning({
      reviewRoot: args.reviews,
      rawRoot: args.raw || null,
      excludeApprovedDir: args['exclude-approved'] || null,
      excludeEpisodeFile: args['exclude-episodes'] || null,
      outputDir: args.out || 'training-collector/learning-batches/incremental-latest'
    });
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      version: prepared.bundle.incrementalStrategyLearningVersion,
      status: prepared.bundle.status,
      sourceReviewFileCount: prepared.bundle.sourceReviewFileCount,
      retainedReviewFileCount: prepared.bundle.retainedReviewFileCount,
      readyForHumanReviewCount: prepared.bundle.readyForHumanReviewCount,
      excludedPreviouslyProcessedCount: prepared.bundle.excludedPreviouslyProcessedCount,
      duplicateCurrentEpisodeCount: prepared.bundle.duplicateCurrentEpisodeCount,
      candidateEpisodeCount: prepared.bundle.candidateEpisodeCount,
      blockedEpisodeCount: prepared.bundle.blockedEpisodeCount,
      unresolvedHumanReviewCount: prepared.bundle.unresolvedHumanReviewCount,
      digestHash: prepared.bundle.digestHash,
      autoTrainEligible: prepared.bundle.invariants.autoTrainEligible,
      approvalApplied: prepared.bundle.invariants.approvalApplied,
      datasetBuilt: prepared.bundle.invariants.datasetBuilt,
      trainingPerformed: prepared.bundle.invariants.trainingPerformed,
      manifest: path.resolve(prepared.bundleFile),
      review: path.resolve(prepared.markdownFile),
      approvalCandidates: path.resolve(prepared.candidates.jsonFile)
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  INCREMENTAL_STRATEGY_LEARNING_VERSION,
  readJson,
  writeJson,
  normalizeEpisodeId,
  collectApprovedEpisodeIds,
  episodeIdsFromValue,
  collectEpisodeIdsFromFile,
  combinedExcludedEpisodeIds,
  filterLearningManifest,
  forbiddenTrainingModulesImported,
  markdownForBundle,
  prepareIncrementalStrategyLearning,
  parseArgs,
  main
};
