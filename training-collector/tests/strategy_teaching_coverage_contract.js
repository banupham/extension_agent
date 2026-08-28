'use strict';

const assert = require('assert');
const {
  stableGroupHash,
  splitGroupCounts,
  normalizeRatios
} = require('../../control-center/manager/training/episode_dataset_export.js');
const {
  evaluateBaselineReadiness
} = require('../tools/check_strategy_baseline_readiness.js');
const {
  strategyTeachingFixtureHtml,
  DEFAULT_PORT
} = require('../../control-center/script/teaching_lab_server.js');

const GROUPS = [
  { splitGroup: 'semantic-sequence:click:gmail', actionTypes: ['click'] },
  { splitGroup: 'semantic-sequence:typeText:google-search>submit:google-search', actionTypes: ['typeText', 'submit'] },
  { splitGroup: 'semantic-sequence:click:mission-atlas>click:mission-orion', actionTypes: ['click'] },
  { splitGroup: 'semantic-sequence:typeText:topic-search>submit:topic-search', actionTypes: ['typeText', 'submit'] },
  { splitGroup: 'semantic-sequence:typeText:message-composer>submit:message-composer', actionTypes: ['typeText', 'submit'] },
  { splitGroup: 'semantic-sequence:click:teaching-confirm', actionTypes: ['click'] }
];

function assignGroups(seed) {
  const ratios = normalizeRatios();
  const counts = splitGroupCounts(GROUPS.length, ratios);
  const ordered = GROUPS
    .map(group => ({ ...group, hash: stableGroupHash(group.splitGroup, seed) }))
    .sort((a, b) => a.hash.localeCompare(b.hash) || a.splitGroup.localeCompare(b.splitGroup));
  const splits = { train: [], validation: [], test: [] };
  let cursor = 0;
  for (let i = 0; i < counts.test; i += 1) splits.test.push(ordered[cursor++]);
  for (let i = 0; i < counts.validation; i += 1) splits.validation.push(ordered[cursor++]);
  while (cursor < ordered.length) splits.train.push(ordered[cursor++]);
  return { counts, splits };
}

function readinessRecords(groups) {
  return groups.map((group, index) => ({
    episodeId: `${group.splitGroup}:${index}`,
    splitGroup: group.splitGroup,
    steps: group.actionTypes.map(type => ({ action: { type } }))
  }));
}

function main() {
  const html = strategyTeachingFixtureHtml();
  assert.equal(DEFAULT_PORT, 8791);
  assert.ok(html.includes('aria-label="Topic Search"'));
  assert.ok(html.includes('aria-label="Message Composer"'));
  assert.ok(html.includes('aria-label="Teaching Confirm"'));

  for (let i = 0; i < 100; i += 1) {
    const { counts, splits } = assignGroups(`strategy-teaching-coverage-${i}`);
    assert.deepEqual(counts, { train: 4, validation: 1, test: 1 });
    const readiness = evaluateBaselineReadiness({
      train: readinessRecords(splits.train),
      validation: readinessRecords(splits.validation),
      test: readinessRecords(splits.test)
    });
    assert.equal(readiness.ready, true, `${i}: ${readiness.errors.join(',')}`);
    assert.deepEqual(readiness.unseenHeldOutActionTypes.validation, []);
    assert.deepEqual(readiness.unseenHeldOutActionTypes.test, []);
  }

  console.log('Strategy teaching coverage contract: PASS');
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error('Strategy teaching coverage contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { GROUPS, assignGroups, readinessRecords, main };
