'use strict';

const assert = require('assert');
const {
  taskDeclaredText,
  resolveTeachingItem
} = require('../tools/resolve_strategy_teaching_batch.js');
const {
  candidateBlockReasons,
  candidateForItem
} = require('../tools/prepare_strategy_approval_candidates.js');

function observation(url, elements = [], focusedElement = null) {
  return {
    observationId: `obs-${Math.random()}`,
    capturedAt: '2026-08-27T00:00:00.000Z',
    url,
    title: '',
    focusedElement,
    interactiveElements: elements.map(item => ({ rendered: true, visible: true, enabled: true, interactable: true, ...item })),
    pageSignals: {},
    privacy: { redacted: true, selectorsStored: false, tabIdStored: false }
  };
}

function transition(id, kind, targetRef, before, after, extra = {}) {
  return {
    transitionId: id,
    status: 'complete',
    rawAction: { actionVersion: '0.2.0', kind, targetRef, t: 1, ...extra },
    strategyObservationBefore: before,
    strategyObservationAfter: after,
    outcome: { actionSucceeded: true, partial: false }
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
  return {
    transitionId: t.transitionId,
    evidence: {
      rawActionKind: kind,
      rawActionOperation: operation || null,
      targetBefore: targetSummary(target),
      targetAfter: targetSummary(target),
      actionSucceededCaptured: true
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

function suggestedAction(proposal, score, t) {
  if (!score.fastLabelReviewCandidate) return null;
  return {
    contractVersion: '0.1.0',
    type: score.actionTypeHint,
    targetRef: t.rawAction.targetRef,
    args: {},
    intent: null,
    expectedOutcome: {}
  };
}

function buildItem(episodeId, instruction, transitions) {
  const proposals = transitions.map(proposalFor);
  const scores = proposals.map(scoreFor);
  const packItem = {
    episodeId,
    task: { instruction, type: 'unspecified' },
    finalOutcomeStatus: 'success',
    status: 'awaiting-human-review',
    proposals
  };
  const triageItem = {
    episodeId,
    task: packItem.task,
    transitions: scores
  };
  const draft = {
    episodeId,
    task: packItem.task,
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
        capturedActionSucceeded: true,
        suggestedAction: suggestedAction(proposal, scores[index], transitions[index]),
        suggestedActionReadyForCopy: scores[index].fastLabelReviewCandidate
      }
    }))
  };
  const digestItem = {
    episodeId,
    task: packItem.task,
    finalOutcomeStatus: 'success',
    transitions: scores.map(score => ({
      transitionId: score.transitionId,
      reviewClass: score.fastLabelReviewCandidate ? 'fast-label-review' : 'ambiguous-label-review'
    }))
  };
  const review = { episodeId, task: packItem.task, transitions, finalOutcome: { status: 'success' } };
  return { packItem, triageItem, draft, digestItem, review };
}

function main() {
  assert.equal(taskDeclaredText({ instruction: 'Trên Google, nhập OpenAI vào ô Tìm kiếm rồi bấm Tìm trên Google.' }), 'OpenAI');
  assert.equal(taskDeclaredText({ instruction: 'Type hello world into the message box' }), 'hello world');
  assert.equal(taskDeclaredText({ instruction: 'Nhập password ABC123 vào ô mật khẩu' }), null);

  const googleElements = [
    { ref: 'e1', label: 'Tìm kiếm', role: 'combobox', tag: 'textarea', editable: true },
    { ref: 'e4', label: 'Gmail', role: null, tag: 'a', editable: false },
    { ref: 'e11', label: 'Công cụ nhập', role: 'button', tag: 'div', editable: false }
  ];
  const google = observation('https://www.google.com/', googleElements);
  const gmail = observation('https://mail.google.com/mail/u/0/', []);

  const gmailTransitions = [
    transition('gmail:t1', 'focus', 'e11', google, google),
    transition('gmail:t2', 'click', 'e72', google, google),
    transition('gmail:t3', 'focus', 'e4', google, google),
    transition('gmail:t4', 'click', 'e4', google, google),
    transition('gmail:t5', 'focus', 'e11', gmail, gmail)
  ];
  const gmailFixture = buildItem('ep-gmail', 'Trên Google, mở liên kết Gmail ở góc trên bên phải.', gmailTransitions);
  const gmailResolution = resolveTeachingItem(gmailFixture.packItem, gmailFixture.triageItem, gmailFixture.review);
  assert.equal(gmailResolution.unresolvedAmbiguousTransitionCount, 0);
  assert.equal(gmailResolution.resolutions.filter(item => item.status === 'capture-noise').length, 4);
  const gmailReasons = candidateBlockReasons(gmailFixture.digestItem, gmailFixture.draft, gmailResolution);
  assert.deepEqual(gmailReasons, []);
  const gmailCandidate = candidateForItem(gmailFixture.digestItem, gmailFixture.draft, gmailResolution);
  assert.equal(gmailCandidate.includedStrategyStepCount, 1);
  assert.equal(gmailCandidate.proposedSteps.find(step => step.proposedInclude)?.proposedAction?.type, 'click');

  const searchTransitions = [
    transition('search:t1', 'click', 'e1', google, google),
    transition('search:t2', 'click', 'e1', google, google),
    transition('search:t3', 'text-key', 'e1', google, google, { operation: 'type-char' }),
    transition('search:t4', 'text-key', 'e1', google, google, { operation: 'type-char' }),
    transition('search:t5', 'text-key', 'e1', google, google, { operation: 'type-char' }),
    transition('search:t6', 'text-key', 'e1', google, google, { operation: 'enter', code: 'Enter' })
  ];
  const searchFixture = buildItem('ep-search', 'Trên Google, nhập OpenAI vào ô Tìm kiếm rồi bấm Tìm trên Google.', searchTransitions);
  const searchResolution = resolveTeachingItem(searchFixture.packItem, searchFixture.triageItem, searchFixture.review);
  assert.equal(searchResolution.unresolvedAmbiguousTransitionCount, 0);
  const searchReasons = candidateBlockReasons(searchFixture.digestItem, searchFixture.draft, searchResolution);
  assert.deepEqual(searchReasons, []);
  const searchCandidate = candidateForItem(searchFixture.digestItem, searchFixture.draft, searchResolution);
  const searchActions = searchCandidate.proposedSteps.filter(step => step.proposedInclude).map(step => step.proposedAction);
  assert.deepEqual(searchActions.map(action => action.type), ['typeText', 'submit']);
  assert.equal(searchActions[0].args.text, 'OpenAI');
  assert.equal(searchCandidate.excludedCaptureNoiseCount, 4);

  const missionElements = [
    { ref: 'e1', label: 'Mission Atlas', role: null, tag: 'button', editable: false },
    { ref: 'e2', label: 'Mission Orion', role: null, tag: 'button', editable: false }
  ];
  const mission = observation('http://127.0.0.1:8091/mission', missionElements);
  const atlas = observation('http://127.0.0.1:8091/mission/atlas', missionElements);
  const orion = observation('http://127.0.0.1:8091/mission/orion', missionElements);
  const missionTransitions = [
    transition('mission:t1', 'click', 'e1', mission, atlas),
    transition('mission:t2', 'click', 'e2', atlas, orion)
  ];
  const missionFixture = buildItem('ep-mission', 'Trên http://127.0.0.1:8091/mission, bấm mission Atlas và mission Orion.', missionTransitions);
  const missionResolution = resolveTeachingItem(missionFixture.packItem, missionFixture.triageItem, missionFixture.review);
  assert.equal(missionResolution.resolutions.length, 0);
  assert.deepEqual(candidateBlockReasons(missionFixture.digestItem, missionFixture.draft, missionResolution), []);
  const missionCandidate = candidateForItem(missionFixture.digestItem, missionFixture.draft, missionResolution);
  assert.deepEqual(missionCandidate.proposedSteps.filter(step => step.proposedInclude).map(step => step.proposedAction.type), ['click', 'click']);

  const groups = new Set([gmailCandidate.splitGroup, searchCandidate.splitGroup, missionCandidate.splitGroup]);
  assert.equal(groups.size, 3);
  assert.equal([gmailResolution, searchResolution, missionResolution].every(item => item.unresolvedAmbiguousTransitionCount === 0), true);
  console.log('Strategy teaching batch resolver contract: PASS');
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error('Strategy teaching batch resolver contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { main };
