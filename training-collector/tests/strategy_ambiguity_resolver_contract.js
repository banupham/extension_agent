'use strict';

const assert = require('assert');
const {
  resolveAmbiguousTransition
} = require('../tools/resolve_strategy_review_ambiguity.js');
const {
  candidateBlockReasons,
  candidateForItem
} = require('../tools/prepare_strategy_approval_candidates.js');

function observation(ref, element) {
  return {
    observationId: `obs-${ref || 'none'}`,
    capturedAt: '2026-08-27T00:00:00.000Z',
    url: 'http://review.test/',
    title: 'Review',
    interactiveElements: element ? [{ ref, rendered: true, visible: true, enabled: true, ...element }] : [],
    pageSignals: {},
    privacy: { redacted: true, selectorsStored: false, tabIdStored: false }
  };
}

function proposal(id, hint, target, captured = true) {
  return {
    transitionId: id,
    evidence: { targetBefore: target || null, actionSucceededCaptured: captured },
    proposal: { actionTypeHint: hint }
  };
}

function transition(id, rawAction, element, outcome = true) {
  return {
    transitionId: id,
    rawAction,
    strategyObservationBefore: observation(rawAction?.targetRef || null, element),
    strategyObservationAfter: observation(rawAction?.targetRef || null, element),
    outcome: { actionSucceeded: outcome, partial: false }
  };
}

function draftStep(id, reviewClass, semanticTarget, suggestedAction = null) {
  return {
    transitionId: id,
    include: null,
    action: null,
    outcome: null,
    reviewerAid: {
      reviewClass,
      labelConfidence: reviewClass === 'fast-label-review' ? 0.95 : 0.35,
      semanticTarget,
      capturedActionSucceeded: true,
      suggestedAction,
      suggestedActionReadyForCopy: !!suggestedAction
    }
  };
}

function main() {
  const checkbox = { label: 'Remember setting', role: 'checkbox', tag: 'input', editable: false, checked: false };
  const toggleProposal = proposal('toggle:t1', 'form-control-review-required', checkbox);
  const toggleTransition = transition('toggle:t1', { kind: 'dom-change', targetRef: 'e1' }, checkbox);
  const toggleResolution = resolveAmbiguousTransition({
    proposal: toggleProposal,
    transition: toggleTransition,
    task: { instruction: 'Enable remember setting' }
  });
  assert.equal(toggleResolution.status, 'resolved-semantic-action');
  assert.equal(toggleResolution.suggestedAction.type, 'toggle');
  assert.equal(toggleResolution.suggestedAction.targetRef, 'e1');
  assert.equal(toggleResolution.autoTrainEligible, false);

  const toggleItem = {
    episodeId: 'ep-toggle',
    task: { instruction: 'Enable remember setting' },
    finalOutcomeStatus: 'success',
    transitions: [{ transitionId: 'toggle:t1', reviewClass: 'ambiguous-label-review' }]
  };
  const toggleDraft = {
    task: toggleItem.task,
    steps: [draftStep('toggle:t1', 'ambiguous-label-review', checkbox)]
  };
  const toggleAid = { episodeId: 'ep-toggle', resolutions: [toggleResolution] };
  assert.deepEqual(candidateBlockReasons(toggleItem, toggleDraft, toggleAid), []);
  const toggleCandidate = candidateForItem(toggleItem, toggleDraft, toggleAid);
  assert.equal(toggleCandidate.proposedSteps[0].proposedAction.type, 'toggle');
  assert.equal(toggleCandidate.ambiguityResolvedStrategyStepCount, 1);

  const scrollProposal = proposal('scroll:t1', 'scroll-direction-review-required', null);
  const scrollTransition = transition('scroll:t1', { kind: 'wheel', deltaY: 420 }, null);
  const scrollResolution = resolveAmbiguousTransition({
    proposal: scrollProposal,
    transition: scrollTransition,
    task: { instruction: 'Open the article' }
  });
  assert.equal(scrollResolution.status, 'capture-noise');
  assert.equal(scrollResolution.reasonCode, 'incidental_scroll_how_not_strategy');

  const clickTarget = { label: 'Open article', role: 'button', tag: 'button', editable: false };
  const scrollItem = {
    episodeId: 'ep-scroll',
    task: { instruction: 'Open the article' },
    finalOutcomeStatus: 'success',
    transitions: [
      { transitionId: 'scroll:t1', reviewClass: 'ambiguous-label-review' },
      { transitionId: 'scroll:t2', reviewClass: 'fast-label-review' }
    ]
  };
  const scrollDraft = {
    task: scrollItem.task,
    steps: [
      draftStep('scroll:t1', 'ambiguous-label-review', null),
      draftStep('scroll:t2', 'fast-label-review', clickTarget, {
        contractVersion: '0.1.0', type: 'click', targetRef: 'e2', args: {}, intent: null, expectedOutcome: {}
      })
    ]
  };
  const scrollAid = { episodeId: 'ep-scroll', resolutions: [scrollResolution] };
  assert.deepEqual(candidateBlockReasons(scrollItem, scrollDraft, scrollAid), []);
  const scrollCandidate = candidateForItem(scrollItem, scrollDraft, scrollAid);
  assert.equal(scrollCandidate.proposedSteps[0].proposedInclude, false);
  assert.equal(scrollCandidate.proposedSteps[1].proposedInclude, true);
  assert.equal(scrollCandidate.excludedCaptureNoiseCount, 1);

  const explicitScroll = resolveAmbiguousTransition({
    proposal: scrollProposal,
    transition: scrollTransition,
    task: { instruction: 'Cuộn xuống trang' }
  });
  assert.equal(explicitScroll.status, 'resolved-semantic-action');
  assert.equal(explicitScroll.suggestedAction.type, 'scrollVertical');

  const editable = { label: 'Message', role: 'textbox', tag: 'textarea', editable: true };
  const textProposal = proposal('text:t1', 'text-action-review-required', editable);
  const textTransition = transition('text:t1', { kind: 'dom-input', targetRef: 'e3', text: 'PRIVATE-SHOULD-NOT-LEAK' }, editable);
  const textResolution = resolveAmbiguousTransition({
    proposal: textProposal,
    transition: textTransition,
    task: { instruction: 'Type the message' }
  });
  assert.equal(textResolution.status, 'needs-human-review');
  assert.equal(textResolution.semanticActionType, 'typeText');
  assert.equal(JSON.stringify(textResolution).includes('PRIVATE-SHOULD-NOT-LEAK'), false);

  const textItem = {
    episodeId: 'ep-text', task: { instruction: 'Type the message' }, finalOutcomeStatus: 'success',
    transitions: [{ transitionId: 'text:t1', reviewClass: 'ambiguous-label-review' }]
  };
  const textDraft = { task: textItem.task, steps: [draftStep('text:t1', 'ambiguous-label-review', editable)] };
  const textReasons = candidateBlockReasons(textItem, textDraft, { episodeId: 'ep-text', resolutions: [textResolution] });
  assert.equal(textReasons.includes('unresolved_ambiguous_transition'), true);

  assert.equal([toggleResolution, scrollResolution, textResolution].every(item => item.requiresHumanConfirmation === true), true);
  assert.equal([toggleResolution, scrollResolution, textResolution].every(item => item.autoTrainEligible === false), true);
  console.log('Strategy ambiguity resolver contract: PASS');
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error('Strategy ambiguity resolver contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { observation, proposal, transition, draftStep, main };
