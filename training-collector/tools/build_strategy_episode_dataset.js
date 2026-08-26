'use strict';

const fs = require('fs');
const path = require('path');
const {
  validateDataset
} = require('../../control-center/manager/training/episode_outcome_dataset.js');
const {
  assignDeterministicSplits,
  buildOfflineBaselinePackage
} = require('../../control-center/manager/training/episode_dataset_export.js');

function parseJsonRecords(text, sourceName = '<input>') {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    const value = JSON.parse(trimmed);
    if (!Array.isArray(value)) throw new Error(`${sourceName}: JSON array expected`);
    return value;
  }
  if (trimmed.startsWith('{') && !trimmed.includes('\n')) {
    const value = JSON.parse(trimmed);
    if (Array.isArray(value?.records)) return value.records;
    return [value];
  }

  const rows = [];
  for (const [index, line] of trimmed.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`${sourceName}:${index + 1}: ${error.message || error}`);
    }
  }
  return rows;
}

function readRecordFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return parseJsonRecords(text, filePath);
}

function recordFilesInDirectory(dirPath) {
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(?:json|jsonl)$/i.test(entry.name))
    .map(entry => path.join(dirPath, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function readRecords(inputPath) {
  const resolved = path.resolve(inputPath);
  const stat = fs.statSync(resolved);
  if (stat.isFile()) return { files: [resolved], records: readRecordFile(resolved) };
  if (!stat.isDirectory()) throw new Error('input must be a JSON/JSONL file or directory');
  const files = recordFilesInDirectory(resolved);
  if (!files.length) throw new Error('input directory contains no .json or .jsonl files');
  return {
    files,
    records: files.flatMap(file => readRecordFile(file))
  };
}

function splitState(records) {
  let assigned = 0;
  let unassigned = 0;
  for (const record of records) {
    const split = String(record?.split || 'unassigned');
    if (split === 'unassigned') unassigned += 1;
    else assigned += 1;
  }
  if (assigned && unassigned) return 'mixed';
  if (assigned) return 'assigned';
  return 'unassigned';
}

function buildDatasetFromRecords(records, options = {}) {
  if (!Array.isArray(records) || !records.length) throw new Error('non-empty episode records required');
  const state = splitState(records);
  if (state === 'mixed') throw new Error('dataset must not mix assigned and unassigned split records');

  let validation;
  let splitAssignment = null;
  if (state === 'unassigned') {
    splitAssignment = assignDeterministicSplits(records, {
      seed: options.seed,
      ratios: options.ratios
    });
    validation = splitAssignment.validation;
  } else {
    validation = validateDataset(records);
  }

  if (!validation.ok) {
    const details = validation.errors.map(item => `${item.index}:${item.error}`).join('; ');
    throw new Error(`dataset validation failed: ${details}`);
  }

  const pkg = buildOfflineBaselinePackage(validation, {
    createdAt: options.createdAt || new Date().toISOString()
  });
  return { state, validation, splitAssignment, package: pkg };
}

function safeWrite(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeDatasetPackage(outputDir, result, metadata = {}) {
  const dir = path.resolve(outputDir);
  fs.mkdirSync(dir, { recursive: true });
  const pkg = result.package;
  safeWrite(path.join(dir, 'train.jsonl'), pkg.trainJsonl);
  safeWrite(path.join(dir, 'validation.jsonl'), pkg.validationJsonl);
  safeWrite(path.join(dir, 'test.jsonl'), pkg.testJsonl);

  const manifest = {
    ...pkg.manifest,
    inputFiles: Array.isArray(metadata.inputFiles) ? metadata.inputFiles.map(file => path.resolve(file)) : [],
    splitAssignment: result.splitAssignment
      ? {
          seed: result.splitAssignment.seed,
          ratios: result.splitAssignment.ratios,
          groupCounts: result.splitAssignment.groupCounts,
          assignments: result.splitAssignment.assignments
        }
      : null
  };
  safeWrite(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    outputDir: dir,
    files: {
      train: path.join(dir, 'train.jsonl'),
      validation: path.join(dir, 'validation.jsonl'),
      test: path.join(dir, 'test.jsonl'),
      manifest: path.join(dir, 'manifest.json')
    },
    manifest
  };
}

function defaultOutputDir(inputPath) {
  const resolved = path.resolve(inputPath);
  const base = fs.statSync(resolved).isDirectory()
    ? path.basename(resolved)
    : path.basename(resolved).replace(/\.(?:json|jsonl)$/i, '');
  return path.resolve('training-collector', 'strategy-data', `${base}.strategy-v01`);
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { input: null, output: null, seed: null };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--output') args.output = argv[++i];
    else if (value === '--seed') args.seed = argv[++i];
    else if (!args.input) args.input = value;
    else throw new Error(`unexpected argument: ${value}`);
  }
  if (!args.input) {
    throw new Error('Usage: node training-collector/tools/build_strategy_episode_dataset.js <episodes.json|jsonl|dir> [--output dir] [--seed value]');
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    const loaded = readRecords(args.input);
    const result = buildDatasetFromRecords(loaded.records, { seed: args.seed || undefined });
    const written = writeDatasetPackage(args.output || defaultOutputDir(args.input), result, {
      inputFiles: loaded.files
    });
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      inputRecords: loaded.records.length,
      splitState: result.state,
      splitCounts: result.package.manifest.splitCounts,
      trainingRecords: result.package.train.length,
      heldOutValidationRecords: result.package.validation.length,
      heldOutTestRecords: result.package.test.length,
      outputDir: written.outputDir,
      files: written.files
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      result: 'FAIL',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  parseJsonRecords,
  readRecordFile,
  recordFilesInDirectory,
  readRecords,
  splitState,
  buildDatasetFromRecords,
  writeDatasetPackage,
  defaultOutputDir,
  parseArgs,
  main
};
