#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  adaptHumanReviewToStrategyEpisode
} = require('../../control-center/manager/training/human_strategy_episode_adapter.js');
const {
  buildDatasetFromRecords,
  writeDatasetPackage
} = require('./build_strategy_episode_dataset.js');
const {
  evaluateBaselineReadiness
} = require('./check_strategy_baseline_readiness.js');

const APPROVED_DATASET_BUILDER_VERSION = '0.1.0';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function safeName(value) {
  return String(value || 'episode').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 140) || 'episode';
}

function annotationFiles(dir) {
  const full = path.resolve(dir);
  if (!fs.existsSync(full)) throw new Error(`annotation_directory_missing:${full}`);
  return fs.readdirSync(full, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.strategy-review\.approved\.json$/i.test(entry.name))
    .map(entry => path.join(full, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function resolveSourceFile(file) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.resolve(file);
}

function assertApprovalProof(annotation, file) {
  const proof = annotation?.humanConfirmation || {};
  if (proof.method !== 'explicit-digest-hash-cli-confirmation') throw new Error(`annotation_human_confirmation_missing:${file}`);
  if (proof.confirmationPhraseMatched !== true) throw new Error(`annotation_confirmation_phrase_not_verified:${file}`);
  if (typeof proof.digestHash !== 'string' || !proof.digestHash) throw new Error(`annotation_digest_hash_missing:${file}`);
  const review = annotation?.review || {};
  for (const key of ['taskPrivacyReviewed', 'semanticLabelsVerified', 'outcomeVerified', 'credentialsExcluded', 'secretsExcluded']) {
    if (review[key] !== true) throw new Error(`annotation_review_confirmation_missing:${key}:${file}`);
  }
}

function packByEpisode(pack) {
  return new Map((Array.isArray(pack?.items) ? pack.items : [])
    .map(item => [String(item?.episodeId || ''), item]));
}

function adaptApprovedAnnotations(packFile, annotationsDir, episodesDir) {
  const fullPack = path.resolve(packFile);
  const pack = readJson(fullPack);
  const byEpisode = packByEpisode(pack);
  const files = annotationFiles(annotationsDir);
  if (!files.length) throw new Error('no_approved_strategy_annotations_found');
  const outDir = path.resolve(episodesDir);
  fs.mkdirSync(outDir, { recursive: true });

  const records = [];
  const outputs = [];
  for (const file of files) {
    const annotation = readJson(file);
    assertApprovalProof(annotation, file);
    const episodeId = String(annotation?.episodeId || '');
    const packItem = byEpisode.get(episodeId);
    if (!packItem) throw new Error(`approval_episode_missing_from_review_pack:${episodeId}`);
    const sourceFile = resolveSourceFile(packItem?.sourceFile);
    if (!sourceFile || !fs.existsSync(sourceFile)) throw new Error(`review_source_missing:${episodeId}`);
    const review = readJson(sourceFile);
    const adapted = adaptHumanReviewToStrategyEpisode(review, annotation);
    const record = adapted.record;
    if (record?.source?.kind !== 'human-demonstration' || record?.source?.labelVerified !== true || record?.source?.outcomeVerified !== true) {
      throw new Error(`adapted_record_trust_boundary_failed:${episodeId}`);
    }
    const output = path.join(outDir, `${safeName(record.episodeId)}.strategy-episode.json`);
    fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    records.push(record);
    outputs.push(output);
  }
  return { records, outputs };
}

function distinctSplitGroups(records) {
  return new Set((records || []).map(record => String(record?.splitGroup || '')).filter(Boolean)).size;
}

function buildApprovedStrategyDataset(packFile, annotationsDir, outputDir, options = {}) {
  const outDir = path.resolve(outputDir);
  const episodesDir = path.join(outDir, 'episodes');
  const datasetDir = path.join(outDir, 'dataset');
  fs.mkdirSync(outDir, { recursive: true });
  const adapted = adaptApprovedAnnotations(packFile, annotationsDir, episodesDir);
  const groupCount = distinctSplitGroups(adapted.records);

  if (groupCount < 3) {
    const manifest = {
      approvedDatasetBuilderVersion: APPROVED_DATASET_BUILDER_VERSION,
      generatedAt: new Date().toISOString(),
      sourcePack: path.relative(process.cwd(), path.resolve(packFile)),
      sourceAnnotations: path.relative(process.cwd(), path.resolve(annotationsDir)),
      adaptedEpisodeCount: adapted.records.length,
      distinctSplitGroupCount: groupCount,
      datasetBuilt: false,
      baselineReady: false,
      reasonCode: 'insufficient_distinct_split_groups',
      minimumDistinctSplitGroups: 3,
      policy: {
        onlyExplicitlyHumanConfirmedAnnotationsAccepted: true,
        sourceKindRequired: 'human-demonstration',
        noAutomaticFallbackApproval: true
      },
      episodeFiles: adapted.outputs.map(file => path.relative(process.cwd(), file))
    };
    const manifestFile = path.join(outDir, 'manifest.json');
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return { manifest, manifestFile, dataset: null };
  }

  const result = buildDatasetFromRecords(adapted.records, { seed: options.seed || undefined });
  const written = writeDatasetPackage(datasetDir, result, { inputFiles: adapted.outputs });
  const readiness = evaluateBaselineReadiness({
    train: result.package.train,
    validation: result.package.validation,
    test: result.package.test
  });
  const manifest = {
    approvedDatasetBuilderVersion: APPROVED_DATASET_BUILDER_VERSION,
    generatedAt: new Date().toISOString(),
    sourcePack: path.relative(process.cwd(), path.resolve(packFile)),
    sourceAnnotations: path.relative(process.cwd(), path.resolve(annotationsDir)),
    adaptedEpisodeCount: adapted.records.length,
    distinctSplitGroupCount: groupCount,
    datasetBuilt: true,
    splitCounts: result.package.manifest.splitCounts,
    baselineReady: readiness.ready,
    baselineReadinessErrors: readiness.errors,
    policy: {
      onlyExplicitlyHumanConfirmedAnnotationsAccepted: true,
      sourceKindRequired: 'human-demonstration',
      deterministicGroupSplit: true,
      trainValidationTestLeakageBoundary: 'splitGroup',
      heldOutNeverUsedForFit: true
    },
    datasetFiles: written.files,
    episodeFiles: adapted.outputs.map(file => path.relative(process.cwd(), file))
  };
  const manifestFile = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { manifest, manifestFile, dataset: written };
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
    if (!args.pack || !args.annotations || !args.out) {
      throw new Error('Usage: node training-collector/tools/build_strategy_dataset_from_approvals.js --pack <review-pack.json> --annotations <approved-annotations-dir> --out <output-dir> [--seed value]');
    }
    const built = buildApprovedStrategyDataset(args.pack, args.annotations, args.out, { seed: args.seed });
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      version: built.manifest.approvedDatasetBuilderVersion,
      adaptedEpisodeCount: built.manifest.adaptedEpisodeCount,
      distinctSplitGroupCount: built.manifest.distinctSplitGroupCount,
      datasetBuilt: built.manifest.datasetBuilt,
      splitCounts: built.manifest.splitCounts || null,
      baselineReady: built.manifest.baselineReady,
      baselineReadinessErrors: built.manifest.baselineReadinessErrors || [],
      output: path.resolve(args.out),
      manifest: path.resolve(built.manifestFile)
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  APPROVED_DATASET_BUILDER_VERSION,
  readJson,
  safeName,
  annotationFiles,
  resolveSourceFile,
  assertApprovalProof,
  packByEpisode,
  adaptApprovedAnnotations,
  distinctSplitGroups,
  buildApprovedStrategyDataset,
  parseArgs,
  main
};
