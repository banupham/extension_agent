'use strict';

const assert = require('assert');
const {
  resolveAmbiguousTransition
} = require('../tools/resolve_strategy_review_ambiguity.js');
const {
  candidateBlockReasons,
  candidateForItem
} = require('../tools/prepare_strategy_approval_candidates.js');

function observation(ref, element, url = 'http://review.test/') {
  return {
    observationId: `obs-${ref || 'none'}`,
    capturedAt: '2026-08-27T00:00:00.000Z',
    url,
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

function browserTransition(id, operation, beforeUrl, afterUrl) {
  return {
    transitionId: id,
    rawAction: { kind: 'browser', operation },
    strategyObservationBefore: observation(null, null, beforeUrl),
    strategyObservationAfter: observation(null, null, afterUrl),
    outcome: { actionSucceeded: true, partial: false }
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
  const checkbox = { label: 'Remember setting', role: 'checkbox', tag: 'input', inputType: 'checkbox', editable: false, checked: false };
  const toggleProposal = proposal('toggle:t1', 'form-control-review-required', checkbox);
  const toggleTransition = transition('toggle:t1', { kind: 'dom-change', targetRef: 'e1', checked: true }, checkbox);
  toggleTransition.strategyObservationAfter = observation('e1', { ...checkbox, checked: true });
  const toggleResolution = resolveAmbiguousTransition({
    proposal: toggleProposal,
    transition: toggleTransition,
    task: { instruction: 'Enable remember setting' }
  });
  assert.equal(toggleResolution.status, 'resolved-semantic-action');
  assert.equal(toggleResolution.suggestedAction.type, 'setChecked');
  assert.equal(toggleResolution.suggestedAction.targetRef, 'e1');
  assert.equal(toggleResolution.suggestedAction.args.value, true);
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
  assert.equal(toggleCandidate.proposedSteps[0].proposedAction.type, 'setChecked');
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

  const waitProposal = proposal('wait:t1', 'waitAndObserve-review-required', null);
  const waitBefore = observation(null, null, 'http://127.0.0.1:8791/teaching/motor/M18');
  const waitAfter = observation('ready-1', { label: 'Result Ready', role: 'status', tag: 'div', editable: false }, 'http://127.0.0.1:8791/teaching/motor/M18');
  const waitTransition = {
    transitionId: 'wait:t1',
    rawAction: { kind: 'observe', operation: 'wait', waitedMs: 820 },
    strategyObservationBefore: waitBefore,
    strategyObservationAfter: waitAfter,
    outcome: { actionSucceeded: true, partial: false }
  };
  const waitResolution = resolveAmbiguousTransition({
    proposal: waitProposal,
    transition: waitTransition,
    task: { instruction: 'Bắt đầu kiểm tra rồi mở kết quả khi nó sẵn sàng.' }
  });
  assert.equal(waitResolution.status, 'resolved-semantic-action');
  assert.equal(waitResolution.suggestedAction.type, 'waitAndObserve');

  const unchangedWait = resolveAmbiguousTransition({
    proposal: waitProposal,
    transition: { ...waitTransition, strategyObservationAfter: waitBefore },
    task: { instruction: 'Bắt đầu kiểm tra rồi mở kết quả khi nó sẵn sàng.' }
  });
  assert.equal(unchangedWait.status, 'capture-noise');
  assert.equal(unchangedWait.reasonCode, 'wait_without_semantic_state_change_how_not_strategy');

  const shortWait = resolveAmbiguousTransition({
    proposal: waitProposal,
    transition: { ...waitTransition, rawAction: { ...waitTransition.rawAction, waitedMs: 300 } },
    task: { instruction: 'Bắt đầu kiểm tra rồi mở kết quả khi nó sẵn sàng.' }
  });
  assert.equal(shortWait.status, 'needs-human-review');
  assert.equal(shortWait.semanticActionType, 'waitAndObserve');

  const incidentalWait = resolveAmbiguousTransition({
    proposal: waitProposal,
    transition: waitTransition,
    task: { instruction: 'Mở Details.' }
  });
  assert.equal(incidentalWait.status, 'capture-noise');
  assert.equal(incidentalWait.reasonCode, 'delayed_change_not_explicitly_part_of_task');

  const tabProposal = id => proposal(id, 'tab-lifecycle-review-required', null);
  const m14Task = { instruction: 'Mở trang Help ở tab mới, xem xong rồi quay lại.' };
  const m14Close = resolveAmbiguousTransition({
    proposal: tabProposal('m14:close'),
    transition: browserTransition('m14:close', 'closeTab', 'http://127.0.0.1:8791/help', 'http://127.0.0.1:8791/teaching/motor/M14'),
    task: m14Task
  });
  assert.equal(m14Close.status, 'resolved-semantic-action');
  assert.equal(m14Close.suggestedAction.type, 'closeTab');
  assert.equal(m14Close.reasonCode, 'captured_temporary_tab_return_close');

  const vagueReturnClose = resolveAmbiguousTransition({
    proposal: tabProposal('m14:vague-close'),
    transition: browserTransition('m14:vague-close', 'closeTab', 'http://review.test/help', 'http://review.test/'),
    task: { instruction: 'Quay lại trang chính.' }
  });
  assert.equal(vagueReturnClose.status, 'needs-human-review');
  assert.equal(vagueReturnClose.reasonCode, 'close_tab_not_explicit_in_task');

  const m22Task = { instruction: 'Mở trang Report ở tab mới, chuyển sang đó, quay lại trang trước, đi tới lại, reload, sau đó đóng tab Report.' };
  const m22Cases = [
    ['openNewTab', 'http://review.test/', 'http://review.test/report'],
    ['switchTab', 'http://review.test/', 'http://review.test/report'],
    ['back', 'http://review.test/report?page=2', 'http://review.test/report?page=1'],
    ['forward', 'http://review.test/report?page=1', 'http://review.test/report?page=2'],
    ['reload', 'http://review.test/report?page=2', 'http://review.test/report?page=2'],
    ['closeTab', 'http://review.test/report', 'http://review.test/']
  ];
  for (const [operation, beforeUrl, afterUrl] of m22Cases) {
    const id = `m22:${operation}`;
    const resolution = resolveAmbiguousTransition({
      proposal: tabProposal(id),
      transition: browserTransition(id, operation, beforeUrl, afterUrl),
      task: m22Task
    });
    assert.equal(resolution.status, 'resolved-semantic-action', `${operation} should resolve`);
    assert.equal(resolution.suggestedAction.type, operation);
    assert.equal(Object.prototype.hasOwnProperty.call(resolution.suggestedAction.args || {}, 'tabId'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(resolution.suggestedAction.args || {}, 'windowId'), false);
  }

  const guarded = [toggleResolution, scrollResolution, textResolution, waitResolution, m14Close];
  assert.equal(guarded.every(item => item.requiresHumanConfirmation === true), true);
  assert.equal(guarded.every(item => item.autoTrainEligible === false), true);
  console.log('Strategy ambiguity resolver contract: PASS');
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error('Strategy ambiguity resolver contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { observation, proposal, transition, browserTransition, draftStep, main };
