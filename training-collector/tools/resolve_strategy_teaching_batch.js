#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Base = require('./resolve_strategy_review_ambiguity.js');

const TEACHING_BATCH_RESOLVER_VERSION = '0.1.0';

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

function taskDeclaredText(task) {
  const instruction = cleanText(task?.instruction, 500);
  if (!instruction || instructionIsSensitive(instruction)) return null;
  const patterns = [
    /(?:^|[,.!?:;]\s*|\s)(?:nhập|gõ)\s+(.+?)\s+(?:vào|trong)\s+/i,
    /(?:^|[,.!?:;]\s*|\s)(?:type|enter|fill)\s+(.+?)\s+(?:into|in)\s+/i
  ];
  for (const pattern of patterns) {
    const match = instruction.match(pattern);
    if (!match?.[1]) continue;
    const text = cleanText(match[1].replace(/^["'“”‘’]+|["'“”‘’]+$/g, ''), 160);
    if (text && text.length <= 160) return text;
  }
  return null;
}

function semanticTargetForTransition(transition) {
  const found = Base.targetForTransition(transition || {});
  return {
    ref: found.ref,
    target: Base.semanticTarget(found.element)
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

function typeCharGroups(transitions) {
  const groups = [];
  let current = null;
  for (const transition of transitions) {
    const raw = transition?.rawAction || {};
    const isChar = String(raw.kind || '').toLowerCase() === 'text-key' && String(raw.operation || '').toLowerCase() === 'type-char';
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
  const declaredText = taskDeclaredText(packItem?.task || sourceReview?.task || {});
  const charGroups = typeCharGroups(transitions);
  const singleCharGroup = charGroups.length === 1 ? charGroups[0] : null;
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
    const capturedSuccess = proposal?.evidence?.actionSucceededCaptured !== false && transition?.outcome?.actionSucceeded !== false;

    if (!capturedSuccess) {
      if (score?.fastLabelReviewCandidate !== true) {
        resolutions.push(unresolved(transitionId, hint, target, 'captured_action_failure_requires_human_review'));
      }
      continue;
    }

    if ((kind === 'focus' || kind === 'dom-focus') && !Base.taskMentions(packItem?.task || {}, ['focus'])) {
      resolutions.push(noise(transitionId, hint || 'focus', target, 'focus_acquisition_how_not_strategy'));
      continue;
    }

    if ((kind === 'click' || kind === 'dom-click') && target?.editable === true && declaredText) {
      resolutions.push(noise(transitionId, hint || 'click', target, 'editable_target_click_focus_acquisition_how_not_strategy'));
      continue;
    }

    if ((kind === 'click' || kind === 'dom-click') && !target && noObservablePageChange(transition) && laterTaskAlignedAction(transitions, index, packItem?.task || {})) {
      resolutions.push(noise(transitionId, hint || 'click', null, 'targetless_no_effect_click_superseded_by_task_aligned_action'));
      continue;
    }

    if (kind === 'text-key' && operation === 'type-char') {
      if (!declaredText || !singleCharGroup || !singleCharGroup.transitionIds.includes(transitionId) || target?.editable !== true || !ref) {
        resolutions.push(unresolved(transitionId, hint || 'keyboard-action-review-required', target, 'text_entry_requires_human_review', 'typeText'));
        continue;
      }
      if (singleCharGroup.transitionIds[0] === transitionId) {
        const action = Base.safeAction('typeText', ref, { text: declaredText }, 'task-declared-semantic-text-entry');
        resolutions.push(resolved(transitionId, hint || 'keyboard-action-review-required', action, target, 'per_character_capture_collapsed_to_task_declared_text_action'));
      } else {
        resolutions.push(noise(transitionId, hint || 'keyboard-action-review-required', target, 'per_character_capture_collapsed_into_single_text_action'));
      }
      continue;
    }

    if (score?.fastLabelReviewCandidate === true) continue;
    resolutions.push(Base.resolveAmbiguousTransition({
      proposal,
      transition,
      task: packItem?.task || sourceReview?.task || {}
    }));
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
    '# Strategy teaching-batch resolution',
    '',
    `Episodes: ${result.episodeCount}`,
    `Ambiguous transitions: ${result.ambiguousTransitionCount}`,
    `Resolved semantic actions: ${result.resolvedSemanticActionCount}`,
    `Capture noise: ${result.captureNoiseCount}`,
    `Still needs human review: ${result.unresolvedHumanReviewCount}`,
    `Episodes fully resolved as review aids: ${result.fullyResolvedEpisodeCount}`,
    '',
    '> Review aids only. Nothing here is human verification or automatic Strategy training eligibility.',
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

function resolveTeachingBatch(packFile, triageFile, outputDir) {
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
      focusAcquisitionExcludedFromStrategy: true,
      editableFieldClickAcquisitionExcludedFromStrategy: true,
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
    if (!args.pack || !args.triage) {
      throw new Error('Usage: node training-collector/tools/resolve_strategy_teaching_batch.js --pack <review-pack.json> --triage <triage.json> [--out dir]');
    }
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
  semanticTargetForTransition,
  noObservablePageChange,
  targetMatchesTask,
  laterTaskAlignedAction,
  typeCharGroups,
  resolveTeachingItem,
  markdownFor,
  resolveTeachingBatch,
  parseArgs,
  main
};
