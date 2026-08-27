'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildTargetEvidence } = require('../tools/backfill_strategy_target_evidence.js');
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

function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-target-backfill-'));
  try {
    const rawDir = path.join(temp, 'raw');
    fs.mkdirSync(rawDir, { recursive: true });
    const reviews = [];
    const items = [];
    const triageItems = [];
    const cases = [
      ['ep-a', 'page-a-t1', 'e1'],
      ['ep-b', 'page-b-t1', 'e1'],
      ['ep-c', 'page-c-t1', 'e1']
    ];
    for (const [episodeId, transitionId, ref] of cases) {
      const file = path.join(temp, `${episodeId}.task-episode-review.json`);
      fs.writeFileSync(file, JSON.stringify(review(episodeId, transitionId, ref)));
      reviews.push(file);
      items.push(packItem(episodeId, file, transitionId));
      triageItems.push(triageItem(episodeId, transitionId));
    }

    const raw = {
      session: { sessionId: 's1' },
      events: [
        {
          type: 'dom-click', pageInstanceId: 'page-a', targetRef: 'e1',
          targetDescriptor: {
            elementRef: 'e1', tag: 'button', role: 'button', label: 'Alpha', editable: false,
            selector: '#alpha', selectorCandidates: [{ type: 'id', value: '#alpha', score: 1 }],
            rect: { x: 10, y: 20, width: 30, height: 40 }, rendered: true, inViewport: true, interactable: true
          }
        },
        {
          type: 'dom-click', pageInstanceId: 'page-b', targetRef: 'e1',
          targetDescriptor: {
            elementRef: 'e1', tag: 'a', role: 'link', label: 'Beta', editable: false,
            selector: '#beta', rect: { x: 50, y: 60, width: 70, height: 20 }, rendered: true, inViewport: true, interactable: true
          }
        }
      ]
    };
    fs.writeFileSync(path.join(rawDir, 's1.raw.json'), JSON.stringify(raw));

    const packFile = path.join(temp, 'review-pack.json');
    const triageFile = path.join(temp, 'triage.json');
    fs.writeFileSync(packFile, JSON.stringify({ reviewPackVersion: '0.1.0', items }));
    fs.writeFileSync(triageFile, JSON.stringify({ triageVersion: '0.1.0', items: triageItems }));

    const evidenceFile = path.join(temp, 'target-evidence.json');
    const backfill = buildTargetEvidence(packFile, rawDir, evidenceFile);
    assert.equal(backfill.result.requestedTransitionCount, 3);
    assert.equal(backfill.result.recoveredSemanticTargetCount, 2);
    assert.equal(backfill.result.unresolvedTargetCount, 1);
    assert.equal(backfill.result.conflictTargetCount, 0);
    assert.equal(backfill.result.items[0].transitions[0].semanticTarget.label, 'Alpha');
    assert.equal(backfill.result.items[1].transitions[0].semanticTarget.label, 'Beta');
    assert.equal(backfill.result.items[0].transitions[0].semanticTarget.tag, 'button');
    assert.equal(backfill.result.items[1].transitions[0].semanticTarget.tag, 'a');
    const serializedEvidence = JSON.stringify(backfill.result);
    assert.equal(serializedEvidence.includes('"selector"'), false);
    assert.equal(serializedEvidence.includes('selectorCandidates'), false);
    assert.equal(serializedEvidence.includes('"rect"'), false);
    assert.equal(serializedEvidence.includes('"pageInstanceId"'), false);
    assert.equal(serializedEvidence.includes('"targetRef"'), false);
    assert.equal(serializedEvidence.includes('#alpha'), false);

    const resolved = resolveReviewPack(packFile, triageFile, evidenceFile, path.join(temp, 'resolved'));
    assert.equal(resolved.result.ambiguousTransitionCount, 3);
    assert.equal(resolved.result.resolvedSemanticActionCount, 2);
    assert.equal(resolved.result.targetBackfillResolvedCount, 2);
    assert.equal(resolved.result.unresolvedHumanReviewCount, 1);
    const a = resolved.result.items.find(item => item.episodeId === 'ep-a').resolutions[0];
    const b = resolved.result.items.find(item => item.episodeId === 'ep-b').resolutions[0];
    const c = resolved.result.items.find(item => item.episodeId === 'ep-c').resolutions[0];
    assert.equal(a.suggestedAction.type, 'click');
    assert.equal(a.suggestedAction.targetRef, 'e1');
    assert.equal(a.semanticTarget.label, 'Alpha');
    assert.equal(b.semanticTarget.label, 'Beta');
    assert.equal(c.status, 'needs-human-review');
    assert.equal(a.requiresHumanConfirmation, true);
    assert.equal(a.autoTrainEligible, false);

    console.log('Strategy target backfill contract: PASS');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error('Strategy target backfill contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { observation, review, packItem, triageItem, main };
