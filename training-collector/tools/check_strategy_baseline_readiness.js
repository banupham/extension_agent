'use strict';

const fs = require('fs');
const path = require('path');

function die(message) {
  throw new Error(message);
}

function readJsonl(file) {
  if (!fs.existsSync(file)) die(`missing_dataset_file: ${file}`);
  const text = fs.readFileSync(file, 'utf8').trim();
  if (!text) return [];
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${file}:${index + 1}: ${error.message || error}`);
    }
  });
}

function recordActionTypes(record) {
  const out = new Set();
  for (const step of record?.steps || []) {
    const type = String(step?.action?.type || '').trim();
    if (type) out.add(type);
  }
  return [...out];
}

function actionCounts(records) {
  const counts = {};
  for (const record of records) {
    for (const type of recordActionTypes(record)) counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

function actionGroupCoverage(splits) {
  const coverage = {};
  for (const [split, records] of Object.entries(splits)) {
    for (const record of records) {
      const group = String(record?.splitGroup || '').trim() || '<missing>';
      for (const type of recordActionTypes(record)) {
        if (!coverage[type]) coverage[type] = { train: new Set(), validation: new Set(), test: new Set(), all: new Set() };
        coverage[type][split].add(group);
        coverage[type].all.add(group);
      }
    }
  }
  const out = {};
  for (const [type, value] of Object.entries(coverage)) {
    out[type] = {
      trainGroups: [...value.train].sort(),
      validationGroups: [...value.validation].sort(),
      testGroups: [...value.test].sort(),
      distinctSplitGroups: value.all.size,
      recommendedMinimumSplitGroups: 3
    };
  }
  return out;
}

function evaluateBaselineReadiness(splits) {
  const trainTypes = new Set(Object.keys(actionCounts(splits.train)));
  const validationTypes = new Set(Object.keys(actionCounts(splits.validation)));
  const testTypes = new Set(Object.keys(actionCounts(splits.test)));
  const unseenValidation = [...validationTypes].filter(type => !trainTypes.has(type)).sort();
  const unseenTest = [...testTypes].filter(type => !trainTypes.has(type)).sort();
  const emptySplits = Object.entries(splits).filter(([, records]) => records.length === 0).map(([name]) => name);
  const groupCoverage = actionGroupCoverage(splits);
  const lowGroupCoverage = Object.entries(groupCoverage)
    .filter(([, value]) => value.distinctSplitGroups < 3)
    .map(([type, value]) => ({ actionType: type, distinctSplitGroups: value.distinctSplitGroups }));

  const errors = [];
  if (emptySplits.length) errors.push(`empty_splits:${emptySplits.join(',')}`);
  if (unseenValidation.length) errors.push(`validation_action_types_unseen_in_train:${unseenValidation.join(',')}`);
  if (unseenTest.length) errors.push(`test_action_types_unseen_in_train:${unseenTest.join(',')}`);

  return {
    ready: errors.length === 0,
    errors,
    counts: {
      trainRecords: splits.train.length,
      validationRecords: splits.validation.length,
      testRecords: splits.test.length,
      trainActions: actionCounts(splits.train),
      validationActions: actionCounts(splits.validation),
      testActions: actionCounts(splits.test)
    },
    unseenHeldOutActionTypes: {
      validation: unseenValidation,
      test: unseenTest
    },
    actionGroupCoverage: groupCoverage,
    lowGroupCoverage
  };
}

function loadDataset(datasetDir) {
  const dir = path.resolve(datasetDir);
  return {
    train: readJsonl(path.join(dir, 'train.jsonl')),
    validation: readJsonl(path.join(dir, 'validation.jsonl')),
    test: readJsonl(path.join(dir, 'test.jsonl'))
  };
}

function main(argv = process.argv.slice(2)) {
  try {
    if (argv.length !== 1) die('Usage: node training-collector/tools/check_strategy_baseline_readiness.js <dataset-dir>');
    const datasetDir = path.resolve(argv[0]);
    const result = evaluateBaselineReadiness(loadDataset(datasetDir));
    console.log(JSON.stringify({
      ok: result.ready,
      result: result.ready ? 'PASS' : 'FAIL',
      gate: 'offline-strategy-baseline-readiness',
      datasetDir,
      ...result
    }, null, 2));
    if (!result.ready) process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  readJsonl,
  recordActionTypes,
  actionCounts,
  actionGroupCoverage,
  evaluateBaselineReadiness,
  loadDataset
};
