#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { validateAgentAction } = require('../../control-center/manager/strategy/agent_action_contract.js');

const AMBIGUITY_RESOLVER_VERSION = '0.4.0';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveFile(file) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.resolve(file);
}

function words(value) {
  return (String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .match(/[a-z0-9]+/g) || []);
}

function taskMentions(task, candidates) {
  const set = new Set(words(task?.instruction));
  return candidates.some(word => set.has(word));
}

function taskRequestsDoubleClick(task) {
  const tokens = new Set(words(task?.instruction));
  return (tokens.has('double') && tokens.has('click')) ||
    (tokens.has('nhap') && tokens.has('dup')) ||
    (tokens.has('click') && tokens.has('dup'));
}

function cleanDeclaredValue(value) {
  const text = String(value || '').replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').replace(/[,.!?:;]+$/g, '').trim();
  return text && text.length <= 120 ? text : null;
}

function taskDeclaredSelection(task) {
  const instruction = String(task?.instruction || '');
  const patterns = [
    /(?:^|[,.;:]\s*|\s)chọn\s+(.+?)(?=\s+rồi\b|\s+và\b|,|\.|;|$)/i,
    /(?:^|[,.;:]\s*|\s)(?:select|choose)\s+(.+?)(?=\s+then\b|\s+and\b|,|\.|;|$)/i
  ];
  for (const pattern of patterns) {
    const value = cleanDeclaredValue(instruction.match(pattern)?.[1]);
    if (value) return value;
  }
  return null;
}

function taskDeclaredPlaybackRate(task) {
  const instruction = String(task?.instruction || '');
  const match = instruction.match(/(?:tốc\s*độ|toc\s*do|speed|playback\s*rate)\s*([0-9]+(?:\.[0-9]+)?)\s*x?/i);
  return match ? Number(match[1]) : null;
}

function transitionById(review, transitionId) {
  return (Array.isArray(review?.transitions) ? review.transitions : [])
    .find(item => String(item?.transitionId || '') === String(transitionId || '')) || null;
}

function observationElements(observation) {
  const direct = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  const nested = Array.isArray(observation?.page?.interactiveElements) ? observation.page.interactiveElements : [];
  return direct.length ? direct : nested;
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizedMediaState(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    paused: value.paused === true,
    muted: value.muted === true,
    volume: finiteOrNull(value.volume),
    currentTime: finiteOrNull(value.currentTime),
    duration: finiteOrNull(value.duration),
    playbackRate: finiteOrNull(value.playbackRate)
  };
}

function observationFingerprint(observation) {
  const elements = observationElements(observation).map(element => ({
    ref: element?.ref || element?.elementRef || null,
    label: typeof element?.label === 'string' ? element.label : null,
    role: typeof element?.role === 'string' ? element.role : null,
    tag: typeof element?.tag === 'string' ? element.tag : null,
    inputType: typeof element?.inputType === 'string' ? element.inputType : null,
    visible: element?.visible !== false && element?.rendered !== false,
    enabled: element?.enabled !== false,
    draggable: element?.draggable === true,
    checked: typeof element?.checked === 'boolean' ? element.checked : null,
    selectedIndex: Number.isInteger(Number(element?.selectedIndex)) ? Number(element.selectedIndex) : null,
    rangeValue: finiteOrNull(element?.rangeValue),
    rangeMin: finiteOrNull(element?.rangeMin),
    rangeMax: finiteOrNull(element?.rangeMax),
    mediaState: normalizedMediaState(element?.mediaState)
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify({
    url: String(observation?.url || observation?.page?.url || ''),
    elements,
    pageSignals: observation?.pageSignals || observation?.page?.pageSignals || {}
  });
}

function observableSemanticStateChanged(transition) {
  return observationFingerprint(transition?.strategyObservationBefore) !==
    observationFingerprint(transition?.strategyObservationAfter);
}

function targetForTransition(transition) {
  const ref = typeof transition?.rawAction?.targetRef === 'string' && transition.rawAction.targetRef.trim()
    ? transition.rawAction.targetRef.trim()
    : null;
  if (!ref) return { ref: null, element: null };
  const element = observationElements(transition?.strategyObservationBefore)
    .find(item => item?.ref === ref || item?.elementRef === ref || item?.targetRef === ref) || null;
  return { ref, element };
}

function targetAfterForTransition(transition, ref = null) {
  const targetRef = ref || transition?.rawAction?.targetRef || null;
  if (!targetRef) return null;
  return observationElements(transition?.strategyObservationAfter)
    .find(item => item?.ref === targetRef || item?.elementRef === targetRef || item?.targetRef === targetRef) || null;
}

function semanticTarget(element) {
  if (!element) return null;
  return {
    label: typeof element.label === 'string' ? element.label : null,
    role: typeof element.role === 'string' ? element.role : null,
    tag: typeof element.tag === 'string' ? element.tag : null,
    inputType: typeof element.inputType === 'string' ? element.inputType : null,
    editable: element.editable === true,
    draggable: element.draggable === true,
    enabled: element.enabled !== false,
    visible: element.visible !== false && element.rendered !== false,
    checked: typeof element.checked === 'boolean' ? element.checked : null,
    selected: typeof element.selected === 'boolean' ? element.selected : null,
    selectedIndex: Number.isInteger(Number(element.selectedIndex)) ? Number(element.selectedIndex) : null,
    rangeValue: finiteOrNull(element.rangeValue),
    rangeMin: finiteOrNull(element.rangeMin),
    rangeMax: finiteOrNull(element.rangeMax),
    rangeStep: finiteOrNull(element.rangeStep),
    mediaState: normalizedMediaState(element.mediaState)
  };
}

function safeAction(type, targetRef, args = {}, intent = null) {
  return validateAgentAction({
    contractVersion: '0.1.0',
    type,
    targetRef: targetRef || null,
    args,
    intent: intent || `ambiguity-resolution:${type}`,
    expectedOutcome: {}
  });
}

function controlKey(rawAction = {}) {
  const candidates = [rawAction.key, rawAction.code, rawAction.operation]
    .filter(value => typeof value === 'string')
    .map(value => value.toLowerCase());
  for (const value of candidates) {
    if (value.includes('enter')) return 'Enter';
    if (value.includes('escape') || value.includes('esc')) return 'Escape';
    if (value.includes('tab')) return 'Tab';
  }
  return null;
}

function finiteCandidate(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return 0;
}

function scrollDirection(rawAction = {}) {
  const dx = finiteCandidate(rawAction.deltaX, rawAction.dx, rawAction.wheelDeltaX, rawAction?.scroll?.deltaX);
  const dy = finiteCandidate(rawAction.deltaY, rawAction.dy, rawAction.wheelDeltaY, rawAction?.scroll?.deltaY);
  if (Math.abs(dx) > Math.abs(dy) && dx !== 0) return 'horizontal';
  if (dy !== 0) return 'vertical';
  const op = String(rawAction.operation || rawAction.kind || '').toLowerCase();
  if (op.includes('horizontal')) return 'horizontal';
  if (op.includes('vertical')) return 'vertical';
  return null;
}

function targetKind(element) {
  const role = String(element?.role || '').toLowerCase();
  const tag = String(element?.tag || '').toLowerCase();
  const inputType = String(element?.inputType || '').toLowerCase();
  if (role === 'checkbox' || role === 'switch' || (tag === 'input' && inputType === 'checkbox')) return 'toggle';
  if (role === 'radio' || (tag === 'input' && inputType === 'radio')) return 'radio';
  if (tag === 'select' || role === 'combobox' || role === 'listbox') return 'select';
  if (tag === 'input' && inputType === 'range') return 'range';
  if (element?.editable === true || role === 'textbox' || role === 'searchbox' || tag === 'textarea') return 'editable';
  return 'other';
}

function targetLabelWords(target) {
  return new Set(words(target?.label));
}

function mediaRangeActionType(target) {
  const tokens = targetLabelWords(target);
  if (tokens.has('volume') || tokens.has('am') || tokens.has('luong')) return 'setVolume';
  if (tokens.has('seek') || tokens.has('timeline') || tokens.has('position') || tokens.has('tua')) return 'seek';
  return null;
}

function normalizedRangeRequest(type, rawAction = {}) {
  const value = finiteOrNull(rawAction.rangeValue);
  const min = finiteOrNull(rawAction.rangeMin);
  const max = finiteOrNull(rawAction.rangeMax);
  if (value == null) return null;
  if (type === 'setVolume' && min === 0 && max === 100) return value;
  if (type === 'seek' && min === 0 && max === 100) return value;
  return value;
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
    semanticTarget: target,
    requiresHumanConfirmation: true,
    autoTrainEligible: false
  };
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
    semanticTarget: target,
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
    semanticTarget: target,
    requiresHumanConfirmation: true,
    autoTrainEligible: false
  };
}

function resolveFormChange({ transitionId, hint, transition, task, ref, element, target }) {
  const raw = transition?.rawAction || {};
  const afterElement = targetAfterForTransition(transition, ref);
  const afterTarget = semanticTarget(afterElement) || target;
  const kind = targetKind(element || target || afterTarget || {});

  if ((kind === 'toggle' || kind === 'radio') && ref) {
    const desired = typeof raw.checked === 'boolean'
      ? raw.checked
      : typeof afterTarget?.checked === 'boolean' ? afterTarget.checked : null;
    if (desired == null) return unresolved(transitionId, hint, target, 'checkable_desired_state_missing', 'setChecked');
    return resolved(
      transitionId,
      hint,
      safeAction('setChecked', ref, { value: desired }, 'captured-checkable-state-change'),
      target,
      'captured_checkable_desired_state'
    );
  }

  if (kind === 'select' && ref) {
    const labelTokens = targetLabelWords(target);
    const isPlaybackRate = labelTokens.has('playback') || labelTokens.has('speed') || labelTokens.has('rate') || (labelTokens.has('toc') && labelTokens.has('do'));
    if (isPlaybackRate) {
      const rate = taskDeclaredPlaybackRate(task);
      if (rate == null) return unresolved(transitionId, hint, target, 'playback_rate_value_requires_human_review', 'changePlaybackRate');
      return resolved(transitionId, hint, safeAction('changePlaybackRate', ref, { value: rate }, 'task-declared-playback-rate'), target, 'task_declared_playback_rate');
    }
    const selection = taskDeclaredSelection(task);
    if (!selection) return unresolved(transitionId, hint, target, 'selection_value_requires_human_review', 'selectOption');
    return resolved(transitionId, hint, safeAction('selectOption', ref, { value: selection }, 'task-declared-select-option'), target, 'task_declared_selection_value');
  }

  if (kind === 'range' && ref) {
    const mediaType = mediaRangeActionType(target);
    if (!mediaType) return unresolved(transitionId, hint, target, 'range_semantic_requires_human_review');
    const requested = normalizedRangeRequest(mediaType, raw);
    if (requested == null) return unresolved(transitionId, hint, target, 'media_range_value_missing', mediaType);
    return resolved(transitionId, hint, safeAction(mediaType, ref, { value: requested }, 'captured-media-range-change'), target, 'captured_media_range_value');
  }

  return unresolved(transitionId, hint, target, 'form_control_semantics_insufficient');
}

function resolveMediaAction({ transitionId, hint, transition, ref, target }) {
  const raw = transition?.rawAction || {};
  const operation = String(raw.operation || '').trim();
  if (!ref) return unresolved(transitionId, hint, target, 'media_target_required');
  if (['play', 'pause', 'mute', 'unmute'].includes(operation)) {
    return resolved(transitionId, hint, safeAction(operation, ref, {}, `captured-media-${operation}`), target, 'captured_media_operation');
  }
  if (operation === 'changePlaybackRate' && finiteOrNull(raw.playbackRate) != null) {
    return resolved(transitionId, hint, safeAction('changePlaybackRate', ref, { value: Number(raw.playbackRate) }, 'captured-playback-rate'), target, 'captured_playback_rate');
  }
  return unresolved(transitionId, hint, target, operation ? `unsupported_media_operation_${operation}` : 'media_operation_missing');
}

function resolveAmbiguousTransition({ proposal, transition, task }) {
  const transitionId = proposal?.transitionId || transition?.transitionId || null;
  const hint = proposal?.proposal?.actionTypeHint || null;
  const { ref, element } = targetForTransition(transition || {});
  const target = semanticTarget(element) || proposal?.evidence?.targetBefore || null;
  const capturedSuccess = proposal?.evidence?.actionSucceededCaptured !== false && transition?.outcome?.actionSucceeded !== false;

  if (!capturedSuccess) return unresolved(transitionId, hint, target, 'captured_action_failure_requires_human_review');

  if (hint === 'form-control-click-review-required') {
    return noise(transitionId, hint, target, 'form_control_surface_click_how_not_strategy');
  }

  if (hint === 'click' && taskRequestsDoubleClick(task)) {
    return noise(transitionId, hint, target, 'component_click_of_explicit_double_click_how_not_strategy');
  }

  if (hint === 'doubleClick') {
    if (!ref) return unresolved(transitionId, hint, target, 'double_click_target_required', 'doubleClick');
    return resolved(transitionId, hint, safeAction('doubleClick', ref, {}, 'captured-semantic-double-click'), target, 'captured_double_click_with_semantic_target');
  }

  if (hint === 'hoverAndObserve' || hint === 'hover-review-required') {
    if (!ref) return unresolved(transitionId, hint, target, 'hover_target_required', 'hoverAndObserve');
    if (!observableSemanticStateChanged(transition)) {
      return noise(transitionId, hint, target, 'incidental_hover_without_semantic_state_change_how_not_strategy');
    }
    return resolved(transitionId, hint, safeAction('hoverAndObserve', ref, {}, 'captured-hover-semantic-state-change'), target, 'hover_revealed_or_changed_semantic_state');
  }

  if (hint === 'drag' || hint === 'drag-review-required') {
    const destinationRef = typeof transition?.rawAction?.destinationRef === 'string'
      ? transition.rawAction.destinationRef.trim()
      : '';
    if (!ref) return unresolved(transitionId, hint, target, 'drag_source_target_required', 'drag');
    if (!destinationRef || destinationRef === ref) return unresolved(transitionId, hint, target, 'drag_destination_target_required', 'drag');
    return resolved(transitionId, hint, safeAction('drag', ref, { destinationRef }, 'captured-semantic-drag'), target, 'captured_drag_source_and_destination_refs');
  }

  if (hint === 'form-control-review-required' || hint === 'media-range-review-required') {
    return resolveFormChange({ transitionId, hint, transition, task, ref, element, target });
  }

  if (hint === 'media-action-review-required') {
    return resolveMediaAction({ transitionId, hint, transition, ref, target });
  }

  if (hint === 'text-action-review-required') {
    const kind = targetKind(element || target || {});
    if (kind === 'editable') {
      return unresolved(transitionId, hint, target, 'text_content_intentionally_redacted_requires_human_review', 'typeText');
    }
    return unresolved(transitionId, hint, target, 'text_action_target_not_semantically_editable');
  }

  if (hint === 'keyboard-action-review-required') {
    const key = controlKey(transition?.rawAction || {});
    if (key === 'Tab') {
      if (!taskMentions(task, ['tab'])) return noise(transitionId, hint, target, 'keyboard_tab_focus_acquisition_how_not_strategy');
      return resolved(transitionId, hint, safeAction('pressKey', ref, { key: 'Tab' }, 'task-explicit-tab-navigation'), target, 'task_explicit_tab_key');
    }
    if (key === 'Enter' && ref && taskMentions(task, ['submit', 'search', 'send', 'go', 'tim', 'gui', 'nhan'])) {
      return resolved(transitionId, hint, safeAction('submit', ref, {}, 'semantic-submit-via-enter'), target, 'enter_key_semantic_submit');
    }
    if (key === 'Escape' && ref && taskMentions(task, ['dismiss', 'close', 'cancel', 'dong', 'huy'])) {
      return resolved(transitionId, hint, safeAction('dismiss', ref, {}, 'semantic-dismiss-via-escape'), target, 'escape_key_semantic_dismiss');
    }
    return unresolved(transitionId, hint, target, key ? `keyboard_${key.toLowerCase()}_requires_human_review` : 'keyboard_key_not_safely_identified');
  }

  if (hint === 'scroll-direction-review-required') {
    const direction = scrollDirection(transition?.rawAction || {});
    if (!taskMentions(task, ['scroll', 'cuon'])) {
      return noise(transitionId, hint, target, 'incidental_scroll_how_not_strategy');
    }
    if (direction === 'horizontal') {
      return resolved(transitionId, hint, safeAction('scrollHorizontal', null), target, 'task_explicit_horizontal_scroll');
    }
    if (direction === 'vertical') {
      return resolved(transitionId, hint, safeAction('scrollVertical', null), target, 'task_explicit_vertical_scroll');
    }
    return unresolved(transitionId, hint, target, 'scroll_direction_requires_human_review');
  }

  return unresolved(transitionId, hint, target, hint ? 'unsupported_ambiguous_semantic_hint' : 'missing_semantic_action_hint');
}

function resolutionForItem(packItem, triageItem, sourceReview) {
  const scoreByTransition = new Map((Array.isArray(triageItem?.transitions) ? triageItem.transitions : [])
    .map(item => [String(item?.transitionId || ''), item]));
  const resolutions = [];

  for (const proposal of Array.isArray(packItem?.proposals) ? packItem.proposals : []) {
    const score = scoreByTransition.get(String(proposal?.transitionId || '')) || null;
    if (score?.fastLabelReviewCandidate === true) continue;
    const transition = transitionById(sourceReview, proposal?.transitionId);
    resolutions.push(resolveAmbiguousTransition({ proposal, transition, task: packItem?.task || {} }));
  }

  const resolvedCount = resolutions.filter(item => item.status === 'resolved-semantic-action').length;
  const captureNoiseCount = resolutions.filter(item => item.status === 'capture-noise').length;
  const unresolvedCount = resolutions.filter(item => item.status === 'needs-human-review').length;
  return {
    episodeId: packItem?.episodeId || null,
    task: packItem?.task || null,
    finalOutcomeStatus: packItem?.finalOutcomeStatus || null,
    ambiguousTransitionCount: resolutions.length,
    resolvedSemanticActionCount: resolvedCount,
    captureNoiseCount,
    unresolvedHumanReviewCount: unresolvedCount,
    allAmbiguityResolvedForApprovalAid: resolutions.length > 0 && unresolvedCount === 0,
    resolutions
  };
}

function markdownFor(result) {
  const lines = [
    '# Strategy ambiguity resolution',
    '',
    `Episodes: ${result.episodeCount}`,
    `Ambiguous transitions: ${result.ambiguousTransitionCount}`,
    `Resolved semantic actions: ${result.resolvedSemanticActionCount}`,
    `Capture noise: ${result.captureNoiseCount}`,
    `Still needs human review: ${result.unresolvedHumanReviewCount}`,
    `Episodes fully resolved as review aids: ${result.fullyResolvedEpisodeCount}`,
    '',
    '> Resolution outputs are review aids only. They never count as human verification or automatic training eligibility.',
    ''
  ];
  for (const item of result.items) {
    lines.push(`## ${item.episodeId || '<unknown>'}`);
    lines.push('');
    lines.push(`Task: ${String(item.task?.instruction || '').replace(/\s+/g, ' ').trim()}`);
    for (const resolution of item.resolutions) {
      const target = resolution.semanticTarget?.label || resolution.semanticTarget?.role || resolution.semanticTarget?.tag || '<target missing>';
      const action = resolution.suggestedAction?.type || resolution.semanticActionType || '-';
      lines.push(`- ${resolution.transitionId}: ${resolution.status}; action=${action}; target=${target}; reason=${resolution.reasonCode}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function resolveReviewPack(packFile, triageFile, outputDir) {
  const fullPack = path.resolve(packFile);
  const fullTriage = path.resolve(triageFile);
  const pack = readJson(fullPack);
  const triage = readJson(fullTriage);
  const triageByEpisode = new Map((Array.isArray(triage?.items) ? triage.items : [])
    .map(item => [String(item?.episodeId || ''), item]));
  const items = [];

  for (const packItem of (Array.isArray(pack?.items) ? pack.items : []).filter(item => item?.status === 'awaiting-human-review')) {
    const triageItem = triageByEpisode.get(String(packItem?.episodeId || '')) || null;
    if (!triageItem) throw new Error(`triage_episode_missing:${packItem?.episodeId || '<unknown>'}`);
    const sourceFile = resolveFile(packItem?.sourceFile);
    if (!sourceFile || !fs.existsSync(sourceFile)) throw new Error(`review_source_missing:${packItem?.episodeId || '<unknown>'}`);
    items.push(resolutionForItem(packItem, triageItem, readJson(sourceFile)));
  }

  const result = {
    ambiguityResolverVersion: AMBIGUITY_RESOLVER_VERSION,
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
      noRawTextValuesStored: true,
      arbitraryKeyboardCharactersNeverStored: true,
      capturedDoubleClickCanResolveWithSemanticTarget: true,
      componentClicksOfExplicitDoubleClickAreNoise: true,
      capturedHoverRequiresObservableSemanticStateChange: true,
      capturedDragRequiresSourceAndDestinationRefs: true,
      formControlSurfaceClicksExcludedAsHowNoise: true,
      checkableChangeUsesObservedDesiredState: true,
      taskDeclaredSelectionMayResolveSelectOption: true,
      mediaRangeChangeRequiresSemanticRangeLabelAndObservedValue: true,
      explicitTabMayResolveToPressKey: true,
      incidentalScrollDefaultsToHowNoiseUnlessTaskExplicitlyRequestsScroll: true,
      textContentRequiresHumanReviewBecauseValueIsRedacted: true,
      autoTrainEligible: false
    },
    items
  };

  const outDir = path.resolve(outputDir || path.join(path.dirname(fullTriage), 'strategy-ambiguity-resolution-v01'));
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
    if (!args.pack || !args.triage) {
      throw new Error('Usage: node training-collector/tools/resolve_strategy_review_ambiguity.js --pack <review-pack.json> --triage <triage.json> [--out dir]');
    }
    const resolvedPack = resolveReviewPack(args.pack, args.triage, args.out);
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      version: resolvedPack.result.ambiguityResolverVersion,
      episodeCount: resolvedPack.result.episodeCount,
      ambiguousTransitionCount: resolvedPack.result.ambiguousTransitionCount,
      resolvedSemanticActionCount: resolvedPack.result.resolvedSemanticActionCount,
      captureNoiseCount: resolvedPack.result.captureNoiseCount,
      unresolvedHumanReviewCount: resolvedPack.result.unresolvedHumanReviewCount,
      fullyResolvedEpisodeCount: resolvedPack.result.fullyResolvedEpisodeCount,
      autoTrainEligible: resolvedPack.result.policy.autoTrainEligible,
      resolution: path.resolve(resolvedPack.jsonFile),
      markdown: path.resolve(resolvedPack.markdownFile)
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  AMBIGUITY_RESOLVER_VERSION,
  words,
  taskMentions,
  taskRequestsDoubleClick,
  taskDeclaredSelection,
  taskDeclaredPlaybackRate,
  transitionById,
  observationElements,
  observationFingerprint,
  observableSemanticStateChanged,
  targetForTransition,
  targetAfterForTransition,
  semanticTarget,
  safeAction,
  controlKey,
  scrollDirection,
  targetKind,
  mediaRangeActionType,
  resolveFormChange,
  resolveMediaAction,
  resolveAmbiguousTransition,
  resolutionForItem,
  markdownFor,
  resolveReviewPack,
  parseArgs,
  main
};
