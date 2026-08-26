'use strict';

const fs = require('fs');
const path = require('path');
const {
  adaptHumanReviewToStrategyEpisode
} = require('../../control-center/manager/training/human_strategy_episode_adapter.js');

function readJson(filePath, name) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} JSON object required`);
  return value;
}

function defaultOutputPath(reviewPath) {
  const parsed = path.parse(path.resolve(reviewPath));
  return path.join(parsed.dir, `${parsed.name}.strategy-episode.json`);
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { review: null, annotation: null, output: null };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--annotation') args.annotation = argv[++i];
    else if (value === '--output') args.output = argv[++i];
    else if (!args.review) args.review = value;
    else throw new Error(`unexpected argument: ${value}`);
  }
  if (!args.review || !args.annotation) {
    throw new Error('Usage: node training-collector/tools/adapt_task_episode_review.js <task-episode-review.json> --annotation <strategy-review.json> [--output file]');
  }
  return args;
}

function adaptFiles(reviewPath, annotationPath, options = {}) {
  const reviewExport = readJson(reviewPath, 'review export');
  const annotation = readJson(annotationPath, 'annotation');
  return adaptHumanReviewToStrategyEpisode(reviewExport, annotation, options);
}

function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    const result = adaptFiles(args.review, args.annotation);
    const output = path.resolve(args.output || defaultOutputPath(args.review));
    fs.writeFileSync(output, `${JSON.stringify(result.record, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      episodeId: result.record.episodeId,
      sourceKind: result.record.source.kind,
      stepCount: result.record.steps.length,
      terminalStatus: result.record.terminalResult.status,
      split: result.record.split,
      trainingEligible: result.record.trainingEligibility.eligible,
      trainingEligibilityReasons: result.record.trainingEligibility.reasons,
      output
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  readJson,
  defaultOutputPath,
  parseArgs,
  adaptFiles,
  main
};
