'use strict';

const fs = require('fs');
const path = require('path');

const FORBIDDEN_KEYS = new Set([
  'selector',
  'selectors',
  'selectorcandidates',
  'tabid',
  'cdpplan',
  'cdppacket',
  'rawcdp',
  'password',
  'cookie',
  'cookies',
  'authorization',
  'accesstoken',
  'refreshtoken',
  'clipboard',
  'paymentsecret',
  'privatereasoning',
  'chainofthought',
  'point'
]);

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function scanForbiddenKeys(value, current = '$', hits = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenKeys(item, `${current}[${index}]`, hits));
    return hits;
  }
  if (!isObject(value)) return hits;
  for (const [key, child] of Object.entries(value)) {
    const next = `${current}.${key}`;
    if (FORBIDDEN_KEYS.has(String(key).toLowerCase())) hits.push(next);
    scanForbiddenKeys(child, next, hits);
  }
  return hits;
}

function validateStrategyObservation(observation, name) {
  const errors = [];
  if (!isObject(observation)) return [`${name} missing`];
  if (observation.privacy?.redacted !== true) errors.push(`${name}.privacy.redacted must be true`);
  if (observation.privacy?.selectorsStored !== false) errors.push(`${name}.privacy.selectorsStored must be false`);
  if (observation.privacy?.tabIdStored !== false) errors.push(`${name}.privacy.tabIdStored must be false`);
  if (typeof observation.url === 'string' && (observation.url.includes('?') || observation.url.includes('#'))) {
    errors.push(`${name}.url must not contain query values or fragment`);
  }
  return errors;
}

function checkReviewExport(record) {
  const errors = [];
  if (!isObject(record)) return { ok: false, errors: ['review export must be an object'], summary: null };
  if (record.reviewExportVersion !== '0.1.0') errors.push('reviewExportVersion must be 0.1.0');
  if (!record.episodeId || typeof record.episodeId !== 'string') errors.push('episodeId required');
  if (!Array.isArray(record.transitions) || record.transitions.length === 0) errors.push('at least one transition required');
  if (record.strategyReady !== true) errors.push('strategyReady must be true');
  if (record.privacy?.selectorsExported !== false) errors.push('privacy.selectorsExported must be false');
  if (record.privacy?.tabIdExported !== false) errors.push('privacy.tabIdExported must be false');
  if (record.privacy?.rawActionCoordinatesExported !== false) errors.push('privacy.rawActionCoordinatesExported must be false');
  if (record.trainingEligibility?.eligible !== false) errors.push('review source must not be training eligible');

  const requiredReasons = new Set([
    'human_review_required',
    'semantic_agent_action_labels_required',
    'outcome_progress_review_required',
    'split_assignment_required'
  ]);
  const actualReasons = new Set(Array.isArray(record.trainingEligibility?.reasons) ? record.trainingEligibility.reasons : []);
  for (const reason of requiredReasons) {
    if (!actualReasons.has(reason)) errors.push(`trainingEligibility missing reason: ${reason}`);
  }

  (record.transitions || []).forEach((transition, index) => {
    if (transition?.status !== 'complete') errors.push(`transitions[${index}].status must be complete`);
    if (!transition?.transitionId) errors.push(`transitions[${index}].transitionId required`);
    if (transition?.outcome?.partial !== false) errors.push(`transitions[${index}].outcome.partial must be false`);
    errors.push(...validateStrategyObservation(transition?.strategyObservationBefore, `transitions[${index}].strategyObservationBefore`));
    errors.push(...validateStrategyObservation(transition?.strategyObservationAfter, `transitions[${index}].strategyObservationAfter`));
  });

  const forbidden = scanForbiddenKeys(record);
  if (forbidden.length) errors.push(`forbidden fields present: ${forbidden.join(', ')}`);

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      reviewExportVersion: record.reviewExportVersion || null,
      episodeSchemaVersion: record.episodeSchemaVersion || null,
      episodeId: record.episodeId || null,
      transitionCount: Array.isArray(record.transitions) ? record.transitions.length : 0,
      finalOutcomeStatus: record.finalOutcome?.status || null,
      strategyReady: record.strategyReady === true,
      trainingEligible: record.trainingEligibility?.eligible === true,
      privacy: {
        selectorsExported: record.privacy?.selectorsExported,
        tabIdExported: record.privacy?.tabIdExported,
        rawActionCoordinatesExported: record.privacy?.rawActionCoordinatesExported
      },
      forbiddenFieldCount: forbidden.length
    }
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main(argv = process.argv.slice(2)) {
  const file = argv[0];
  if (!file) {
    console.error(JSON.stringify({
      ok: false,
      result: 'FAIL',
      error: 'Usage: node training-collector/tools/check_task_episode_review.js <task-episode-review.json>'
    }, null, 2));
    process.exitCode = 1;
    return;
  }
  try {
    const resolved = path.resolve(file);
    const result = checkReviewExport(readJson(resolved));
    console.log(JSON.stringify({
      ok: result.ok,
      gate: 'task-episode-review-file',
      result: result.ok ? 'PASS' : 'FAIL',
      file: resolved,
      summary: result.summary,
      errors: result.errors
    }, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      gate: 'task-episode-review-file',
      result: 'ERROR',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  FORBIDDEN_KEYS,
  scanForbiddenKeys,
  validateStrategyObservation,
  checkReviewExport,
  readJson,
  main
};
