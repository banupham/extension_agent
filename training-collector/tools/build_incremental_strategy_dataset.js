#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  adaptApprovedAnnotations,
  adaptMachineVerifiedAnnotations
} = require('./build_strategy_dataset_from_approvals.js');
const {
  parseJsonRecords,
  buildDatasetFromRecords,
  writeDatasetPackage
} = require('./build_strategy_episode_dataset.js');
const {
  normalizeRatios,
  stableGroupHash
} = require('../../control-center/manager/training/episode_dataset_export.js');
const {
  validateDataset
} = require('../../control-center/manager/training/episode_outcome_dataset.js');
const {
  evaluateBaselineReadiness
} = require('./check_strategy_baseline_readiness.js');

const INCREMENTAL_DATASET_BUILDER_VERSION = '0.2.0';
const DEFAULT_SPLIT_SEED = 'strategy-episode-v0';
const BASE_SPLIT_FILES = Object.freeze(['train.jsonl', 'validation.jsonl', 'test.jsonl']);

function readJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`base_dataset_file_missing:${file}`);
  return parseJsonRecords(fs.readFileSync(file, 'utf8'), file);
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function loadBaseDataset(datasetDir) {
  const dir = path.resolve(datasetDir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`base_dataset_directory_missing:${dir}`);
  }
  const files = Object.fromEntries(BASE_SPLIT_FILES.map(name => [name, path.join(dir, name)]));
  const records = BASE_SPLIT_FILES.flatMap(name => readJsonl(files[name]));
  const validation = validateDataset(records);
  if (!validation.ok) {
    const detail = validation.errors.map(item => `${item.index}:${item.error}`).join('; ');
    throw new Error(`base_dataset_invalid:${detail}`);
  }
  if (validation.records.some(record => record.split === 'unassigned')) {
    throw new Error('base_dataset_contains_unassigned_records');
  }
  return {
    dir,
    records: validation.records,
    files,
    hashes: Object.fromEntries(BASE_SPLIT_FILES.map(name => [name, sha256File(files[name])]))
  };
}

function splitByGroup(records) {
  const map = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const group = String(record?.splitGroup || '').trim();
    const split = String(record?.split || '').trim();
    if (!group || !['train', 'validation', 'test'].includes(split)) {
      throw new Error(`assigned_split_group_required:${record?.episodeId || '<unknown>'}`);
    }
    const existing = map.get(group);
    if (existing && existing !== split) throw new Error(`base_split_group_leakage:${group}`);
    map.set(group, split);
  }
  return map;
}

function hashUnit(group, seed = DEFAULT_SPLIT_SEED) {
  const hash = stableGroupHash(String(group), String(seed));
  const prefix = hash.slice(0, 13);
  const numerator = Number.parseInt(prefix, 16);
  const denominator = 16 ** prefix.length;
  return numerator / denominator;
}

function stableNewGroupSplit(group, options = {}) {
  const ratios = normalizeRatios(options.ratios || {});
  const seed = String(options.seed || DEFAULT_SPLIT_SEED);
  const unit = hashUnit(group, seed);
  if (unit < ratios.test) return 'test';
  if (unit < ratios.test + ratios.validation) return 'validation';
  return 'train';
}

function assignedRecord(record, split) {
  return { ...record, split };
}

function mergeRecordsPreservingBaseSplits(baseRecords, newRecords, options = {}) {
  const baseValidation = validateDataset(baseRecords || []);
  if (!baseValidation.ok) throw new Error(`incremental_base_records_invalid:${baseValidation.errors[0]?.error || 'unknown'}`);
  if (baseValidation.records.some(record => record.split === 'unassigned')) {
    throw new Error('incremental_base_records_must_be_assigned');
  }

  const newValidation = validateDataset(newRecords || []);
  if (!newValidation.ok) throw new Error(`incremental_new_records_invalid:${newValidation.errors[0]?.error || 'unknown'}`);
  if (newValidation.records.some(record => record.split !== 'unassigned')) {
    throw new Error('incremental_new_records_must_be_unassigned');
  }

  const baseEpisodeIds = new Set(baseValidation.records.map(record => record.episodeId));
  for (const record of newValidation.records) {
    if (baseEpisodeIds.has(record.episodeId)) throw new Error(`incremental_duplicate_episode_id:${record.episodeId}`);
  }

  const existingGroups = splitByGroup(baseValidation.records);
  const newGroupAssignments = new Map();
  let inheritedGroupRecordCount = 0;
  let newGroupRecordCount = 0;

  const assignedNew = newValidation.records.map(record => {
    const group = String(record.splitGroup);
    let split = existingGroups.get(group) || null;
    if (split) {
      inheritedGroupRecordCount += 1;
    } else {
      split = newGroupAssignments.get(group) || null;
      if (!split) {
        split = stableNewGroupSplit(group, options);
        newGroupAssignments.set(group, split);
      }
      newGroupRecordCount += 1;
    }
    return assignedRecord(record, split);
  });

  const combined = [...baseValidation.records, ...assignedNew];
  const combinedValidation = validateDataset(combined);
  if (!combinedValidation.ok) {
    const detail = combinedValidation.errors.map(item => `${item.index}:${item.error}`).join('; ');
    throw new Error(`incremental_combined_dataset_invalid:${detail}`);
  }

  const originalByEpisode = new Map(baseValidation.records.map(record => [record.episodeId, record.split]));
  for (const record of combinedValidation.records.slice(0, baseValidation.records.length)) {
    if (originalByEpisode.get(record.episodeId) !== record.split) {
      throw new Error(`incremental_base_split_mutated:${record.episodeId}`);
    }
  }

  return {
    records: combinedValidation.records,
    assignedNewRecords: combinedValidation.records.slice(baseValidation.records.length),
    inheritedGroupRecordCount,
    newGroupRecordCount,
    newGroupAssignments: Object.fromEntries([...newGroupAssignments.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    baseSplitAssignmentsPreserved: true,
    seed: String(options.seed || DEFAULT_SPLIT_SEED),
    ratios: normalizeRatios(options.ratios || {})
  };
}

function buildIncrementalStrategyDataset(options = {}) {
  if (!options.baseDatasetDir) throw new Error('incremental_base_dataset_required');
  if (!options.packFile) throw new Error('incremental_review_pack_required');
  if (!options.annotationsDir) throw new Error('incremental_verified_annotations_required');
  if (!options.outputDir) throw new Error('incremental_output_dir_required');

  const verificationMode = options.verificationMode === 'machine' ? 'machine' : 'human';
  const outDir = path.resolve(options.outputDir);
  const episodesDir = path.join(outDir, 'new-episodes');
  const datasetDir = path.join(outDir, 'dataset');
  fs.mkdirSync(outDir, { recursive: true });

  const base = loadBaseDataset(options.baseDatasetDir);
  const adapted = verificationMode === 'machine'
    ? adaptMachineVerifiedAnnotations(options.packFile, options.annotationsDir, episodesDir)
    : adaptApprovedAnnotations(options.packFile, options.annotationsDir, episodesDir);
  const merged = mergeRecordsPreservingBaseSplits(base.records, adapted.records, {
    seed: options.seed || DEFAULT_SPLIT_SEED,
    ratios: options.ratios
  });

  const result = buildDatasetFromRecords(merged.records, { createdAt: new Date().toISOString() });
  if (result.state !== 'assigned') throw new Error('incremental_combined_dataset_must_remain_assigned');
  const written = writeDatasetPackage(datasetDir, result, {
    inputFiles: [
      ...BASE_SPLIT_FILES.map(name => base.files[name]),
      ...adapted.outputs
    ]
  });
  const readiness = evaluateBaselineReadiness({
    train: result.package.train,
    validation: result.package.validation,
    test: result.package.test
  });
  if (!readiness.ready) throw new Error(`incremental_dataset_not_ready:${readiness.errors.join(',')}`);

  const newCount = adapted.records.length;
  const outputBaseHashes = Object.fromEntries(BASE_SPLIT_FILES.map(name => [name, base.hashes[name]]));
  const manifest = {
    incrementalDatasetBuilderVersion: INCREMENTAL_DATASET_BUILDER_VERSION,
    generatedAt: new Date().toISOString(),
    verificationMode,
    sourceBaseDataset: path.relative(process.cwd(), base.dir),
    sourceReviewPack: path.relative(process.cwd(), path.resolve(options.packFile)),
    sourceVerifiedAnnotations: path.relative(process.cwd(), path.resolve(options.annotationsDir)),
    baseRecordCount: base.records.length,
    newVerifiedEpisodeCount: newCount,
    newApprovedEpisodeCount: verificationMode === 'human' ? newCount : 0,
    newMachineVerifiedEpisodeCount: verificationMode === 'machine' ? newCount : 0,
    combinedRecordCount: merged.records.length,
    inheritedGroupRecordCount: merged.inheritedGroupRecordCount,
    newGroupRecordCount: merged.newGroupRecordCount,
    newGroupAssignments: merged.newGroupAssignments,
    splitCounts: result.package.manifest.splitCounts,
    baselineReady: readiness.ready,
    baseSplitAssignmentsPreserved: merged.baseSplitAssignmentsPreserved,
    splitSeed: merged.seed,
    splitRatios: merged.ratios,
    baseDatasetHashes: outputBaseHashes,
    policy: {
      verificationMode,
      onlyVerifiedNewAnnotationsAccepted: true,
      onlyExplicitlyHumanConfirmedNewAnnotationsAccepted: verificationMode === 'human',
      onlyMachineEligibilityAcceptedNewAnnotationsAccepted: verificationMode === 'machine',
      humanApprovalClaimedForMachineData: false,
      baseDatasetRecordsNeverReassigned: true,
      existingSplitGroupInheritsBaseSplit: true,
      newSplitGroupUsesIndependentStableHashThreshold: true,
      addingFutureGroupsDoesNotMoveExistingGroups: true,
      heldOutNeverUsedForFit: true,
      sourceKindRequired: verificationMode === 'machine' ? 'approved-controller' : 'human-demonstration'
    },
    files: written.files,
    newEpisodeFiles: adapted.outputs.map(file => path.relative(process.cwd(), file))
  };
  const manifestFile = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { manifest, manifestFile, dataset: written, merged };
}

function parseArgs(argv = process.argv.slice(2)) {
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
    if (!args.base || !args.pack || !args.annotations || !args.out) {
      throw new Error('Usage: node training-collector/tools/build_incremental_strategy_dataset.js --base <base-dataset-dir> --pack <new-review-pack.json> --annotations <verified-annotations-dir> --out <versioned-output-dir> [--verification-mode human|machine] [--seed value]');
    }
    const built = buildIncrementalStrategyDataset({
      baseDatasetDir: args.base,
      packFile: args.pack,
      annotationsDir: args.annotations,
      outputDir: args.out,
      verificationMode: args['verification-mode'] || 'human',
      seed: args.seed || DEFAULT_SPLIT_SEED
    });
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      version: built.manifest.incrementalDatasetBuilderVersion,
      verificationMode: built.manifest.verificationMode,
      baseRecordCount: built.manifest.baseRecordCount,
      newVerifiedEpisodeCount: built.manifest.newVerifiedEpisodeCount,
      newApprovedEpisodeCount: built.manifest.newApprovedEpisodeCount,
      newMachineVerifiedEpisodeCount: built.manifest.newMachineVerifiedEpisodeCount,
      combinedRecordCount: built.manifest.combinedRecordCount,
      splitCounts: built.manifest.splitCounts,
      baseSplitAssignmentsPreserved: built.manifest.baseSplitAssignmentsPreserved,
      inheritedGroupRecordCount: built.manifest.inheritedGroupRecordCount,
      newGroupRecordCount: built.manifest.newGroupRecordCount,
      newGroupAssignments: built.manifest.newGroupAssignments,
      baselineReady: built.manifest.baselineReady,
      manifest: path.resolve(built.manifestFile),
      dataset: path.resolve(built.manifest.files.manifest)
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  INCREMENTAL_DATASET_BUILDER_VERSION,
  DEFAULT_SPLIT_SEED,
  BASE_SPLIT_FILES,
  readJsonl,
  sha256File,
  loadBaseDataset,
  splitByGroup,
  hashUnit,
  stableNewGroupSplit,
  assignedRecord,
  mergeRecordsPreservingBaseSplits,
  buildIncrementalStrategyDataset,
  parseArgs,
  main
};
