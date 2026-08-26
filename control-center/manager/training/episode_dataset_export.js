'use strict';

const crypto = require('crypto');
const CONTRACT = require('../../EPISODE_OUTCOME_DATASET_CONTRACT.json');
const {
  DATASET_CONTRACT_VERSION,
  validateDataset
} = require('./episode_outcome_dataset.js');

const EXPORT_VERSION = '0.1.0';
const SPLIT_POLICY = CONTRACT.splitPolicy || {};
const READINESS_POLICY = CONTRACT.datasetReadiness || {};
const EVALUATION_SOURCES = new Set(
  CONTRACT.trainingPolicy?.eligibleEvaluationSources ||
  CONTRACT.trainingPolicy?.eligibleLabelSources ||
  []
);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function normalizeRatios(input = {}) {
  const defaults = SPLIT_POLICY.defaultRatios || { train: 0.8, validation: 0.1, test: 0.1 };
  const raw = {
    train: Number(input.train ?? defaults.train),
    validation: Number(input.validation ?? defaults.validation),
    test: Number(input.test ?? defaults.test)
  };
  for (const [name, value] of Object.entries(raw)) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`split ratio ${name} must be > 0`);
  }
  const total = raw.train + raw.validation + raw.test;
  return {
    train: raw.train / total,
    validation: raw.validation / total,
    test: raw.test / total
  };
}

function stableGroupHash(group, seed) {
  return crypto.createHash('sha256').update(`${seed}\u0000${group}`, 'utf8').digest('hex');
}

function groupRecords(records) {
  const groups = new Map();
  records.forEach((record, index) => {
    const group = requireString(record?.splitGroup, `records[${index}].splitGroup`);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(index);
  });
  return groups;
}

function splitGroupCounts(groupCount, ratios) {
  const minimumGroups = Number(SPLIT_POLICY.minimumDistinctGroups || 3);
  if (!Number.isInteger(groupCount) || groupCount < minimumGroups) {
    throw new Error(`at least ${minimumGroups} distinct splitGroup values are required`);
  }

  let validation = Math.max(1, Math.floor(groupCount * ratios.validation));
  let test = Math.max(1, Math.floor(groupCount * ratios.test));
  let train = groupCount - validation - test;

  if (train < 1) {
    validation = 1;
    test = 1;
    train = groupCount - 2;
  }
  if (train < 1) throw new Error('split assignment must leave at least one train group');
  return { train, validation, test };
}

function assignDeterministicSplits(records = [], options = {}) {
  if (!Array.isArray(records) || records.length === 0) throw new Error('non-empty records array required');

  const preflight = validateDataset(records);
  if (!preflight.ok) {
    const first = preflight.errors[0]?.error || 'unknown validation error';
    throw new Error(`dataset invalid before split assignment: ${first}`);
  }

  if (SPLIT_POLICY.automaticAssignmentRequiresAllInputRecordsUnassigned !== false) {
    const assigned = preflight.records.find(record => record.split !== 'unassigned');
    if (assigned) throw new Error('automatic split assignment requires all records to be unassigned');
  }

  const ratios = normalizeRatios(options.ratios || {});
  const seed = requireString(options.seed || SPLIT_POLICY.defaultSeed || 'strategy-episode-v0', 'split seed');
  const groups = groupRecords(preflight.records);
  const counts = splitGroupCounts(groups.size, ratios);
  const orderedGroups = Array.from(groups.keys())
    .map(group => ({ group, hash: stableGroupHash(group, seed) }))
    .sort((a, b) => a.hash.localeCompare(b.hash) || a.group.localeCompare(b.group));

  const splitByGroup = new Map();
  let cursor = 0;
  for (let i = 0; i < counts.test; i += 1) splitByGroup.set(orderedGroups[cursor++].group, 'test');
  for (let i = 0; i < counts.validation; i += 1) splitByGroup.set(orderedGroups[cursor++].group, 'validation');
  while (cursor < orderedGroups.length) splitByGroup.set(orderedGroups[cursor++].group, 'train');

  const assignedRecords = records.map(record => ({
    ...record,
    split: splitByGroup.get(String(record.splitGroup))
  }));
  const validation = validateDataset(assignedRecords);
  if (!validation.ok) {
    const first = validation.errors[0]?.error || 'unknown validation error';
    throw new Error(`dataset invalid after split assignment: ${first}`);
  }

  return {
    seed,
    ratios,
    groupCounts: counts,
    assignments: Object.fromEntries(Array.from(splitByGroup.entries()).sort((a, b) => a[0].localeCompare(b[0]))),
    records: assignedRecords,
    validation
  };
}

function trustedForHeldOut(record) {
  return (
    EVALUATION_SOURCES.has(record?.source?.kind) &&
    record?.source?.labelVerified === true &&
    record?.source?.outcomeVerified === true &&
    record?.terminalResult?.verified === true &&
    record?.privacy?.redacted === true &&
    record?.privacy?.credentialsExcluded === true &&
    record?.privacy?.secretsExcluded === true
  );
}

function evaluateDatasetReadiness(datasetResult) {
  const reasons = [];
  if (!datasetResult || datasetResult.ok !== true || !Array.isArray(datasetResult.records)) {
    return {
      ready: false,
      reasons: ['validated_dataset_required'],
      summary: datasetResult?.summary || null
    };
  }

  const summary = datasetResult.summary || {};
  const splitCounts = summary.splitCounts || {};
  if (READINESS_POLICY.requiresNoInvalidRecords !== false && Number(summary.invalid || 0) !== 0) {
    reasons.push('invalid_records_present');
  }
  if (READINESS_POLICY.requiresNoUnassignedRecords !== false && Number(splitCounts.unassigned || 0) !== 0) {
    reasons.push('unassigned_records_present');
  }
  if (READINESS_POLICY.requiresTrainValidationTestCoverage !== false) {
    if (Number(splitCounts.train || 0) < 1) reasons.push('train_split_missing');
    if (Number(splitCounts.validation || 0) < 1) reasons.push('validation_split_missing');
    if (Number(splitCounts.test || 0) < 1) reasons.push('test_split_missing');
  }
  if (READINESS_POLICY.requiresAtLeastOneTrainingEligibleTrainRecord !== false && Number(summary.trainingEligible || 0) < 1) {
    reasons.push('no_training_eligible_train_record');
  }

  if (READINESS_POLICY.requiresTrustedVerifiedLabelsAcrossAllAssignedSplits !== false) {
    for (const record of datasetResult.records) {
      if (record.split === 'unassigned') continue;
      if (!trustedForHeldOut(record)) reasons.push(`untrusted_or_unverified_record:${record.episodeId}`);
    }
  }

  const seen = new Map();
  for (const record of datasetResult.records) {
    if (record.split === 'unassigned') continue;
    const previous = seen.get(record.splitGroup);
    if (previous && previous !== record.split) reasons.push(`split_group_leakage:${record.splitGroup}`);
    seen.set(record.splitGroup, record.split);
  }

  return {
    ready: reasons.length === 0,
    reasons: Array.from(new Set(reasons)),
    summary
  };
}

function jsonl(records) {
  return records.map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '');
}

function buildOfflineBaselinePackage(datasetResult, options = {}) {
  const readiness = evaluateDatasetReadiness(datasetResult);
  if (!readiness.ready) throw new Error(`dataset not ready for offline baseline: ${readiness.reasons.join(', ')}`);

  const train = datasetResult.records.filter(record => (
    record.split === 'train' && record.trainingEligibility?.eligible === true
  ));
  const validation = datasetResult.records.filter(record => record.split === 'validation');
  const test = datasetResult.records.filter(record => record.split === 'test');

  if (!train.length) throw new Error('training export would be empty');
  if (!validation.length || !test.length) throw new Error('held-out exports must be non-empty');

  const manifest = {
    exportVersion: EXPORT_VERSION,
    datasetContractVersion: DATASET_CONTRACT_VERSION,
    purpose: 'strategy-baseline-offline-fit-and-heldout-evaluation',
    createdAt: options.createdAt || null,
    splitCounts: {
      train: train.length,
      validation: validation.length,
      test: test.length
    },
    episodeIds: {
      train: train.map(record => record.episodeId),
      validation: validation.map(record => record.episodeId),
      test: test.map(record => record.episodeId)
    }
  };

  return {
    exportVersion: EXPORT_VERSION,
    readiness,
    manifest,
    train,
    validation,
    test,
    trainJsonl: jsonl(train),
    validationJsonl: jsonl(validation),
    testJsonl: jsonl(test)
  };
}

module.exports = {
  EXPORT_VERSION,
  normalizeRatios,
  stableGroupHash,
  splitGroupCounts,
  assignDeterministicSplits,
  trustedForHeldOut,
  evaluateDatasetReadiness,
  buildOfflineBaselinePackage,
  jsonl
};
