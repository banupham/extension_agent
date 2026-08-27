'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildEpisodeProvenanceEvidence } = require('../tools/backfill_strategy_episode_provenance.js');
const { resolveReviewPack } = require('../tools/resolve_strategy_review_ambiguity_with_targets.js');

function observation(id) {
  return {
    observationId: id,
    url: 'http://review.test/',
    title: '',
    interactiveElements: [],
    pageSignals: {},
    privacy: { redacted: true, selectorsStored: false, tabIdStored: false }
  };
}

function review(episodeId, transitionId, ref) {
  return {
    reviewExportVersion: '0.1.0',
    episodeId,
    strategyReady: true,
    task: { instruction: 'Open the chosen item', type: 'generic' },
    transitions: [{
      transitionId,
      status: 'complete',
      rawAction: { actionVersion: '0.1.0', kind: 'click', targetRef: ref, t: 1 },
      strategyObservationBefore: observation(`${transitionId}-before`),
      strategyObservationAfter: observation(`${transitionId}-after`),
      outcome: { actionSucceeded: true, partial: false }
    }],
    finalOutcome: { status: 'success' },
    privacy: {
      rawTextValuesStored: false,
      passwordValuesStored: false,
      cookiesStored: false,
      storageSecretsStored: false,
      authorizationDataStored: false,
      selectorsExported: false,
      tabIdExported: false,
      rawActionCoordinatesExported: false
    }
  };
}

function packItem(episodeId, sourceFile, transitionId) {
  return {
    episodeId,
    sourceFile,
    status: 'awaiting-human-review',
    task: { instruction: 'Open the chosen item', type: 'generic' },
    finalOutcomeStatus: 'success',
    proposals: [{
      transitionId,
      evidence: { targetBefore: null, actionSucceededCaptured: true },
      proposal: { actionTypeHint: 'click' }
    }]
  };
}

function triageItem(episodeId, transitionId) {
  return {
    episodeId,
    transitions: [{
      transitionId,
      fastLabelReviewCandidate: false,
      actionTypeHint: 'click',
      reasons: ['semantic_target_missing']
    }]
  };
}

function anchor(episodeId, ref, label, tag = 'button') {
  return {
    type: 'episode-action-anchor',
    episodeId,
    targetRef: ref,
    actionKind: 'click',
    semanticTarget: {
      label,
      role: tag === 'a' ? 'link' : 'button',
      tag,
      editable: false,
      enabled: true,
      rendered: true,
      inViewport: true,
      interactable: true,
      visible: true,
      selector: '#must-not-export',
      rect: { x: 1, y: 2, width: 3, height: 4 }
    }
  };
}

function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-episode-provenance-'));
  try {
    const rawDir = path.join(temp, 'raw');
    fs.mkdirSync(rawDir, { recursive: true });
    const items = [];
    const triageItems = [];
    const cases = [
      ['ep-a', 'unlinked-page-a-t1', 'e1'],
      ['ep-b', 'unlinked-page-b-t1', 'e1'],
      ['ep-c', 'unlinked-page-c-t1', 'e1']
    ];
    for (const [episodeId, transitionId, ref] of cases) {
      const file = path.join(temp, `${episodeId}.task-episode-review.json`);
      fs.writeFileSync(file, JSON.stringify(review(episodeId, transitionId, ref)));
      items.push(packItem(episodeId, file, transitionId));
      triageItems.push(triageItem(episodeId, transitionId));
    }

    fs.writeFileSync(path.join(rawDir, 'session.raw.json'), JSON.stringify({
      session: { sessionId: 's1' },
      events: [
        anchor('ep-a', 'e1', 'Alpha'),
        anchor('ep-a', 'e1', 'Alpha'),
        anchor('ep-b', 'e1', 'Beta', 'a'),
        anchor('ep-c', 'e1', 'Gamma'),
        anchor('ep-c', 'e1', 'Delta')
      ]
    }));

    const packFile = path.join(temp, 'review-pack.json');
    const triageFile = path.join(temp, 'triage.json');
    fs.writeFileSync(packFile, JSON.stringify({ reviewPackVersion: '0.1.0', items }));
    fs.writeFileSync(triageFile, JSON.stringify({ triageVersion: '0.1.0', items: triageItems }));

    const evidenceFile = path.join(temp, 'target-evidence.json');
    const built = buildEpisodeProvenanceEvidence(packFile, rawDir, evidenceFile);
    assert.equal(built.result.provenanceAnchorCount, 5);
    assert.equal(built.result.requestedTransitionCount, 3);
    assert.equal(built.result.recoveredSemanticTargetCount, 2);
    assert.equal(built.result.unresolvedTargetCount, 1);
    assert.equal(built.result.conflictTargetCount, 1);
    assert.equal(built.result.items[0].transitions[0].semanticTarget.label, 'Alpha');
    assert.equal(built.result.items[1].transitions[0].semanticTarget.label, 'Beta');

    const serialized = JSON.stringify(built.result);
    assert.equal(serialized.includes('"selector"'), false);
    assert.equal(serialized.includes('"rect"'), false);
    assert.equal(serialized.includes('"pageInstanceId"'), false);
    assert.equal(serialized.includes('"targetRef"'), false);
    assert.equal(serialized.includes('#must-not-export'), false);

    const resolved = resolveReviewPack(packFile, triageFile, evidenceFile, path.join(temp, 'resolved'));
    assert.equal(resolved.result.ambiguousTransitionCount, 3);
    assert.equal(resolved.result.resolvedSemanticActionCount, 2);
    assert.equal(resolved.result.targetBackfillResolvedCount, 2);
    assert.equal(resolved.result.unresolvedHumanReviewCount, 1);
    assert.equal(resolved.result.items[0].resolutions[0].semanticTarget.label, 'Alpha');
    assert.equal(resolved.result.items[1].resolutions[0].semanticTarget.label, 'Beta');
    assert.equal(resolved.result.items[2].resolutions[0].status, 'needs-human-review');
    assert.equal(resolved.result.policy.autoTrainEligible, false);

    console.log('Strategy episode provenance contract: PASS');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error('Strategy episode provenance contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { observation, review, packItem, triageItem, anchor, main };
