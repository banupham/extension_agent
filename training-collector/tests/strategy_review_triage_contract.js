'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scoreReviewPack } = require('../tools/score_strategy_review_pack.js');

function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-review-triage-'));
  try {
    const packFile = path.join(temp, 'review-pack.json');
    fs.writeFileSync(packFile, `${JSON.stringify({
      items: [
        {
          episodeId: 'ep-fast', status: 'awaiting-human-review', task: { instruction: 'Open item' }, proposals: [
            { transitionId: 't1', evidence: { targetBefore: { label: 'Open item', role: 'button', tag: 'button' }, actionSucceededCaptured: true }, proposal: { actionTypeHint: 'click' } },
            { transitionId: 't2', evidence: { targetBefore: { label: 'Preview', role: 'link', tag: 'a' }, actionSucceededCaptured: true }, proposal: { actionTypeHint: 'hoverAndObserve' } }
          ]
        },
        {
          episodeId: 'ep-ambiguous', status: 'awaiting-human-review', task: { instruction: 'Change form' }, proposals: [
            { transitionId: 't3', evidence: { targetBefore: { label: 'Mode', role: 'combobox', tag: 'select' }, actionSucceededCaptured: true }, proposal: { actionTypeHint: 'form-control-review-required' } }
          ]
        }
      ]
    }, null, 2)}\n`, 'utf8');

    const result = scoreReviewPack(packFile);
    assert.equal(result.triageVersion, '0.1.0');
    assert.equal(result.episodeCount, 2);
    assert.equal(result.transitionCount, 3);
    assert.equal(result.fastLabelReviewCount, 2);
    assert.equal(result.ambiguousLabelReviewCount, 1);
    assert.equal(result.episodeFastLabelReviewCount, 1);
    assert.equal(result.items[0].episodeFastLabelReviewCandidate, true);
    assert.equal(result.items[1].episodeFastLabelReviewCandidate, false);
    assert.equal(result.items[1].transitions[0].outcomeStillRequiresHumanReview, true);
    assert.equal(result.policy.proposalsNeverAutoVerifyHumanReview, true);
    assert.equal(result.policy.autoTrainEligible, false);

    console.log('Strategy review triage contract: PASS');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error('Strategy review triage contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { main };
