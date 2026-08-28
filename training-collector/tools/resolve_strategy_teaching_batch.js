#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Base = require('./resolve_strategy_review_ambiguity.js');

const TEACHING_BATCH_RESOLVER_VERSION = '0.4.0';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveFile(file) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.resolve(file);
}

function cleanText(value, max = 160) {
  if (typeof value !== 'string') return null;
  const text = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function instructionIsSensitive(instruction) {
  const normalized = String(instruction || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return [
    'password', 'mat khau', 'otp', 'one-time password', 'secret',
    'api key', 'access token', 'credit card', 'card number', 'cvv'
  ].some(token => normalized.includes(token));
}

function stripDeclaredText(value) {
  const text = cleanText(value, 160);
  if (!text) return null;
  const stripped = text
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[,.!?:;]+$/g, '')
    .trim();
  return stripped && stripped.length <= 160 ? stripped : null;
}

function taskDeclaredText(task) {
  const instruction = cleanText(task?.instruction, 500);
  if (!instruction || instructionIsSensitive(instruction)) return null;
  const patterns = [
    /(?:^|[,.!?:;]\s*|\s)(?:nhập|gõ)\s+(.+?)\s+(?:vào|trong)\s+/i,
    /(?:^|[,.!?:;]\s*|\s)(?:type|enter|fill|write)\s+(.+?)\s+(?:into|in)\s+/i,
    /(?:^|[,.!?:;]\s*|\s)(?:nhập|gõ)\s+(.+?)\s+(?:(?:rồi|sau đó|và sau đó|và)\s+)?(?:nhấn|bấm|ấn)\s+enter\b/i,
    /(?:^|[,.!?:;]\s*|\s)(?:type|fill|write)\s+(.+?)\s+(?:(?:then|and then|and)\s+)?(?:press|hit)\s+enter\b/i,
    /(?:^|[,.!?:;]\s*|\s)(?:nhập|gõ)\s+(.+?)\s+(?:(?:rồi|sau đó|và sau đó|và)\s+)?(?:gửi|tìm|submit|search|send)\b/i,
    /(?:^|[,.!?:;]\s*|\s)(?:type|fill|write)\s+(.+?)\s+(?:(?:then|and then|and)\s+)?(?:submit|search|send)\b/i
  ];
  for (const pattern of patterns) {
    const match = instruction.match(pattern);
    const text = stripDeclaredText(match?.[1]);
    if (text) return text;
  }
  return null;
}

function taskDeclaredReplacement(task) {
  const instruction = cleanText(task?.instruction, 500);
  if (!instruction || instructionIsSensitive(instruction)) return null;
  const patterns = [
    /(?:thay|đổi)\s+.+?\s+(?:thành|bằng)\s+(.+?)(?:[.!?;]|$)/i,
    /(?:replace|change)\s+.+?\s+(?:with|to)\s+(.+?)(?:[.!?;]|$)/i
  ];
  for (const pattern of patterns) {
    const text = stripDeclaredText(instruction.match(pattern)?.[1]);
    if (text) return text;
  }
  return null;
}

function taskDeclaredClearThenText(task) {
  const instruction = cleanText(task?.instruction, 500);
  if (!instruction || instructionIsSensitive(instruction)) return null;
  const patterns = [
    /(?:xóa|xoá)\s+.+?\s+(?:rồi|sau đó)\s+(?:nhập|gõ)\s+(.+?)(?:[.!?;]|$)/i,
    /clear\s+.+?\s+(?:then|and then)\s+(?:type|enter|fill|write)\s+(.+?)(?:[.!?;]|$)/i
  ];
  for (const pattern of patterns) {
    const text = stripDeclaredText(instruction.match(pattern)?.[1]);
    if (text) return text;
  }
  return null;
}

function taskTextPlan(task) {
  const replacement = taskDeclaredReplacement(task);
  if (replacement) return { mode: 'replaceText', text: replacement };
  const clearedText = taskDeclaredClearThenText(task);
  if (clearedText) return { mode: 'clearThenType', text: clearedText };
  const text = taskDeclaredText(task);
  return text ? { mode: 'typeText', text } : null;
}

function semanticTargetForTransition(transition) {
  const found = Base.targetForTransition(transition || {});
  return { ref: found.ref, target: Base.semanticTarget(found.element) };
}

function noise(transitionId, hint, target, reasonCode) {
  return {
    transitionId,
    sourceHint: hint || null,
    status: 'capture-noise',
    semanticActionType: null,
    suggestedAction: null,
    exclusionReason: reasonCode,
    reasonCode,
    semanticTarget: target || null,
    requiresHumanConfirmation: true,
    autoTrainEligible: false
  };
}

function resolved(transitionId, hint, action, target, reasonCode) {
  return {
    transitionId,
    sourceHint: hint || null,
    status: 'resolved-semantic-action',
    semanticActionType: action.type,
    suggestedAction: action,
    exclusionReason: null,
    reasonCode,
    semanticTarget: target || null,
    requiresHumanConfirmation: true,
    autoTrainEligible: false
  };
}

function unresolved(transitionId, hint, target, reasonCode, semanticActionType = null) {
  return {
    transitionId,
    sourceHint: hint || null,
    status: 'needs-human-review',
    semanticActionType,
    suggestedAction: null,
    exclusionReason: null,
    reasonCode,
    semanticTarget: target || null,
    requiresHumanConfirmation: true,
    autoTrainEligible: false
  };
}

function normalizedPage(observation) {
  return {
    url: String(observation?.url || observation?.page?.url || ''),
    title: String(observation?.title || observation?.page?.title || '')
  };
}

function noObservablePageChange(transition) {
  const before = normalizedPage(transition?.strategyObservationBefore);
  const after = normalizedPage(transition?.strategyObservationAfter);
  return before.url === after.url && before.title === after.title;
}

function targetMatchesTask(target, task) {
  const taskWords = new Set(Base.words(task?.instruction));
  const targetWords = Base.words(target?.label || target?.role || target?.tag);
  return targetWords.some(word => word.length >= 3 && taskWords.has(word));
}

function laterTaskAlignedAction(transitions, index, task) {
  for (let i = index + 1; i < transitions.length; i += 1) {
    const transition = transitions[i];
    if (transition?.outcome?.actionSucceeded === false) continue;
    const kind = String(transition?.rawAction?.kind || '').toLowerCase();
    if (!['click', 'dom-click', 'submit', 'dom-submit'].includes(kind)) continue;
    const { target } = semanticTargetForTransition(transition);
    if (target && targetMatchesTask(target, task)) return true;
  }
  return false;
}

function rawModifiers(raw = {}) {
  const modifiers = raw.modifiers && typeof raw.modifiers === 'object' ? raw.modifiers : {};
  return {
    alt: !!modifiers.alt,
    ctrl: !!modifiers.ctrl,
    meta: !!modifiers.meta,
    shift: !!modifiers.shift
  };
}

function keyboardControl(rawAction = {}) {
  const candidates = [rawAction.key, rawAction.code, rawAction.operation]
    .filter(value => typeof value === 'string')
    .map(value => value.toLowerCase());
  if (candidates.some(value => value.includes('enter'))) return 'Enter';
  if (candidates.some(value => value.includes('escape') || value.includes('esc'))) return 'Escape';
  if (candidates.some(value => value.includes('tab'))) return 'Tab';
  return null;
}

function isTypedCharacter(rawAction = {}) {
  if (String(rawAction.kind || '').toLowerCase() !== 'text-key') return false;
  if (String(rawAction.operation || '').toLowerCase() !== 'type-char') return false;
  const m = rawModifiers(rawAction);
  return !m.ctrl && !m.meta && !m.alt;
}

function commandSelectAll(rawAction = {}) {
  if (String(rawAction.kind || '').toLowerCase() !== 'text-key') return false;
  if (String(rawAction.operation || '').toLowerCase() !== 'type-char') return false;
  const m = rawModifiers(rawAction);
  return m.ctrl || m.meta;
}

function typeCharGroups(transitions) {
  const groups = [];
  let current = null;
  for (const transition of transitions) {
    const raw = transition?.rawAction || {};
    const isChar = isTypedCharacter(raw);
    const ref = typeof raw.targetRef === 'string' ? raw.targetRef : null;
    if (!isChar) {
      current = null;
      continue;
    }
    if (!current || current.targetRef !== ref) {
      current = { targetRef: ref, transitionIds: [] };
      groups.push(current);
    }
    current.transitionIds.push(String(transition?.transitionId || ''));
  }
  return groups;
}

function semanticTargetKey(target) {
  if (!target?.editable) return null;
  const parts = [target.label, target.role, target.tag]
    .map(value => Base.words(value).join('-'))
    .filter(Boolean);
  return parts.join('|') || null;
}

function sameEditableTarget(left, right, leftRef = null, rightRef = null) {
  if (left?.editable !== true || right?.editable !== true) return false;
  if (leftRef && rightRef && leftRef === rightRef) return true;
  const leftKey = semanticTargetKey(left);
  return !!leftKey && leftKey === semanticTargetKey(right);
}

function taskRequestsSubmit(task) {
  return Base.taskMentions(task || {}, [
    'submit', 'search', 'send', 'go', 'enter',
    'tim', 'gui', 'nop', 'xacnhan', 'confirm'
  ]);
}

function taskExplicitlyRequestsEnter(task) {
  return Base.taskMentions(task || {}, ['enter']);
}

function successfulFinalOutcome(sourceReview) {
  return String(sourceReview?.finalOutcome?.status || '').toLowerCase() === 'success';
}

function semanticElementState(element) {
  if (!element || typeof element !== 'object') return null;
  return {
    label: cleanText(element.label, 120),
    role: cleanText(element.role, 80),
    tag: cleanText(element.tag, 40),
    editable: element.editable === true,
    enabled: element.enabled !== false,
    visible: element.visible !== false && element.rendered !== false,
    checked: typeof element.checked === 'boolean' ? element.checked : null,
    selected: typeof element.selected === 'boolean' ? element.selected : null,
    selectedIndex: Number.isInteger(Number(element.selectedIndex)) ? Number(element.selectedIndex) : null,
    rangeValue: Number.isFinite(Number(element.rangeValue)) ? Number(element.rangeValue) : null
  };
}

function semanticObservationFingerprint(observation) {
  const page = normalizedPage(observation);
  const direct = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  const nested = Array.isArray(observation?.page?.interactiveElements) ? observation.page.interactiveElements : [];
  const elements = (direct.length ? direct : nested)
    .map(semanticElementState)
    .filter(Boolean)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify({ page, elements, pageSignals: observation?.pageSignals || observation?.page?.pageSignals || {} });
}

function observableSemanticStateChanged(transition) {
  return semanticObservationFingerprint(transition?.strategyObservationBefore) !==
    semanticObservationFingerprint(transition?.strategyObservationAfter);
}

function capturedSuccess(transition) {
  return transition?.outcome?.actionSucceeded !== false;
}

function textEntryMechanicalKey(rawAction = {}) {
  const kind = String(rawAction.kind || '').toLowerCase();
  if (kind !== 'text-key' || keyboardControl(rawAction)) return false;
  const operation = String(rawAction.operation || '').toLowerCase();
  return ['backspace', 'delete', 'other-key'].includes(operation) || commandSelectAll(rawAction);
}

function sequenceCompatibleNoise(transition, target, ref) {
  const raw = transition?.rawAction || {};
  const kind = String(raw.kind || '').toLowerCase();
  const found = semanticTargetForTransition(transition);
  const sameTarget = sameEditableTarget(found.target, target, found.ref, ref);
  if (kind === 'text-change') return sameTarget;
  if (['focus', 'dom-focus', 'click', 'dom-click'].includes(kind)) return sameTarget;
  if (textEntryMechanicalKey(raw)) return sameTarget;
  return false;
}

function semanticSubmissionControl(target) {
  const tokens = new Set(Base.words(target?.label || target?.role || target?.tag));
  return ['submit', 'send', 'search', 'go', 'confirm', 'gui', 'tim', 'nop', 'xacnhan']
    .some(token => tokens.has(token));
}

function competingSubmitActionAfter(transitions, enterIndex, task) {
  const matches = [];
  for (let index = enterIndex + 1; index < transitions.length; index += 1) {
    const transition = transitions[index];
    if (!capturedSuccess(transition)) continue;
    const kind = String(transition?.rawAction?.kind || '').toLowerCase();
    if (!['click', 'dom-click', 'submit', 'dom-submit'].includes(kind)) continue;
    const { target } = semanticTargetForTransition(transition);
    const submitLike = ['submit', 'dom-submit'].includes(kind) || semanticSubmissionControl(target) || targetMatchesTask(target, task);
    if (submitLike) matches.push({ index, transition, target });
  }
  return matches;
}

function genericTextFormSequence(transitions, task, sourceReview) {
  const plan = taskTextPlan(task || {});
  if (!plan || !successfulFinalOutcome(sourceReview)) return null;

  const chars = [];
  for (let index = 0; index < transitions.length; index += 1) {
    const transition = transitions[index];
    const raw = transition?.rawAction || {};
    if (!isTypedCharacter(raw)) continue;
    const found = semanticTargetForTransition(transition);
    if (!capturedSuccess(transition) || found.target?.editable !== true || !found.ref) return null;
    chars.push({ index, transition, ...found });
  }
  if (!chars.length) return null;

  const anchor = chars[0];
  if (chars.some(item => !sameEditableTarget(item.target, anchor.target, item.ref, anchor.ref))) return null;

  let startIndex = anchor.index;
  for (let index = anchor.index - 1; index >= 0; index -= 1) {
    if (!sequenceCompatibleNoise(transitions[index], anchor.target, anchor.ref)) break;
    startIndex = index;
  }

  const prelude = [];
  for (let index = startIndex; index < anchor.index; index += 1) prelude.push({ index, transition: transitions[index] });
  const selectAllItem = prelude.find(item => commandSelectAll(item.transition?.rawAction || {})) || null;
  const deleteItems = prelude.filter(item => ['backspace', 'delete'].includes(String(item.transition?.rawAction?.operation || '').toLowerCase()));
  if (plan.mode === 'replaceText' && !selectAllItem && !deleteItems.length) return null;
  if (plan.mode === 'clearThenType' && !deleteItems.length) return null;

  const lastChar = chars[chars.length - 1];
  let enter = null;
  for (let index = lastChar.index + 1; index < transitions.length; index += 1) {
    const transition = transitions[index];
    const raw = transition?.rawAction || {};
    const found = semanticTargetForTransition(transition);
    if (String(raw.kind || '').toLowerCase() === 'text-key' && keyboardControl(raw) === 'Enter') {
      if (!capturedSuccess(transition) || !sameEditableTarget(found.target, anchor.target, found.ref, anchor.ref)) return null;
      enter = { index, transition, ...found };
      break;
    }
    if (!sequenceCompatibleNoise(transition, anchor.target, anchor.ref)) break;
  }

  const wantsSubmit = taskRequestsSubmit(task || {});
  const enterExplicit = taskExplicitlyRequestsEnter(task || {});
  let competing = [];
  let pageOrSemanticChange = false;
  if (enter) {
    pageOrSemanticChange = observableSemanticStateChanged(enter.transition) ||
      normalizedPage(transitions[startIndex]?.strategyObservationBefore).url !== normalizedPage(enter.transition?.strategyObservationAfter).url;
    competing = competingSubmitActionAfter(transitions, enter.index, task || {});
    if (wantsSubmit) {
      const enterOutcomeSupported = pageOrSemanticChange || enterExplicit || competing.length === 0;
      if (!enterOutcomeSupported) return null;
    }
  } else if (enterExplicit) {
    return null;
  }

  const charIds = chars.map(item => String(item.transition?.transitionId || ''));
  const firstTypeTransitionId = charIds[0];
  const noiseIds = new Set();
  const postSubmitNoiseTransitionIds = new Set();
  const semanticActionByTransition = new Map();

  if (plan.mode === 'replaceText') {
    semanticActionByTransition.set(firstTypeTransitionId, Base.safeAction('replaceText', anchor.ref, { text: plan.text }, 'task-declared-semantic-replace-text'));
  } else {
    semanticActionByTransition.set(firstTypeTransitionId, Base.safeAction('typeText', anchor.ref, { text: plan.text }, 'task-declared-semantic-text-entry'));
  }

  let clearTransitionId = '';
  if (plan.mode === 'clearThenType') {
    clearTransitionId = String(deleteItems[0]?.transition?.transitionId || '');
    if (!clearTransitionId) return null;
    semanticActionByTransition.set(clearTransitionId, Base.safeAction('clear', anchor.ref, {}, 'task-declared-semantic-clear'));
  }

  for (let index = startIndex; index <= lastChar.index; index += 1) {
    const transition = transitions[index];
    const id = String(transition?.transitionId || '');
    if (!id || semanticActionByTransition.has(id)) continue;
    const found = semanticTargetForTransition(transition);
    if (sameEditableTarget(found.target, anchor.target, found.ref, anchor.ref) &&
        (sequenceCompatibleNoise(transition, anchor.target, anchor.ref) || charIds.includes(id))) {
      noiseIds.add(id);
    }
  }

  let submitTransitionId = '';
  if (wantsSubmit && enter) {
    submitTransitionId = String(enter.transition?.transitionId || '');
    semanticActionByTransition.set(submitTransitionId, Base.safeAction('submit', anchor.ref, {}, 'semantic-submit-via-enter'));
  }

  if (enterExplicit && enter) {
    for (const item of competing) {
      const kind = String(item.transition?.rawAction?.kind || '').toLowerCase();
      if (!['click', 'dom-click'].includes(kind)) continue;
      if (!semanticSubmissionControl(item.target)) continue;
      if (observableSemanticStateChanged(item.transition)) continue;
      const id = String(item.transition?.transitionId || '');
      if (!id) continue;
      noiseIds.add(id);
      postSubmitNoiseTransitionIds.add(id);
    }
  }

  return {
    mode: plan.mode,
    declaredText: plan.text,
    targetRef: anchor.ref,
    target: anchor.target,
    startTransitionId: String(transitions[startIndex]?.transitionId || ''),
    firstTypeTransitionId,
    clearTransitionId,
    charTransitionIds: new Set(charIds),
    submitTransitionId,
    noiseTransitionIds: noiseIds,
    postSubmitNoiseTransitionIds,
    semanticActionByTransition,
    outcomeEvidence: {
      finalOutcomeSuccess: true,
      enterActionSucceeded: enter ? true : null,
      observableSemanticStateChanged: pageOrSemanticChange,
      taskExplicitlyRequestsEnter: enterExplicit,
      competingPostEnterSubmitActionCount: competing.length
    }
  };
}

function scoreMap(triageItem) {
  return new Map((Array.isArray(triageItem?.transitions) ? triageItem.transitions : [])
    .map(item => [String(item?.transitionId || ''), item]));
}

function proposalMap(packItem) {
  return new Map((Array.isArray(packItem?.proposals) ? packItem.proposals : [])
    .map(item => [String(item?.transitionId || ''), item]));
}

function resolveTeachingItem(packItem, triageItem, sourceReview) {
  const transitions = Array.isArray(sourceReview?.transitions) ? sourceReview.transitions : [];
  const byScore = scoreMap(triageItem);
  const byProposal = proposalMap(packItem);
  const textPlan = taskTextPlan(packItem?.task || sourceReview?.task || {});
  const textSequence = genericTextFormSequence(transitions, packItem?.task || sourceReview?.task || {}, sourceReview);
  const resolutions = [];

  for (let index = 0; index < transitions.length; index += 1) {
    const transition = transitions[index];
    const transitionId = String(transition?.transitionId || '');
    const proposal = byProposal.get(transitionId) || null;
    const score = byScore.get(transitionId) || null;
    const raw = transition?.rawAction || {};
    const kind = String(raw.kind || '').toLowerCase();
    const operation = String(raw.operation || '').toLowerCase();
    const hint = proposal?.proposal?.actionTypeHint || score?.actionTypeHint || null;
    const { ref, target } = semanticTargetForTransition(transition);
    const actionCapturedSuccess = proposal?.evidence?.actionSucceededCaptured !== false && capturedSuccess(transition);

    if (!actionCapturedSuccess) {
      if (score?.fastLabelReviewCandidate !== true) resolutions.push(unresolved(transitionId, hint, target, 'captured_action_failure_requires_human_review'));
      continue;
    }

    const sequenceAction = textSequence?.semanticActionByTransition.get(transitionId) || null;
    if (sequenceAction) {
      const reason = sequenceAction.type === 'clear'
        ? 'task_declared_clear_collapsed_from_editing_mechanics'
        : sequenceAction.type === 'replaceText'
          ? 'task_declared_replace_collapsed_from_editing_sequence'
          : sequenceAction.type === 'submit'
            ? 'enter_on_continuous_editable_target_with_successful_task_outcome'
            : 'per_character_capture_collapsed_to_task_declared_text_action';
      resolutions.push(resolved(transitionId, hint || 'keyboard-action-review-required', sequenceAction, target, reason));
      continue;
    }

    if (textSequence?.noiseTransitionIds.has(transitionId)) {
      const reason = textSequence.postSubmitNoiseTransitionIds.has(transitionId)
        ? 'redundant_post_enter_submit_surface_click_how_not_strategy'
        : ['focus', 'dom-focus'].includes(kind)
          ? 'focus_acquisition_how_not_strategy'
          : ['click', 'dom-click'].includes(kind)
            ? 'editable_target_click_focus_acquisition_how_not_strategy'
            : kind === 'text-change'
              ? 'text_change_capture_provenance_how_not_strategy'
              : kind === 'text-key' && ['backspace', 'delete', 'other-key'].includes(operation)
                ? 'text_entry_editing_mechanic_how_not_strategy'
                : commandSelectAll(raw)
                  ? 'text_entry_editing_mechanic_how_not_strategy'
                  : 'per_character_capture_collapsed_into_single_text_action';
      resolutions.push(noise(transitionId, hint || (kind === 'text-key' ? 'keyboard-action-review-required' : kind), target, reason));
      continue;
    }

    if ((kind === 'focus' || kind === 'dom-focus') && !Base.taskMentions(packItem?.task || {}, ['focus'])) {
      resolutions.push(noise(transitionId, hint || 'focus', target, 'focus_acquisition_how_not_strategy'));
      continue;
    }

    if ((kind === 'click' || kind === 'dom-click') && target?.editable === true && textPlan) {
      resolutions.push(noise(transitionId, hint || 'click', target, 'editable_target_click_focus_acquisition_how_not_strategy'));
      continue;
    }

    if ((kind === 'click' || kind === 'dom-click') && !target && noObservablePageChange(transition) && laterTaskAlignedAction(transitions, index, packItem?.task || {})) {
      resolutions.push(noise(transitionId, hint || 'click', null, 'targetless_no_effect_click_superseded_by_task_aligned_action'));
      continue;
    }

    if (kind === 'text-key' && isTypedCharacter(raw)) {
      resolutions.push(unresolved(transitionId, hint || 'keyboard-action-review-required', target, 'text_entry_sequence_evidence_insufficient', textPlan?.mode === 'replaceText' ? 'replaceText' : 'typeText'));
      continue;
    }

    if (kind === 'text-change' && textSequence && sameEditableTarget(target, textSequence.target, ref, textSequence.targetRef)) {
      resolutions.push(noise(transitionId, hint || 'text-action-review-required', target, 'text_change_capture_provenance_how_not_strategy'));
      continue;
    }

    if (score?.fastLabelReviewCandidate === true) continue;
    resolutions.push(Base.resolveAmbiguousTransition({ proposal, transition, task: packItem?.task || sourceReview?.task || {} }));
  }

  const ambiguousIds = new Set((Array.isArray(triageItem?.transitions) ? triageItem.transitions : [])
    .filter(item => item?.fastLabelReviewCandidate !== true)
    .map(item => String(item?.transitionId || '')));
  const resolutionById = new Map(resolutions.map(item => [String(item?.transitionId || ''), item]));
  const unresolvedAmbiguous = [...ambiguousIds].filter(id => !['capture-noise', 'resolved-semantic-action'].includes(resolutionById.get(id)?.status));
  const resolvedCount = resolutions.filter(item => item.status === 'resolved-semantic-action').length;
  const captureNoiseCount = resolutions.filter(item => item.status === 'capture-noise').length;
  const unresolvedCount = resolutions.filter(item => item.status === 'needs-human-review').length;

  return {
    episodeId: packItem?.episodeId || null,
    task: packItem?.task || null,
    finalOutcomeStatus: packItem?.finalOutcomeStatus || null,
    ambiguousTransitionCount: ambiguousIds.size,
    reviewAidTransitionCount: resolutions.length,
    resolvedSemanticActionCount: resolvedCount,
    captureNoiseCount,
    unresolvedHumanReviewCount: unresolvedCount,
    unresolvedAmbiguousTransitionCount: unresolvedAmbiguous.length,
    allAmbiguityResolvedForApprovalAid: ambiguousIds.size === 0 || unresolvedAmbiguous.length === 0,
    resolutions
  };
}

function markdownFor(result) {
  const lines = [
    '# Strategy teaching-batch resolution', '',
    `Episodes: ${result.episodeCount}`,
    `Ambiguous transitions: ${result.ambiguousTransitionCount}`,
    `Resolved semantic actions: ${result.resolvedSemanticActionCount}`,
    `Capture noise: ${result.captureNoiseCount}`,
    `Still needs human review: ${result.unresolvedHumanReviewCount}`,
    `Episodes fully resolved as review aids: ${result.fullyResolvedEpisodeCount}`, '',
    '> Review aids only. Nothing here is human verification or automatic Strategy training eligibility.', ''
  ];
  for (const item of result.items) {
    lines.push(`## ${item.episodeId || '<unknown>'}`, '', `Task: ${String(item.task?.instruction || '').replace(/\s+/g, ' ').trim()}`);
    for (const resolution of item.resolutions) {
      const target = resolution.semanticTarget?.label || resolution.semanticTarget?.role || resolution.semanticTarget?.tag || '<target missing>';
      const action = resolution.suggestedAction?.type || resolution.semanticActionType || '-';
      lines.push(`- ${resolution.transitionId}: ${resolution.status}; action=${action}; target=${target}; reason=${resolution.reasonCode}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function resolveTeachingBatch(packFile, triageFile, outputDir) {
  const fullPack = path.resolve(packFile);
  const fullTriage = path.resolve(triageFile);
  const pack = readJson(fullPack);
  const triage = readJson(fullTriage);
  const triageByEpisode = new Map((Array.isArray(triage?.items) ? triage.items : []).map(item => [String(item?.episodeId || ''), item]));
  const items = [];

  for (const packItem of (Array.isArray(pack?.items) ? pack.items : []).filter(item => item?.status === 'awaiting-human-review')) {
    const triageItem = triageByEpisode.get(String(packItem?.episodeId || '')) || null;
    if (!triageItem) throw new Error(`triage_episode_missing:${packItem?.episodeId || '<unknown>'}`);
    const sourceFile = resolveFile(packItem?.sourceFile);
    if (!sourceFile || !fs.existsSync(sourceFile)) throw new Error(`review_source_missing:${packItem?.episodeId || '<unknown>'}`);
    items.push(resolveTeachingItem(packItem, triageItem, readJson(sourceFile)));
  }

  const result = {
    ambiguityResolverVersion: `teaching-batch-${TEACHING_BATCH_RESOLVER_VERSION}`,
    teachingBatchResolverVersion: TEACHING_BATCH_RESOLVER_VERSION,
    generatedAt: new Date().toISOString(),
    sourcePack: path.relative(process.cwd(), fullPack),
    sourceTriage: path.relative(process.cwd(), fullTriage),
    episodeCount: items.length,
    ambiguousTransitionCount: items.reduce((sum, item) => sum + item.ambiguousTransitionCount, 0),
    resolvedSemanticActionCount: items.reduce((sum, item) => sum + item.resolvedSemanticActionCount, 0),
    captureNoiseCount: items.reduce((sum, item) => sum + item.captureNoiseCount, 0),
    unresolvedHumanReviewCount: items.reduce((sum, item) => sum + item.unresolvedHumanReviewCount, 0),
    fullyResolvedEpisodeCount: items.filter(item => item.allAmbiguityResolvedForApprovalAid).length,
    policy: {
      reviewAidOnly: true,
      taskDeclaredTextOnly: true,
      sensitiveTaskTextRejected: true,
      rawKeyCharacterValuesNeverStored: true,
      perCharacterCaptureCollapsed: true,
      typeOnlySequenceSupported: true,
      replaceTextSequenceSupported: true,
      clearThenTypeSequenceSupported: true,
      textEditingMechanicsCollapsedIntoHowNoise: true,
      semanticEditableTargetContinuityRequired: true,
      submitRequiresTaskIntentAndSuccessfulOutcomeEvidence: true,
      competingPostEnterSubmitRequiresExplicitEnterOrObservableEnterOutcome: true,
      redundantPostEnterSubmitSurfaceClickMayBeExcludedOnlyWhenEnterExplicitlyRequested: true,
      focusAcquisitionExcludedFromStrategy: true,
      editableFieldClickAcquisitionExcludedFromStrategy: true,
      textChangeCaptureExcludedFromStrategy: true,
      targetlessNoEffectClickMayBeProposedAsNoiseOnlyWhenLaterTaskAlignedActionExists: true,
      requiresHumanConfirmation: true,
      autoTrainEligible: false
    },
    items
  };

  const outDir = path.resolve(outputDir || path.join(path.dirname(fullTriage), 'strategy-teaching-resolution-v01'));
  fs.mkdirSync(outDir, { recursive: true });
  const jsonFile = path.join(outDir, 'ambiguity-resolution.json');
  const markdownFile = path.join(outDir, 'ambiguity-resolution.md');
  fs.writeFileSync(jsonFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownFile, markdownFor(result), 'utf8');
  return { result, jsonFile, markdownFile };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    if (!args.pack || !args.triage) throw new Error('Usage: node training-collector/tools/resolve_strategy_teaching_batch.js --pack <review-pack.json> --triage <triage.json> [--out dir]');
    const resolvedBatch = resolveTeachingBatch(args.pack, args.triage, args.out);
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      version: resolvedBatch.result.teachingBatchResolverVersion,
      episodeCount: resolvedBatch.result.episodeCount,
      ambiguousTransitionCount: resolvedBatch.result.ambiguousTransitionCount,
      resolvedSemanticActionCount: resolvedBatch.result.resolvedSemanticActionCount,
      captureNoiseCount: resolvedBatch.result.captureNoiseCount,
      unresolvedHumanReviewCount: resolvedBatch.result.unresolvedHumanReviewCount,
      fullyResolvedEpisodeCount: resolvedBatch.result.fullyResolvedEpisodeCount,
      autoTrainEligible: resolvedBatch.result.policy.autoTrainEligible,
      resolution: path.resolve(resolvedBatch.jsonFile),
      markdown: path.resolve(resolvedBatch.markdownFile)
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  TEACHING_BATCH_RESOLVER_VERSION,
  cleanText,
  instructionIsSensitive,
  taskDeclaredText,
  taskDeclaredReplacement,
  taskDeclaredClearThenText,
  taskTextPlan,
  semanticTargetForTransition,
  noObservablePageChange,
  targetMatchesTask,
  laterTaskAlignedAction,
  rawModifiers,
  isTypedCharacter,
  commandSelectAll,
  typeCharGroups,
  semanticTargetKey,
  sameEditableTarget,
  keyboardControl,
  taskRequestsSubmit,
  taskExplicitlyRequestsEnter,
  textEntryMechanicalKey,
  semanticSubmissionControl,
  competingSubmitActionAfter,
  semanticObservationFingerprint,
  observableSemanticStateChanged,
  genericTextFormSequence,
  resolveTeachingItem,
  markdownFor,
  resolveTeachingBatch,
  parseArgs,
  main
};
