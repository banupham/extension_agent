#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Resolver = require('./resolve_strategy_teaching_batch.js');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveFile(file) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.resolve(file);
}

function safeTarget(transition) {
  const found = Resolver.semanticTargetForTransition(transition || {});
  const target = found.target || null;
  return {
    hasTargetRef: !!found.ref,
    semanticTarget: target ? {
      label: typeof target.label === 'string' ? target.label : null,
      role: typeof target.role === 'string' ? target.role : null,
      tag: typeof target.tag === 'string' ? target.tag : null,
      editable: target.editable === true,
      enabled: target.enabled !== false,
      visible: target.visible !== false
    } : null,
    semanticTargetKey: Resolver.semanticTargetKey(target)
  };
}

function transitionSummary(transition) {
  const raw = transition?.rawAction || {};
  return {
    transitionId: String(transition?.transitionId || ''),
    kind: String(raw.kind || '').toLowerCase() || null,
    operation: String(raw.operation || '').toLowerCase() || null,
    control: Resolver.keyboardControl(raw),
    actionSucceeded: transition?.outcome?.actionSucceeded !== false,
    observableSemanticStateChanged: Resolver.observableSemanticStateChanged(transition),
    ...safeTarget(transition)
  };
}

function sequenceDiagnostic(transitions, task, sourceReview) {
  const declaredTextPresent = !!Resolver.taskDeclaredText(task || {});
  const taskSubmitIntent = Resolver.taskRequestsSubmit(task || {});
  const finalOutcomeSuccess = String(sourceReview?.finalOutcome?.status || '').toLowerCase() === 'success';
  const summaries = transitions.map(transitionSummary);
  const typeChars = summaries.filter(item => item.kind === 'text-key' && item.operation === 'type-char');
  const enterCandidates = summaries.filter(item => item.control === 'Enter');
  const reasons = [];

  if (!declaredTextPresent) reasons.push('task_declared_text_not_detected');
  if (!taskSubmitIntent) reasons.push('task_submit_intent_not_detected');
  if (!finalOutcomeSuccess) reasons.push('final_outcome_not_success');
  if (!typeChars.length) reasons.push('no_type_char_transitions');

  const badCharTargets = typeChars.filter(item => !item.actionSucceeded || !item.hasTargetRef || item.semanticTarget?.editable !== true);
  if (badCharTargets.length) reasons.push('type_char_target_evidence_insufficient');

  const charTargetKeys = [...new Set(typeChars.map(item => item.semanticTargetKey).filter(Boolean))];
  if (charTargetKeys.length > 1) reasons.push('type_char_semantic_target_not_continuous');

  if (typeChars.length && !enterCandidates.length) reasons.push('enter_transition_not_detected');

  const firstCharIndex = summaries.findIndex(item => item.kind === 'text-key' && item.operation === 'type-char');
  let lastCharIndex = -1;
  for (let i = summaries.length - 1; i >= 0; i -= 1) {
    if (summaries[i].kind === 'text-key' && summaries[i].operation === 'type-char') {
      lastCharIndex = i;
      break;
    }
  }

  const anchorTransition = firstCharIndex >= 0 ? transitions[firstCharIndex] : null;
  const anchorFound = anchorTransition ? Resolver.semanticTargetForTransition(anchorTransition) : { ref: null, target: null };
  let selectedEnterIndex = -1;
  let incompatibleBetween = null;
  let enterMismatch = null;

  if (lastCharIndex >= 0 && anchorFound.target) {
    for (let index = lastCharIndex + 1; index < transitions.length; index += 1) {
      const transition = transitions[index];
      const summary = summaries[index];
      const found = Resolver.semanticTargetForTransition(transition);
      if (summary.control === 'Enter') {
        const same = Resolver.sameEditableTarget(found.target, anchorFound.target, found.ref, anchorFound.ref);
        if (!summary.actionSucceeded || !same) {
          enterMismatch = summary;
        } else {
          selectedEnterIndex = index;
        }
        break;
      }
      const kind = summary.kind;
      const compatibleKind = kind === 'text-change' || kind === 'focus' || kind === 'dom-focus' || kind === 'click' || kind === 'dom-click' || (kind === 'text-key' && summary.operation === 'type-char');
      const same = Resolver.sameEditableTarget(found.target, anchorFound.target, found.ref, anchorFound.ref);
      if (!compatibleKind || !same) {
        incompatibleBetween = summary;
        break;
      }
    }
  }

  if (enterMismatch) reasons.push('enter_target_or_outcome_mismatch');
  if (incompatibleBetween) reasons.push('incompatible_transition_between_typing_and_enter');
  if (lastCharIndex >= 0 && selectedEnterIndex < 0 && !enterMismatch && !incompatibleBetween && enterCandidates.length) {
    reasons.push('no_continuous_enter_after_last_type_char');
  }

  const resolvedSequenceDetected = !!Resolver.genericTextFormSequence(transitions, task || {}, sourceReview || {});
  if (!resolvedSequenceDetected && !reasons.length) reasons.push('resolver_rejected_sequence_without_coarse_diagnostic_reason');

  return {
    declaredTextPresent,
    taskSubmitIntent,
    finalOutcomeSuccess,
    typeCharCount: typeChars.length,
    typeCharSemanticTargetKeyCount: charTargetKeys.length,
    enterCandidateCount: enterCandidates.length,
    resolvedSequenceDetected,
    rejectionReasons: resolvedSequenceDetected ? [] : [...new Set(reasons)],
    incompatibleBetween,
    enterMismatch,
    transitions: summaries
  };
}

function diagnose(packFile, triageFile = null, episodeIds = []) {
  const pack = readJson(path.resolve(packFile));
  const triage = triageFile ? readJson(path.resolve(triageFile)) : null;
  const triageByEpisode = new Map((Array.isArray(triage?.items) ? triage.items : []).map(item => [String(item?.episodeId || ''), item]));
  const selected = new Set((episodeIds || []).map(String).filter(Boolean));
  const items = [];

  for (const packItem of Array.isArray(pack?.items) ? pack.items : []) {
    const episodeId = String(packItem?.episodeId || '');
    if (selected.size && !selected.has(episodeId)) continue;
    const sourceFile = resolveFile(packItem?.sourceFile);
    if (!sourceFile || !fs.existsSync(sourceFile)) {
      items.push({ episodeId, error: 'review_source_missing' });
      continue;
    }
    const sourceReview = readJson(sourceFile);
    const transitions = Array.isArray(sourceReview?.transitions) ? sourceReview.transitions : [];
    const triageItem = triageByEpisode.get(episodeId) || null;
    const ambiguousTransitionIds = new Set((Array.isArray(triageItem?.transitions) ? triageItem.transitions : [])
      .filter(item => item?.fastLabelReviewCandidate !== true)
      .map(item => String(item?.transitionId || '')));
    const detail = sequenceDiagnostic(transitions, packItem?.task || sourceReview?.task || {}, sourceReview);
    items.push({
      episodeId,
      finalOutcomeStatus: String(packItem?.finalOutcomeStatus || sourceReview?.finalOutcome?.status || '').toLowerCase() || null,
      ambiguousTransitionCount: ambiguousTransitionIds.size,
      ...detail,
      transitions: detail.transitions.map(item => ({
        ...item,
        ambiguousReview: ambiguousTransitionIds.has(item.transitionId)
      }))
    });
  }

  return {
    diagnosticVersion: '0.1.0',
    privacy: {
      typedValuesIncluded: false,
      rawKeyCharactersIncluded: false,
      selectorsIncluded: false,
      coordinatesIncluded: false,
      tabIdsIncluded: false,
      rawCdpIncluded: false
    },
    episodeCount: items.length,
    items
  };
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
    if (!args.pack) throw new Error('Usage: node training-collector/tools/diagnose_strategy_text_form_sequences.js --pack <review-pack.json> [--triage <triage.json>] [--episode id1,id2]');
    const episodeIds = typeof args.episode === 'string' ? args.episode.split(',').map(value => value.trim()).filter(Boolean) : [];
    const result = diagnose(args.pack, args.triage || null, episodeIds);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  safeTarget,
  transitionSummary,
  sequenceDiagnostic,
  diagnose,
  parseArgs,
  main
};
