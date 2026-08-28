#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const readline = require('readline');
const { prepareBatch } = require('./prepare_human_learning_batch.js');
const { buildReviewPack } = require('./prepare_strategy_review_pack.js');
const { scoreReviewPack } = require('./score_strategy_review_pack.js');
const { prepareReviewDrafts } = require('./prepare_strategy_review_drafts.js');
const { resolveTeachingBatch } = require('./resolve_strategy_teaching_batch.js');
const { evaluateMachineTrainingEligibility } = require('./evaluate_machine_training_eligibility.js');
const {
  prepareApprovalCandidates,
  verifyDigest,
  HUMAN_CONFIRMATION_PHRASE
} = require('./prepare_strategy_approval_candidates.js');

const INCREMENTAL_STRATEGY_LEARNING_VERSION = '0.5.0';
const BASE_DATASET_SPLITS = Object.freeze(['train.jsonl', 'validation.jsonl', 'test.jsonl']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return file;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
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
        else if (/\.strategy-review\.(?:approved|machine-verified)\.json$/i.test(name)) files.push(child);
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

function collectBaseDatasetEpisodeIds(datasetDir, options = {}) {
  const ids = new Set();
  if (!datasetDir) return ids;
  const includeProvenanceAliases = options.includeProvenanceAliases === true;
  const dir = path.resolve(datasetDir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`base_dataset_directory_missing:${dir}`);
  }
  for (const name of BASE_DATASET_SPLITS) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) throw new Error(`base_dataset_file_missing:${file}`);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(line => line.trim());
    for (const line of lines) {
      const record = JSON.parse(line);
      const episodeId = normalizeEpisodeId(record?.episodeId);
      if (episodeId) ids.add(episodeId);
      if (includeProvenanceAliases) {
        const provenanceId = normalizeEpisodeId(record?.source?.provenanceId);
        if (provenanceId) ids.add(provenanceId);
      }
    }
  }
  return ids;
}

function combinedExcludedEpisodeIds(options = {}) {
  const ids = collectApprovedEpisodeIds(options.excludeApprovedDir || null);
  for (const id of collectEpisodeIdsFromFile(options.excludeEpisodeFile || null)) ids.add(id);
  for (const id of collectBaseDatasetEpisodeIds(options.baseDatasetDir || null, { includeProvenanceAliases: true })) ids.add(id);
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

function forbiddenTrainingModulesImported(importBaseline = null) {
  const baseline = importBaseline instanceof Set ? importBaseline : null;
  const files = Object.keys(require.cache).filter(file => !baseline || !baseline.has(file));
  return {
    approvalApplicator: files.some(file => /apply_strategy_approval_candidates\.js$/i.test(file)),
    datasetBuilder: files.some(file => /build_(?:incremental_)?strategy_dataset.*\.js$/i.test(file)),
    fitter: files.some(file => /fit_strategy_offline_baseline\.js$/i.test(file))
  };
}

function relativeToCwd(file) {
  return path.relative(process.cwd(), path.resolve(file));
}

function executableCandidates(explicit = null) {
  const candidates = [explicit, process.env.SEVEN_ZIP_EXE];
  for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
    if (root) candidates.push(path.join(root, '7-Zip', '7z.exe'));
  }
  candidates.push('7z', '7zz', '7za');
  return [...new Set(candidates.filter(Boolean))];
}

function findSevenZipExecutable(explicit = null) {
  for (const candidate of executableCandidates(explicit)) {
    const looksLikePath = path.isAbsolute(candidate) || /[\\/]/.test(candidate);
    if (looksLikePath) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    const probe = childProcess.spawnSync(candidate, ['i'], {
      stdio: 'ignore',
      windowsHide: true
    });
    if (!probe.error) return candidate;
  }
  return null;
}

function extractReviewArchive(archiveFile, outputDir, options = {}) {
  const archive = path.resolve(archiveFile);
  if (!fs.existsSync(archive) || !fs.statSync(archive).isFile()) {
    throw new Error(`review_archive_missing:${archive}`);
  }
  if (!/\.7z$/i.test(archive)) throw new Error(`unsupported_review_archive:${archive}`);

  const archiveHash = sha256File(archive);
  const root = path.join(path.resolve(outputDir), '00-input', `reviews-${archiveHash.slice(0, 12)}`);
  const marker = path.join(root, '.source-archive.json');
  if (fs.existsSync(root)) {
    if (!fs.existsSync(marker)) throw new Error(`archive_extraction_destination_conflict:${root}`);
    const prior = readJson(marker);
    if (prior?.sha256 !== archiveHash) throw new Error(`archive_extraction_hash_mismatch:${root}`);
    return { reviewRoot: root, archive, archiveHash, reused: true };
  }

  const sevenZip = findSevenZipExecutable(options.sevenZipExe || null);
  if (!sevenZip) {
    throw new Error('seven_zip_executable_not_found:set_SEVEN_ZIP_EXE_or_install_7-Zip');
  }

  const partial = `${root}.partial-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(root), { recursive: true });
  fs.mkdirSync(partial, { recursive: true });
  const run = childProcess.spawnSync(sevenZip, ['x', '-y', `-o${partial}`, archive], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (run.error || run.status !== 0) {
    fs.rmSync(partial, { recursive: true, force: true });
    throw new Error(`review_archive_extract_failed:${run.error?.message || run.stderr || `exit_${run.status}`}`);
  }

  writeJson(path.join(partial, '.source-archive.json'), {
    sourceArchive: archive,
    sha256: archiveHash,
    extractedAt: new Date().toISOString(),
    extractor: sevenZip
  });
  fs.renameSync(partial, root);
  return { reviewRoot: root, archive, archiveHash, reused: false };
}

function resolveReviewInput(input, outputDir, options = {}) {
  const full = path.resolve(String(input || ''));
  if (!full || !fs.existsSync(full)) throw new Error(`incremental_review_input_missing:${full}`);
  const stat = fs.statSync(full);
  if (stat.isDirectory()) return { reviewRoot: full, kind: 'directory', source: full, archiveHash: null, reused: true };
  if (/\.7z$/i.test(full)) {
    const extracted = extractReviewArchive(full, outputDir, options);
    return { ...extracted, kind: '7z', source: full };
  }
  if (/\.task-episode-review\.json$/i.test(full)) {
    return { reviewRoot: full, kind: 'review-file', source: full, archiveHash: null, reused: true };
  }
  throw new Error(`unsupported_incremental_review_input:${full}`);
}

function nextPatchVersion(version) {
  const match = String(version || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`base_model_semver_required:${version || '<missing>'}`);
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3]) + 1}`;
}

function markdownForBundle(bundle) {
  const lines = [
    '# Incremental Strategy learning candidate bundle',
    '',
    `Bundle version: ${bundle.incrementalStrategyLearningVersion}`,
    `Status: ${bundle.status}`,
    `Candidate episodes: ${bundle.candidateEpisodeCount}`,
    `Machine ACCEPT: ${bundle.machineAcceptEpisodeCount}`,
    `Machine QUARANTINE: ${bundle.machineQuarantineEpisodeCount}`,
    `Machine REJECT: ${bundle.machineRejectEpisodeCount}`,
    `Blocked episodes: ${bundle.blockedEpisodeCount}`,
    `Excluded previously processed episodes: ${bundle.excludedPreviouslyProcessedCount}`,
    `Duplicate current episode exports: ${bundle.duplicateCurrentEpisodeCount}`,
    `Still unresolved for human review: ${bundle.unresolvedHumanReviewCount}`,
    '',
    `Approval digest: \`${bundle.digestHash || '<none>'}\``,
    `Required confirmation phrase for human path: \`${HUMAN_CONFIRMATION_PHRASE}\``,
    '',
    '> Machine eligibility is fail-closed: only independently verified outcomes can be ACCEPT.',
    '> Machine ACCEPT may be finalized into a candidate without claiming human approval.',
    '> QUARANTINE keeps uncertain data out of training without deleting it.',
    '> Candidate finalization/protection never overwrites or promotes the base model.',
    ''
  ];
  return `${lines.join('\n')}\n`;
}

function prepareIncrementalStrategyLearning(options = {}) {
  if (!options.reviewRoot) throw new Error('incremental_review_root_required');
  const importBaseline = new Set(Object.keys(require.cache));
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

  const baseDatasetEpisodeIds = collectBaseDatasetEpisodeIds(options.baseDatasetDir || null);
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

  const machineEligibility = evaluateMachineTrainingEligibility({
    manifest: filteredManifest,
    reviewPack: readJson(reviewPack.packFile),
    resolution: resolution.result,
    candidates: candidates.result
  });
  const machineEligibilityFile = writeJson(
    path.join(outDir, '07-approval-candidates', 'machine-eligibility.json'),
    machineEligibility
  );

  const imported = forbiddenTrainingModulesImported(importBaseline);
  if (imported.approvalApplicator) throw new Error('incremental_approval_applicator_must_not_be_imported');
  if (imported.datasetBuilder) throw new Error('incremental_dataset_builder_must_not_be_imported');
  if (imported.fitter) throw new Error('incremental_fitter_must_not_be_imported');

  const candidateEpisodeCount = Number(candidates.result?.candidateEpisodeCount || 0);
  const machineAcceptEpisodeCount = Number(machineEligibility.counts?.accept || 0);
  const bundle = {
    incrementalStrategyLearningVersion: INCREMENTAL_STRATEGY_LEARNING_VERSION,
    generatedAt: new Date().toISOString(),
    status: candidateEpisodeCount > 0 ? 'awaiting-explicit-human-approval' : 'no-eligible-candidates',
    machineFinalizationAvailable: machineAcceptEpisodeCount > 0,
    source: {
      reviewRoot: relativeToCwd(reviewRoot),
      rawRoot: rawRoot ? relativeToCwd(rawRoot) : null,
      baseDatasetDir: options.baseDatasetDir ? relativeToCwd(options.baseDatasetDir) : null,
      excludeApprovedDir: options.excludeApprovedDir ? relativeToCwd(options.excludeApprovedDir) : null,
      excludeEpisodeFile: options.excludeEpisodeFile ? relativeToCwd(options.excludeEpisodeFile) : null
    },
    sourceReviewFileCount: Number(batch.manifest?.strategy?.reviewFileCount || 0),
    retainedReviewFileCount: Number(filteredManifest?.strategy?.reviewFileCount || 0),
    readyForHumanReviewCount: Number(filteredManifest?.strategy?.readyForHumanReviewCount || 0),
    baseDatasetEpisodeCount: baseDatasetEpisodeIds.size,
    excludedPreviouslyProcessedCount: Number(filteredManifest?.incrementalFilter?.excludedPreviouslyProcessedCount || 0),
    duplicateCurrentEpisodeCount: Number(filteredManifest?.incrementalFilter?.duplicateCurrentEpisodeCount || 0),
    candidateEpisodeCount,
    machineAcceptEpisodeCount,
    machineQuarantineEpisodeCount: Number(machineEligibility.counts?.quarantine || 0),
    machineRejectEpisodeCount: Number(machineEligibility.counts?.reject || 0),
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
      approvalCandidateMarkdown: relativeToCwd(candidates.markdownFile),
      machineEligibility: relativeToCwd(machineEligibilityFile)
    },
    invariants: {
      rawInteractionAutoPromotedToStrategyTraining: false,
      privacyBatchAppliedBeforeStrategyCandidate: true,
      previouslyProcessedEpisodesExcludedBeforeReviewPack: true,
      baseDatasetEpisodesExcludedBeforeReviewPack: options.baseDatasetDir ? true : null,
      baseDatasetProvenanceAliasesExcludedBeforeReviewPack: options.baseDatasetDir ? true : null,
      duplicateCurrentEpisodeExportsDeduplicated: true,
      resolverOutputsAreReviewAidsOnly: resolution.result?.policy?.reviewAidOnly === true,
      candidateDigestVerified: true,
      machineEligibilityGateApplied: true,
      machineEligibilityFailClosed: machineEligibility.policy?.failClosed === true,
      machineAcceptedEpisodesAutoTrained: false,
      machineAcceptPathHumanApprovalRequired: false,
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
  return { bundle, bundleFile, markdownFile, candidates, machineEligibility, machineEligibilityFile, outputDir: outDir };
}

function fitCandidateDataset(datasetDir, outputDir, modelVersion) {
  const { loadDataset, evaluateBaselineReadiness } = require('./check_strategy_baseline_readiness.js');
  const { fitBaseline, evaluateHeldOut } = require('./fit_strategy_offline_baseline.js');
  const splits = loadDataset(path.resolve(datasetDir));
  const readiness = evaluateBaselineReadiness(splits);
  if (!readiness.ready) throw new Error(`candidate_baseline_readiness_failed:${readiness.errors.join(',')}`);
  const model = fitBaseline(splits.train, { modelVersion });
  const evaluation = evaluateHeldOut(model, splits.validation, splits.test);
  const outDir = path.resolve(outputDir);
  fs.mkdirSync(outDir, { recursive: true });
  const modelFile = path.join(outDir, 'model.json');
  const evaluationFile = path.join(outDir, 'evaluation.json');
  writeJson(modelFile, model);
  writeJson(evaluationFile, evaluation);
  if (!evaluation.pass) throw new Error('candidate_heldout_evaluation_failed');
  return { model, evaluation, modelFile, evaluationFile, modelHash: sha256File(modelFile) };
}

function finalizeIncrementalStrategyLearning(prepared, options = {}) {
  if (!prepared?.bundle || !prepared?.candidates) throw new Error('prepared_incremental_bundle_required');
  if (!options.baseDatasetDir) throw new Error('interactive_finalize_requires_base_dataset');
  if (!options.baseModelFile) throw new Error('interactive_finalize_requires_base_model');
  if (String(options.confirmationPhrase || '') !== HUMAN_CONFIRMATION_PHRASE) {
    throw new Error('explicit_human_confirmation_phrase_required');
  }
  if (!prepared.bundle.candidateEpisodeCount) throw new Error('no_eligible_strategy_approval_candidates');

  const baseModelFile = path.resolve(options.baseModelFile);
  if (!fs.existsSync(baseModelFile)) throw new Error(`base_model_file_missing:${baseModelFile}`);
  const baseModel = readJson(baseModelFile);
  const baseModelHashBefore = sha256File(baseModelFile);
  const candidateModelVersion = String(options.candidateModelVersion || nextPatchVersion(baseModel?.modelVersion)).trim();
  const outDir = path.resolve(prepared.outputDir || path.dirname(prepared.bundleFile));

  const { applyApprovalCandidates } = require('./apply_strategy_approval_candidates.js');
  const approved = applyApprovalCandidates(
    prepared.candidates.jsonFile,
    path.join(outDir, '08-approved-annotations'),
    {
      confirmDigest: prepared.bundle.digestHash,
      confirmationPhrase: options.confirmationPhrase
    }
  );

  const { buildIncrementalStrategyDataset } = require('./build_incremental_strategy_dataset.js');
  const dataset = buildIncrementalStrategyDataset({
    baseDatasetDir: options.baseDatasetDir,
    packFile: path.resolve(prepared.bundle.stages.reviewPack),
    annotationsDir: path.dirname(approved.receiptFile),
    outputDir: path.join(outDir, '09-incremental-dataset'),
    verificationMode: 'human',
    seed: options.seed || undefined
  });
  const datasetDir = path.join(path.dirname(dataset.manifestFile), 'dataset');
  const candidate = fitCandidateDataset(datasetDir, path.join(outDir, '10-candidate-model'), candidateModelVersion);

  const baseModelHashAfter = sha256File(baseModelFile);
  if (baseModelHashAfter !== baseModelHashBefore) throw new Error('base_model_file_mutated_during_incremental_learning');

  const finalManifest = {
    incrementalStrategyLearningVersion: INCREMENTAL_STRATEGY_LEARNING_VERSION,
    finalizedAt: new Date().toISOString(),
    finalizationMode: 'human-digest-approval',
    status: 'candidate-awaiting-runtime-protection',
    sourceCandidateDigest: prepared.bundle.digestHash,
    approvedEpisodeCount: approved.receipt.approvedEpisodeCount,
    blockedEpisodeCount: prepared.bundle.blockedEpisodeCount,
    machineEligibility: {
      accept: prepared.bundle.machineAcceptEpisodeCount,
      quarantine: prepared.bundle.machineQuarantineEpisodeCount,
      reject: prepared.bundle.machineRejectEpisodeCount,
      autoTrainingApplied: false
    },
    baseDataset: relativeToCwd(options.baseDatasetDir),
    baseModel: {
      file: relativeToCwd(baseModelFile),
      modelVersion: baseModel?.modelVersion || null,
      hashBefore: baseModelHashBefore,
      hashAfter: baseModelHashAfter,
      mutated: false
    },
    candidateModel: {
      file: relativeToCwd(candidate.modelFile),
      evaluationFile: relativeToCwd(candidate.evaluationFile),
      modelVersion: candidate.model.modelVersion,
      sha256: candidate.modelHash,
      heldOutPass: candidate.evaluation.pass === true
    },
    dataset: {
      manifest: relativeToCwd(dataset.manifestFile),
      verificationMode: dataset.manifest.verificationMode,
      combinedRecordCount: dataset.manifest.combinedRecordCount,
      newApprovedEpisodeCount: dataset.manifest.newApprovedEpisodeCount,
      newMachineVerifiedEpisodeCount: dataset.manifest.newMachineVerifiedEpisodeCount,
      splitCounts: dataset.manifest.splitCounts,
      baseSplitAssignmentsPreserved: dataset.manifest.baseSplitAssignmentsPreserved === true
    },
    approval: {
      receipt: relativeToCwd(approved.receiptFile),
      explicitHumanConfirmationVerified: approved.receipt.explicitHumanConfirmationVerified === true
    },
    promotion: {
      applied: false,
      runtimeRegressionPerformed: false,
      freshUnseenPerformed: false,
      reason: 'candidate_must_pass_runtime_regression_and_fresh_unseen_before_manual_promotion'
    }
  };
  const finalManifestFile = writeJson(path.join(outDir, 'incremental-strategy-learning-finalized.json'), finalManifest);
  return { finalManifest, finalManifestFile, approved, dataset, candidate };
}

function finalizeMachineAcceptedStrategyLearning(prepared, options = {}) {
  if (!prepared?.bundle || !prepared?.candidates || !prepared?.machineEligibilityFile) {
    throw new Error('prepared_machine_incremental_bundle_required');
  }
  if (!options.baseDatasetDir) throw new Error('machine_finalize_requires_base_dataset');
  if (!options.baseModelFile) throw new Error('machine_finalize_requires_base_model');
  if (!prepared.bundle.machineAcceptEpisodeCount) throw new Error('no_machine_accepted_strategy_candidates');

  const baseModelFile = path.resolve(options.baseModelFile);
  if (!fs.existsSync(baseModelFile)) throw new Error(`base_model_file_missing:${baseModelFile}`);
  const baseModel = readJson(baseModelFile);
  const baseModelHashBefore = sha256File(baseModelFile);
  const candidateModelVersion = String(options.candidateModelVersion || nextPatchVersion(baseModel?.modelVersion)).trim();
  const outDir = path.resolve(prepared.outputDir || path.dirname(prepared.bundleFile));

  const { applyMachineAcceptedCandidates } = require('./apply_strategy_approval_candidates.js');
  const verified = applyMachineAcceptedCandidates(
    prepared.candidates.jsonFile,
    prepared.machineEligibilityFile,
    path.join(outDir, '08-machine-verified-annotations')
  );

  const { buildIncrementalStrategyDataset } = require('./build_incremental_strategy_dataset.js');
  const dataset = buildIncrementalStrategyDataset({
    baseDatasetDir: options.baseDatasetDir,
    packFile: path.resolve(prepared.bundle.stages.reviewPack),
    annotationsDir: path.dirname(verified.receiptFile),
    outputDir: path.join(outDir, '09-machine-incremental-dataset'),
    verificationMode: 'machine',
    seed: options.seed || undefined
  });
  const datasetDir = path.join(path.dirname(dataset.manifestFile), 'dataset');
  const candidate = fitCandidateDataset(datasetDir, path.join(outDir, '10-machine-candidate-model'), candidateModelVersion);

  const baseModelHashAfter = sha256File(baseModelFile);
  if (baseModelHashAfter !== baseModelHashBefore) throw new Error('base_model_file_mutated_during_machine_incremental_learning');
  if (dataset.manifest.newMachineVerifiedEpisodeCount !== verified.receipt.machineAcceptedEpisodeCount) {
    throw new Error('machine_verified_dataset_count_mismatch');
  }

  const finalManifest = {
    incrementalStrategyLearningVersion: INCREMENTAL_STRATEGY_LEARNING_VERSION,
    finalizedAt: new Date().toISOString(),
    finalizationMode: 'machine-eligibility',
    status: 'candidate-awaiting-runtime-protection',
    sourceCandidateDigest: prepared.bundle.digestHash,
    machineAcceptedEpisodeCount: verified.receipt.machineAcceptedEpisodeCount,
    machineQuarantineEpisodeCount: prepared.bundle.machineQuarantineEpisodeCount,
    machineRejectEpisodeCount: prepared.bundle.machineRejectEpisodeCount,
    blockedEpisodeCount: prepared.bundle.blockedEpisodeCount,
    baseDataset: relativeToCwd(options.baseDatasetDir),
    baseModel: {
      file: relativeToCwd(baseModelFile),
      modelVersion: baseModel?.modelVersion || null,
      hashBefore: baseModelHashBefore,
      hashAfter: baseModelHashAfter,
      mutated: false
    },
    candidateModel: {
      file: relativeToCwd(candidate.modelFile),
      evaluationFile: relativeToCwd(candidate.evaluationFile),
      modelVersion: candidate.model.modelVersion,
      sha256: candidate.modelHash,
      heldOutPass: candidate.evaluation.pass === true
    },
    dataset: {
      manifest: relativeToCwd(dataset.manifestFile),
      verificationMode: dataset.manifest.verificationMode,
      combinedRecordCount: dataset.manifest.combinedRecordCount,
      newVerifiedEpisodeCount: dataset.manifest.newVerifiedEpisodeCount,
      newApprovedEpisodeCount: dataset.manifest.newApprovedEpisodeCount,
      newMachineVerifiedEpisodeCount: dataset.manifest.newMachineVerifiedEpisodeCount,
      splitCounts: dataset.manifest.splitCounts,
      baseSplitAssignmentsPreserved: dataset.manifest.baseSplitAssignmentsPreserved === true
    },
    verification: {
      receipt: relativeToCwd(verified.receiptFile),
      eligibilityFile: relativeToCwd(prepared.machineEligibilityFile),
      eligibilityDigest: verified.receipt.eligibilityDigest,
      explicitHumanConfirmationVerified: false,
      humanApprovalClaimed: false
    },
    promotion: {
      applied: false,
      runtimeRegressionPerformed: false,
      freshUnseenPerformed: false,
      reason: 'candidate_must_pass_runtime_regression_and_fresh_unseen_before_manual_promotion'
    }
  };
  const finalManifestFile = writeJson(path.join(outDir, 'incremental-strategy-learning-machine-finalized.json'), finalManifest);
  return { finalManifest, finalManifestFile, verified, dataset, candidate };
}

function applyCandidateProtectionResult(finalized, protection, options = {}) {
  if (!finalized?.finalManifest || !finalized?.finalManifestFile || !finalized?.candidate?.modelFile) {
    throw new Error('finalized_candidate_bundle_required_for_protection');
  }
  if (!protection || typeof protection !== 'object' || typeof protection.status !== 'string') {
    throw new Error('candidate_protection_result_required');
  }
  const outDir = path.resolve(options.outputDir || path.dirname(finalized.finalManifestFile));
  const protectionFile = writeJson(path.join(outDir, '11-candidate-protection.json'), protection);
  const nativeResults = protection.nativeResults && typeof protection.nativeResults === 'object' ? protection.nativeResults : {};
  const runtimeRegressionPerformed = Object.keys(nativeResults).length > 0;
  const freshUnseenPerformed = protection?.baseBenchmark?.ok === true && protection?.candidateBenchmark?.ok === true;
  const protectedManifest = {
    ...finalized.finalManifest,
    protectedAt: new Date().toISOString(),
    status: protection.status,
    candidateProtection: {
      file: relativeToCwd(protectionFile),
      version: protection.candidateProtectionVersion || null,
      pass: protection.pass === true,
      status: protection.status,
      reasons: Array.isArray(protection.reasons) ? protection.reasons : [],
      baseScore: Number.isFinite(Number(protection.baseScore)) ? Number(protection.baseScore) : null,
      candidateScore: Number.isFinite(Number(protection.candidateScore)) ? Number(protection.candidateScore) : null,
      ambiguitySafeBlockPass: protection.ambiguitySafeBlockPass === true,
      modelIntegrity: protection.modelIntegrity || null
    },
    promotion: {
      applied: false,
      runtimeRegressionPerformed,
      freshUnseenPerformed,
      reason: protection.pass === true
        ? 'candidate_protected_ready_for_manual_promotion_only'
        : protection.status
    }
  };
  writeJson(finalized.finalManifestFile, protectedManifest);
  finalized.finalManifest = protectedManifest;
  return { ...finalized, protection, protectionFile };
}

async function protectFinalizedCandidate(finalized, options = {}) {
  if (!options.baseModelFile) throw new Error('candidate_protection_requires_base_model');
  const runProtection = typeof options.runProtection === 'function'
    ? options.runProtection
    : require('../../control-center/script/native_regression_model_compat.js').runCandidateProtection;
  const protection = await runProtection({
    baseModelFile: options.baseModelFile,
    candidateModelFile: finalized?.candidate?.modelFile,
    agentId: options.agentId || null,
    healthBase: options.healthBase || 'http://127.0.0.1:3000',
    broker: options.broker || 'ws://127.0.0.1:3000',
    timeoutMs: Number(options.timeoutMs || 10000),
    minimumConfidence: options.minimumConfidence == null ? 0 : Number(options.minimumConfidence),
    minimumBenchmarkScore: options.minimumBenchmarkScore == null ? 90 : Number(options.minimumBenchmarkScore),
    allowedTotalRegression: options.allowedTotalRegression == null ? 0 : Number(options.allowedTotalRegression),
    allowedDimensionRegression: options.allowedDimensionRegression == null ? 0 : Number(options.allowedDimensionRegression)
  });
  return applyCandidateProtectionResult(finalized, protection, options);
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

function askConfirmation(message) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, answer => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

async function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    const input = args.input || args.reviews || null;
    if (!input) {
      throw new Error('Usage: node training-collector/tools/prepare_incremental_strategy_learning.js --input <review-dir|review-file|reviews.7z> [--base-dataset dir] [--base-model model.json] [--machine-finalize | --interactive-approve] [--protect-candidate] [--out dir]');
    }
    if (args['protect-candidate'] && !args['machine-finalize'] && !args['interactive-approve']) {
      throw new Error('protect_candidate_requires_finalize_mode');
    }
    const outputDir = path.resolve(args.out || 'training-collector/learning-batches/incremental-latest');
    const inputResolved = resolveReviewInput(input, outputDir, { sevenZipExe: args['7z'] || null });
    const prepared = prepareIncrementalStrategyLearning({
      reviewRoot: inputResolved.reviewRoot,
      rawRoot: args.raw || null,
      baseDatasetDir: args['base-dataset'] || null,
      excludeApprovedDir: args['exclude-approved'] || null,
      excludeEpisodeFile: args['exclude-episodes'] || null,
      outputDir
    });

    const summary = {
      ok: true,
      result: 'PASS',
      version: prepared.bundle.incrementalStrategyLearningVersion,
      status: prepared.bundle.status,
      inputKind: inputResolved.kind,
      inputArchiveHash: inputResolved.archiveHash || null,
      sourceReviewFileCount: prepared.bundle.sourceReviewFileCount,
      retainedReviewFileCount: prepared.bundle.retainedReviewFileCount,
      readyForHumanReviewCount: prepared.bundle.readyForHumanReviewCount,
      excludedPreviouslyProcessedCount: prepared.bundle.excludedPreviouslyProcessedCount,
      duplicateCurrentEpisodeCount: prepared.bundle.duplicateCurrentEpisodeCount,
      candidateEpisodeCount: prepared.bundle.candidateEpisodeCount,
      machineAcceptEpisodeCount: prepared.bundle.machineAcceptEpisodeCount,
      machineQuarantineEpisodeCount: prepared.bundle.machineQuarantineEpisodeCount,
      machineRejectEpisodeCount: prepared.bundle.machineRejectEpisodeCount,
      machineFinalizationAvailable: prepared.bundle.machineFinalizationAvailable,
      blockedEpisodeCount: prepared.bundle.blockedEpisodeCount,
      unresolvedHumanReviewCount: prepared.bundle.unresolvedHumanReviewCount,
      digestHash: prepared.bundle.digestHash,
      manifest: path.resolve(prepared.bundleFile),
      review: path.resolve(prepared.markdownFile),
      approvalCandidates: path.resolve(prepared.candidates.jsonFile),
      machineEligibility: path.resolve(prepared.machineEligibilityFile)
    };

    if (args['machine-finalize']) {
      if (!args['base-dataset'] || !args['base-model']) {
        throw new Error('machine_finalize_requires_--base-dataset_and_--base-model');
      }
      let finalized = finalizeMachineAcceptedStrategyLearning(prepared, {
        baseDatasetDir: args['base-dataset'],
        baseModelFile: args['base-model'],
        candidateModelVersion: args['candidate-model-version'] || null,
        seed: args.seed || null
      });
      if (args['protect-candidate']) {
        finalized = await protectFinalizedCandidate(finalized, {
          baseModelFile: args['base-model'],
          outputDir,
          agentId: args.agent || null,
          healthBase: args['health-base'] || 'http://127.0.0.1:3000',
          broker: args.broker || 'ws://127.0.0.1:3000',
          timeoutMs: Number(args.timeout || 10000),
          minimumConfidence: args['minimum-confidence'] == null ? 0 : Number(args['minimum-confidence']),
          minimumBenchmarkScore: args['minimum-benchmark-score'] == null ? 90 : Number(args['minimum-benchmark-score']),
          allowedTotalRegression: args['allowed-total-regression'] == null ? 0 : Number(args['allowed-total-regression']),
          allowedDimensionRegression: args['allowed-dimension-regression'] == null ? 0 : Number(args['allowed-dimension-regression'])
        });
      }
      console.log(JSON.stringify({
        ...summary,
        status: finalized.finalManifest.status,
        finalizationMode: finalized.finalManifest.finalizationMode,
        machineAcceptedEpisodeCount: finalized.finalManifest.machineAcceptedEpisodeCount,
        candidateModelVersion: finalized.finalManifest.candidateModel.modelVersion,
        candidateModel: path.resolve(finalized.candidate.modelFile),
        candidateModelSha256: finalized.finalManifest.candidateModel.sha256,
        datasetManifest: path.resolve(finalized.dataset.manifestFile),
        candidateProtection: finalized.protection ? {
          pass: finalized.protection.pass === true,
          status: finalized.protection.status,
          reasons: finalized.protection.reasons || [],
          resultFile: path.resolve(finalized.protectionFile)
        } : null,
        humanApprovalClaimed: false,
        baseModelMutated: finalized.finalManifest.baseModel.mutated,
        promotionApplied: finalized.finalManifest.promotion.applied,
        finalManifest: path.resolve(finalized.finalManifestFile)
      }, null, 2));
      return;
    }

    if (!args['interactive-approve']) {
      console.log(JSON.stringify({
        ...summary,
        autoTrainEligible: prepared.bundle.invariants.autoTrainEligible,
        approvalApplied: false,
        datasetBuilt: false,
        trainingPerformed: false
      }, null, 2));
      return;
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error('interactive_approval_requires_tty');
    }
    if (!args['base-dataset'] || !args['base-model']) {
      throw new Error('interactive_approval_requires_--base-dataset_and_--base-model');
    }

    console.log(JSON.stringify(summary, null, 2));
    console.log(`\nReview candidate digest: ${path.resolve(prepared.candidates.markdownFile)}`);
    console.log(`Eligible episodes: ${prepared.bundle.candidateEpisodeCount}; machine ACCEPT: ${prepared.bundle.machineAcceptEpisodeCount}; QUARANTINE: ${prepared.bundle.machineQuarantineEpisodeCount}; REJECT: ${prepared.bundle.machineRejectEpisodeCount}`);
    console.log('No production model will be overwritten. A new candidate model will be written under the output directory.');
    const confirmation = await askConfirmation(`\nAfter reviewing the digest, type exactly ${HUMAN_CONFIRMATION_PHRASE} to approve this batch: `);
    if (confirmation !== HUMAN_CONFIRMATION_PHRASE) throw new Error('human_approval_not_confirmed');

    let finalized = finalizeIncrementalStrategyLearning(prepared, {
      baseDatasetDir: args['base-dataset'],
      baseModelFile: args['base-model'],
      candidateModelVersion: args['candidate-model-version'] || null,
      seed: args.seed || null,
      confirmationPhrase: confirmation
    });
    if (args['protect-candidate']) {
      finalized = await protectFinalizedCandidate(finalized, {
        baseModelFile: args['base-model'],
        outputDir,
        agentId: args.agent || null,
        healthBase: args['health-base'] || 'http://127.0.0.1:3000',
        broker: args.broker || 'ws://127.0.0.1:3000',
        timeoutMs: Number(args.timeout || 10000),
        minimumConfidence: args['minimum-confidence'] == null ? 0 : Number(args['minimum-confidence']),
        minimumBenchmarkScore: args['minimum-benchmark-score'] == null ? 90 : Number(args['minimum-benchmark-score']),
        allowedTotalRegression: args['allowed-total-regression'] == null ? 0 : Number(args['allowed-total-regression']),
        allowedDimensionRegression: args['allowed-dimension-regression'] == null ? 0 : Number(args['allowed-dimension-regression'])
      });
    }
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      status: finalized.finalManifest.status,
      finalizationMode: finalized.finalManifest.finalizationMode,
      approvedEpisodeCount: finalized.finalManifest.approvedEpisodeCount,
      candidateModelVersion: finalized.finalManifest.candidateModel.modelVersion,
      candidateModel: path.resolve(finalized.candidate.modelFile),
      candidateModelSha256: finalized.finalManifest.candidateModel.sha256,
      datasetManifest: path.resolve(finalized.dataset.manifestFile),
      candidateProtection: finalized.protection ? {
        pass: finalized.protection.pass === true,
        status: finalized.protection.status,
        reasons: finalized.protection.reasons || [],
        resultFile: path.resolve(finalized.protectionFile)
      } : null,
      baseModelMutated: finalized.finalManifest.baseModel.mutated,
      promotionApplied: finalized.finalManifest.promotion.applied,
      finalManifest: path.resolve(finalized.finalManifestFile)
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  INCREMENTAL_STRATEGY_LEARNING_VERSION,
  BASE_DATASET_SPLITS,
  readJson,
  writeJson,
  sha256File,
  normalizeEpisodeId,
  collectApprovedEpisodeIds,
  episodeIdsFromValue,
  collectEpisodeIdsFromFile,
  collectBaseDatasetEpisodeIds,
  combinedExcludedEpisodeIds,
  filterLearningManifest,
  forbiddenTrainingModulesImported,
  executableCandidates,
  findSevenZipExecutable,
  extractReviewArchive,
  resolveReviewInput,
  nextPatchVersion,
  markdownForBundle,
  prepareIncrementalStrategyLearning,
  fitCandidateDataset,
  finalizeIncrementalStrategyLearning,
  finalizeMachineAcceptedStrategyLearning,
  applyCandidateProtectionResult,
  protectFinalizedCandidate,
  parseArgs,
  askConfirmation,
  main
};
