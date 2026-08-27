'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  taskDeclaredText,
  genericTextFormSequence,
  resolveTeachingItem
} = require('../tools/resolve_strategy_teaching_batch.js');
const {
  candidateBlockReasons,
  candidateForItem
} = require('../tools/prepare_strategy_approval_candidates.js');

function observation(url, elements = [], pageSignals = {}) {
  return {
    observationId: `obs-${Math.random()}`,
    capturedAt: '2026-08-27T00:00:00.000Z',
    url,
    title: '',
    interactiveElements: elements.map(item => ({ rendered: true, visible: true, enabled: true, interactable: true, ...item })),
    pageSignals,
    privacy: { redacted: true, selectorsStored: false, tabIdStored: false }
  };
}

function transition(id, kind, targetRef, before, after, extra = {}, actionSucceeded = true) {
  return {
    transitionId: id,
    status: 'complete',
    rawAction: { actionVersion: '0.2.0', kind, targetRef, t: 1, ...extra },
    strategyObservationBefore: before,
    strategyObservationAfter: after,
    outcome: { actionSucceeded, partial: false }
  };
}

function targetSummary(element) {
  if (!element) return null;
  return {
    label: element.label || null,
    role: element.role || null,
    tag: element.tag || null,
    editable: element.editable === true,
    enabled: element.enabled !== false,
    visible: element.visible !== false
  };
}

function proposalFor(t) {
  const ref = t.rawAction.targetRef;
  const target = (t.strategyObservationBefore.interactiveElements || []).find(item => item.ref === ref) || null;
  const kind = t.rawAction.kind;
  const operation = t.rawAction.operation;
  let hint = null;
  if (kind === 'click') hint = 'click';
  else if (kind === 'focus') hint = 'focus';
  else if (kind === 'text-key') hint = 'keyboard-action-review-required';
  else if (kind === 'text-change') hint = 'text-action-review-required';
  return {
    transitionId: t.transitionId,
    evidence: {
      rawActionKind: kind,
      rawActionOperation: operation || null,
      targetBefore: targetSummary(target),
      targetAfter: targetSummary(target),
      actionSucceededCaptured: t.outcome.actionSucceeded === true
    },
    proposal: { actionTypeHint: hint }
  };
}

function scoreFor(proposal) {
  const target = proposal.evidence.targetBefore;
  const hint = proposal.proposal.actionTypeHint;
  const fast = ['click', 'focus'].includes(hint) && !!(target?.label || target?.role || target?.tag);
  return {
    transitionId: proposal.transitionId,
    actionTypeHint: hint,
    labelConfidence: fast ? 0.95 : 0.35,
    fastLabelReviewCandidate: fast,
    outcomeStillRequiresHumanReview: true,
    progressStillRequiresHumanReview: true,
    reasons: fast ? [] : ['ambiguous_action_type_hint']
  };
}

function buildItem(episodeId, instruction, transitions, finalOutcomeStatus = 'success') {
  const proposals = transitions.map(proposalFor);
  const scores = proposals.map(scoreFor);
  const task = { instruction, type: 'unspecified' };
  const packItem = {
    episodeId,
    task,
    finalOutcomeStatus,
    status: 'awaiting-human-review',
    proposals
  };
  const triageItem = { episodeId, task, transitions: scores };
  const draft = {
    episodeId,
    task,
    steps: proposals.map((proposal, index) => ({
      transitionId: proposal.transitionId,
      include: null,
      action: null,
      outcome: null,
      reviewerAid: {
        reviewClass: scores[index].fastLabelReviewCandidate ? 'fast-label-review' : 'ambiguous-label-review',
        labelConfidence: scores[index].labelConfidence,
        reasons: scores[index].reasons,
        semanticTarget: proposal.evidence.targetBefore,
        capturedActionSucceeded: transitions[index].outcome.actionSucceeded === true,
        suggestedAction: scores[index].fastLabelReviewCandidate ? {
          contractVersion: '0.1.0',
          type: scores[index].actionTypeHint,
          targetRef: transitions[index].rawAction.targetRef,
          args: {},
          intent: null,
          expectedOutcome: {}
        } : null,
        suggestedActionReadyForCopy: scores[index].fastLabelReviewCandidate
      }
    }))
  };
  const digestItem = {
    episodeId,
    task,
    finalOutcomeStatus,
    transitions: scores.map(score => ({
      transitionId: score.transitionId,
      reviewClass: score.fastLabelReviewCandidate ? 'fast-label-review' : 'ambiguous-label-review'
    }))
  };
  const review = { episodeId, task, transitions, finalOutcome: { status: finalOutcomeStatus } };
  return { packItem, triageItem, draft, digestItem, review };
}

function assertSemanticTextSubmitCandidate(fixture, expectedText) {
  const resolution = resolveTeachingItem(fixture.packItem, fixture.triageItem, fixture.review);
  assert.equal(resolution.unresolvedAmbiguousTransitionCount, 0);
  assert.deepEqual(candidateBlockReasons(fixture.digestItem, fixture.draft, resolution), []);
  const candidate = candidateForItem(fixture.digestItem, fixture.draft, resolution);
  const included = candidate.proposedSteps.filter(step => step.proposedInclude === true);
  assert.deepEqual(included.map(step => step.proposedAction.type), ['typeText', 'submit']);
  assert.equal(included[0].proposedAction.args.text, expectedText);
  assert.equal(included[0].proposedOutcome.progress, 0.5);
  assert.equal(included[1].proposedOutcome.progress, 1);
  assert.equal(included[0].proposedOutcome.taskSucceeded, false);
  assert.equal(included[1].proposedOutcome.taskSucceeded, true);
  assert.equal(candidate.excludedCaptureNoiseCount >= 3, true);
  return { resolution, candidate };
}

function main() {
  assert.equal(taskDeclaredText({ instruction: 'Type Mercury then press Enter.' }), 'Mercury');
  assert.equal(taskDeclaredText({ instruction: 'Nhập Sao Mai rồi nhấn Enter.' }), 'Sao Mai');
  assert.equal(taskDeclaredText({ instruction: 'Type secret password then press Enter.' }), null);

  const queryField = [{ ref: 'field-a', label: 'Catalog Query', role: 'searchbox', tag: 'input', editable: true }];
  const queryBefore = observation('https://example.test/catalog', queryField, { submitted: false });
  const queryAfter = observation('https://example.test/catalog', queryField, { submitted: true });
  const queryTransitions = [
    transition('query:t1', 'focus', 'field-a', queryBefore, queryBefore),
    transition('query:t2', 'click', 'field-a', queryBefore, queryBefore),
    transition('query:t3', 'text-key', 'field-a', queryBefore, queryBefore, { operation: 'type-char' }),
    transition('query:t4', 'text-change', 'field-a', queryBefore, queryBefore, { inputType: 'insertText', length: 2 }),
    transition('query:t5', 'text-key', 'field-a', queryBefore, queryBefore, { operation: 'type-char' }),
    transition('query:t6', 'text-key', 'field-a', queryBefore, queryAfter, { operation: 'enter', code: 'Enter' })
  ];
  const queryFixture = buildItem('ep-query-sequence', 'Type Mercury into the catalog query and press Enter to search.', queryTransitions);
  const querySequence = genericTextFormSequence(queryTransitions, queryFixture.packItem.task, queryFixture.review);
  assert.equal(querySequence.target.label, 'Catalog Query');
  assert.equal(querySequence.submitTransitionId, 'query:t6');
  assertSemanticTextSubmitCandidate(queryFixture, 'Mercury');

  const composerField = [{ ref: 'field-b', label: 'Draft Note', role: 'textbox', tag: 'textarea', editable: true }];
  const composerBefore = observation('https://example.test/compose', composerField, { sent: false });
  const composerAfter = observation('https://example.test/compose', composerField, { sent: true });
  const composerTransitions = [
    transition('compose:t1', 'click', 'field-b', composerBefore, composerBefore),
    transition('compose:t2', 'focus', 'field-b', composerBefore, composerBefore),
    transition('compose:t3', 'text-key', 'field-b', composerBefore, composerBefore, { operation: 'type-char' }),
    transition('compose:t4', 'text-key', 'field-b', composerBefore, composerBefore, { operation: 'type-char' }),
    transition('compose:t5', 'text-key', 'field-b', composerBefore, composerAfter, { operation: 'enter', code: 'Enter' })
  ];
  const composerFixture = buildItem('ep-composer-sequence', 'Nhập Sao Mai vào ô ghi chú rồi nhấn Enter để gửi.', composerTransitions);
  assertSemanticTextSubmitCandidate(composerFixture, 'Sao Mai');

  const otherField = [
    { ref: 'field-c1', label: 'Primary Field', role: 'textbox', tag: 'input', editable: true },
    { ref: 'field-c2', label: 'Secondary Field', role: 'textbox', tag: 'input', editable: true }
  ];
  const ambiguousBefore = observation('https://example.test/form', otherField, { complete: false });
  const ambiguousAfter = observation('https://example.test/form', otherField, { complete: true });
  const ambiguousTransitions = [
    transition('ambiguous:t1', 'text-key', 'field-c1', ambiguousBefore, ambiguousBefore, { operation: 'type-char' }),
    transition('ambiguous:t2', 'text-key', 'field-c2', ambiguousBefore, ambiguousAfter, { operation: 'enter', code: 'Enter' })
  ];
  const ambiguousFixture = buildItem('ep-ambiguous', 'Type Mercury into the primary field and press Enter to submit.', ambiguousTransitions);
  const ambiguousResolution = resolveTeachingItem(ambiguousFixture.packItem, ambiguousFixture.triageItem, ambiguousFixture.review);
  assert.equal(ambiguousResolution.unresolvedAmbiguousTransitionCount > 0, true);
  assert.equal(candidateBlockReasons(ambiguousFixture.digestItem, ambiguousFixture.draft, ambiguousResolution).includes('unresolved_ambiguous_transition'), true);

  const failedFixture = buildItem('ep-failed-outcome', 'Type Mercury into the primary field and press Enter to submit.', [
    transition('failed:t1', 'text-key', 'field-c1', ambiguousBefore, ambiguousBefore, { operation: 'type-char' }),
    transition('failed:t2', 'text-key', 'field-c1', ambiguousBefore, ambiguousAfter, { operation: 'enter', code: 'Enter' })
  ], 'failure');
  assert.equal(genericTextFormSequence(failedFixture.review.transitions, failedFixture.packItem.task, failedFixture.review), null);

  const resolverSource = fs.readFileSync(path.join(__dirname, '..', 'tools', 'resolve_strategy_teaching_batch.js'), 'utf8').toLowerCase();
  for (const forbidden of ['atlas', 'orion', 'topic search', 'message composer', 'localhost:8092']) {
    assert.equal(resolverSource.includes(forbidden), false, `resolver must not hard-code ${forbidden}`);
  }
  assert.equal(resolverSource.includes('selector'), false);
  assert.equal(resolverSource.includes('tabid'), false);
  assert.equal(resolverSource.includes('raw cdp'), false);

  console.log('Strategy text/form sequence resolver contract: PASS');
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error('Strategy text/form sequence resolver contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { main };
