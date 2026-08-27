'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { profileAmbiguity } = require('../tools/profile_strategy_ambiguity_evidence.js');

function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-ambiguity-profiler-'));
  const oldCwd = process.cwd();
  try {
    process.chdir(temp);
    const reviewFile = path.join(temp, 'ep-1.task-episode-review.json');
    fs.writeFileSync(reviewFile, JSON.stringify({
      episodeId: 'ep-1',
      transitions: [
        {
          transitionId: 't1',
          rawAction: { kind: 'dom-input', targetRef: 'e1', text: 'SECRET-TEXT', sessionSeq: 1 },
          strategyObservationBefore: {
            url: 'http://test/', focusedElement: null,
            interactiveElements: [{ ref: 'e1', role: 'textbox', tag: 'input', editable: true, visible: true, rendered: true, enabled: true }]
          },
          strategyObservationAfter: {
            url: 'http://test/', focusedElement: { ref: 'e1' },
            interactiveElements: [{ ref: 'e1', role: 'textbox', tag: 'input', editable: true, visible: true, rendered: true, enabled: true }]
          },
          outcome: { actionSucceeded: true }
        },
        {
          transitionId: 't2',
          rawAction: { kind: 'dom-change', targetRef: 'e2', value: 'PRIVATE', sessionSeq: 2 },
          strategyObservationBefore: {
            url: 'http://test/', focusedElement: { ref: 'e1' },
            interactiveElements: [{ ref: 'e2', role: 'checkbox', tag: 'input', checked: false, visible: true, rendered: true, enabled: true }]
          },
          strategyObservationAfter: {
            url: 'http://test/', focusedElement: { ref: 'e2' },
            interactiveElements: [{ ref: 'e2', role: 'checkbox', tag: 'input', checked: true, visible: true, rendered: true, enabled: true }]
          },
          outcome: { actionSucceeded: true }
        }
      ]
    }, null, 2));

    const packFile = path.join(temp, 'review-pack.json');
    fs.writeFileSync(packFile, JSON.stringify({
      items: [{ episodeId: 'ep-1', sourceFile: reviewFile }]
    }, null, 2));

    const resolutionFile = path.join(temp, 'resolution.json');
    fs.writeFileSync(resolutionFile, JSON.stringify({
      items: [{
        episodeId: 'ep-1',
        resolutions: [
          { transitionId: 't1', status: 'needs-human-review', sourceHint: 'text-action-review-required', reasonCode: 'text_content_intentionally_redacted_requires_human_review', semanticTarget: { role: 'textbox', tag: 'input', editable: true } },
          { transitionId: 't2', status: 'needs-human-review', sourceHint: 'form-control-review-required', reasonCode: 'form_control_semantics_insufficient', semanticTarget: { role: 'checkbox', tag: 'input', checked: false } }
        ]
      }]
    }, null, 2));

    const result = profileAmbiguity(packFile, resolutionFile);
    assert.equal(result.unresolvedTransitionCount, 2);
    assert.equal(result.byHint['text-action-review-required'], 1);
    assert.equal(result.byHint['form-control-review-required'], 1);
    assert.equal(result.byTargetKind.editable, 1);
    assert.equal(result.byTargetKind.checkable, 1);
    assert.equal(result.stateDeltaCounts.focusChanged, 2);
    assert.equal(result.stateDeltaCounts.checkedChanged, 1);
    assert.equal(result.rawActionKeyCounts.text, undefined);
    assert.equal(result.rawActionKeyCounts.value, undefined);
    assert.equal(result.rawActionKeyCounts.kind, 2);
    assert.equal(result.rawActionKeyCounts.targetRef, 2);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('SECRET-TEXT'), false);
    assert.equal(serialized.includes('PRIVATE'), false);
    assert.equal(result.policy.rawTextValuesExcluded, true);
    console.log('Strategy ambiguity profiler contract: PASS');
  } finally {
    process.chdir(oldCwd);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error('Strategy ambiguity profiler contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { main };
