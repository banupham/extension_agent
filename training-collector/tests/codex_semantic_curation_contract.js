'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { curate } = require('../tools/apply_codex_semantic_curation.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-curation-'));
const reviewFile = path.join(dir, 'review.json');
const packFile = path.join(dir, 'pack.json');
const planFile = path.join(dir, 'plan.json');
const outFile = path.join(dir, 'resolution.json');
const observation = { privacy: { redacted: true }, interactiveElements: [{ ref: 'e1', label: 'Search', tag: 'input', editable: true }] };
fs.writeFileSync(reviewFile, JSON.stringify({ transitions: [
  { transitionId: 't1', rawAction: { kind: 'focus', targetRef: 'e1' }, strategyObservationBefore: observation, outcome: { actionSucceeded: true } },
  { transitionId: 't2', rawAction: { kind: 'text-key', operation: 'type-char', targetRef: 'e1' }, strategyObservationBefore: observation, outcome: { actionSucceeded: true } }
] }));
fs.writeFileSync(packFile, JSON.stringify({ items: [{ episodeId: 'ep-1', status: 'awaiting-human-review', sourceFile: reviewFile, task: { instruction: 'Search' }, finalOutcomeStatus: 'success' }] }));
fs.writeFileSync(planFile, JSON.stringify({ episodes: [{ episodeId: 'ep-1', decision: 'ACCEPT', steps: [{ transitionId: 't2', type: 'typeText', args: { text: 'safe test' }, target: { label: 'Search', editable: true } }] }] }));
const done = curate({ packFile, curationFile: planFile, outputFile: outFile });
assert.strictEqual(done.result.policy.autoTrainEligible, false);
assert.strictEqual(done.result.policy.explicitHumanDigestApprovalRequired, true);
assert.strictEqual(done.result.items[0].captureNoiseCount, 1);
assert.strictEqual(done.result.items[0].resolvedSemanticActionCount, 1);
assert.strictEqual(done.result.items[0].resolutions[0].status, 'capture-noise');
assert.strictEqual(done.result.items[0].resolutions[1].suggestedAction.type, 'typeText');
function forbiddenKeys(value, hits = []) {
  if (Array.isArray(value)) value.forEach(item => forbiddenKeys(item, hits));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (['selector', 'selectors', 'coordinates', 'tabId'].includes(key)) hits.push(key);
      forbiddenKeys(child, hits);
    }
  }
  return hits;
}
assert.deepStrictEqual(forbiddenKeys(done.result), []);
console.log('Codex semantic curation contract: PASS');
