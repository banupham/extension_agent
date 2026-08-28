#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const APPROVAL_CANDIDATE_VERSION = '0.3.0';
const HUMAN_CONFIRMATION_PHRASE = 'YES-I-REVIEWED-STRATEGY-APPROVAL-DIGEST';
const MEDIA_SEMANTIC_TYPES = new Set(['play', 'pause', 'mute', 'unmute']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableValue(value[key]);
  return out;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function digestHash(payload) {
  return crypto.createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex');
}

function resolveFile(file) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.resolve(file);
}

function tokenList(value) {
  return (String(value || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter(Boolean);
}

function semanticLabelKey(target) {
  const label = String(target?.label || target?.role || target?.tag || '').trim().toLowerCase();
  const compact = tokenList(label).join('-');
  return compact || 'target';
}

function semanticMediaActionType(target) {
  const tokens = new Set(tokenList(target?.label));
  if (tokens.has('unmute')) return 'unmute';
  if (tokens.has('pause')) return 'pause';
  if (tokens.has('mute')) return 'mute';
  if (tokens.has('play')) return 'play';
  return null;
}

function taskExplicitlyRequestsFocus(task) {
  return tokenList(task?.instruction).includes('focus');
}

function sameSemanticTarget(a, b) {
  const left = semanticLabelKey(a);
  const right = semanticLabelKey(b);
  return left !== 'target' && left === right;
}

function isIncidentalFocus(step, index, steps, task) {
  if (step?.reviewerAid?.suggestedAction?.type !== 'focus') return false;
  if (taskExplicitlyRequestsFocus(task)) return false;
  const next = steps[index + 1] || null;
  if (!next) return false;
  if (next?.reviewerAid?.suggestedAction?.type !== 'click') return false;
  return sameSemanticTarget(step?.reviewerAid?.semanticTarget, next?.reviewerAid?.semanticTarget);
}

function semanticizedAction(step) {
  const action = step?.reviewerAid?.suggestedAction || null;
  if (!action) return null;
  const out = { ...action, args: { ...(action.args || {}) }, expectedOutcome: { ...(action.expectedOutcome || {}) } };
  if (out.type === 'click') {
    const semanticType = semanticMediaActionType(step?.reviewerAid?.semanticTarget);
    if (semanticType && MEDIA_SEMANTIC_TYPES.has(semanticType)) {
      out.type = semanticType;
      out.intent = `semantic-${semanticType}`;
    }
  }
  return out;
}

function resolutionMap(resolutionItem) {
  return new Map((Array.isArray(resolutionItem?.resolutions) ? resolutionItem.resolutions : [])
    .map(item => [String(item?.transitionId || ''), item]));
}

function transformDraftSteps(item, draft, resolutionItem = null) {
  const steps = Array.isArray(draft?.steps) ? draft.steps : [];
  const byTransition = resolutionMap(resolutionItem);
  const transformed = steps.map((step, index) => {
    const aid = byTransition.get(String(step?.transitionId || '')) || null;
    const aidedNoise = aid?.status === 'capture-noise';
    const aidedSemantic = aid?.status === 'resolved-semantic-action' && !!aid?.suggestedAction;
    const incidentalFocus = !aid && isIncidentalFocus(step, index, steps, item?.task || draft?.task || {});
    const proposedInclude = aidedNoise || incidentalFocus ? false : true;
    const exclusionReason = aidedNoise
      ? (aid.exclusionReason || aid.reasonCode || 'ambiguity_resolution_capture_noise')
      : incidentalFocus
        ? 'incidental_focus_acquisition_before_task_action'
        : null;
    const proposedAction = proposedInclude
      ? (aidedSemantic ? aid.suggestedAction : semanticizedAction(step))
      : null;
    return {
      transitionId: step?.transitionId || null,
      proposedInclude,
      exclusionReason,
      proposedAction,
      reviewClass: step?.reviewerAid?.reviewClass || null,
      labelConfidence: Number(step?.reviewerAid?.labelConfidence || 0),
      semanticTarget: aid?.semanticTarget || step?.reviewerAid?.semanticTarget || null,
      capturedActionSucceeded: step?.reviewerAid?.capturedActionSucceeded === true,
      sourceSuggestedActionType: step?.reviewerAid?.suggestedAction?.type || aid?.sourceHint || null,
      ambiguityResolutionStatus: aid?.status || null,
      ambiguityResolutionReasonCode: aid?.reasonCode || null,
      reviewerMustConfirm: {
        taskRelevance: true,
        includeOrExclude: true,
        semanticAction: true,
        outcome: true,
        progress: true
      }
    };
  });

  const included = transformed.filter(step => step.proposedInclude === true);
  included.forEach((step, index) => {
    step.proposedOutcome = proposedOutcome(index, included.length);
  });
  transformed.filter(step => step.proposedInclude !== true).forEach(step => {
    step.proposedOutcome = null;
  });
  return transformed;
}

function semanticSplitGroup(item, proposedSteps) {
  const included = (proposedSteps || []).filter(step => step.proposedInclude === true && step.proposedAction);
  const sequence = included.map(step => `${step.proposedAction.type}:${semanticLabelKey(step.semanticTarget)}`);
  if (!sequence.length) return `semantic-empty:${String(item?.episodeId || 'unknown')}`;
  return `semantic-sequence:${sequence.join('>')}`;
}

function candidateBlockReasons(item, draft, resolutionItem = null) {
  const reasons = [];
  const transitions = Array.isArray(item?.transitions) ? item.transitions : [];
  const draftSteps = Array.isArray(draft?.steps) ? draft.steps : [];
  const transformed = transformDraftSteps(item, draft, resolutionItem);
  const included = transformed.filter(step => step.proposedInclude === true);
  const transformedById = new Map(transformed.map(step => [String(step.transitionId || ''), step]));
  const unresolvedAmbiguous = transitions.filter(step => {
    if (step?.reviewClass === 'fast-label-review') return false;
    const transformedStep = transformedById.get(String(step?.transitionId || '')) || null;
    return !['capture-noise', 'resolved-semantic-action'].includes(transformedStep?.ambiguityResolutionStatus);
  });

  if (String(item?.finalOutcomeStatus || '').toLowerCase() !== 'success') reasons.push('episode_final_outcome_not_success');
  if (!transitions.length) reasons.push('episode_has_no_transitions');
  if (draftSteps.length !== transitions.length) reasons.push('draft_transition_count_mismatch');
  if (unresolvedAmbiguous.length) reasons.push('unresolved_ambiguous_transition');
  if (!included.length) reasons.push('no_task_relevant_strategy_steps');
  if (included.some(step => step.capturedActionSucceeded !== true)) reasons.push('captured_action_failure_present');
  if (included.some(step => !step.proposedAction)) reasons.push('suggested_action_missing');
  if (included.some(step => step.proposedAction?.type === 'focus')) reasons.push('focus_surface_action_not_strategy_semantic');
  return [...new Set(reasons)];
}

function proposedOutcome(index, total) {
  const terminal = index === total - 1;
  const progress = total > 0 ? (index + 1) / total : 0;
  return {
    actionSucceeded: true,
    taskSucceeded: terminal,
    progress,
    evidence: [],
    errorCode: null,
    metadata: {
      proposalSource: 'strategy-approval-candidate',
      progressProposalPolicy: 'ordered_included_semantic_steps_fraction',
      requiresHumanConfirmation: true
    }
  };
}

function candidateForItem(item, draft, resolutionItem = null) {
  const steps = transformDraftSteps(item, draft, resolutionItem);
  return {
    episodeId: item?.episodeId || null,
    task: item?.task || null,
    finalOutcomeStatus: item?.finalOutcomeStatus || null,
    splitGroup: semanticSplitGroup(item, steps),
    draftFile: item?.draftFile || null,
    transitionCount: steps.length,
    includedStrategyStepCount: steps.filter(step => step.proposedInclude === true).length,
    excludedCaptureNoiseCount: steps.filter(step => step.proposedInclude !== true).length,
    ambiguityResolvedStrategyStepCount: steps.filter(step => step.ambiguityResolutionStatus === 'resolved-semantic-action').length,
    ambiguityResolvedNoiseCount: steps.filter(step => step.ambiguityResolutionStatus === 'capture-noise').length,
    proposedSteps: steps.map(step => ({
      transitionId: step.transitionId,
      proposedInclude: step.proposedInclude,
      exclusionReason: step.exclusionReason,
      proposedAction: step.proposedAction,
      proposedOutcome: step.proposedOutcome,
      reviewClass: step.reviewClass,
      labelConfidence: step.labelConfidence,
      semanticTarget: step.semanticTarget,
      sourceSuggestedActionType: step.sourceSuggestedActionType,
      ambiguityResolutionStatus: step.ambiguityResolutionStatus,
      ambiguityResolutionReasonCode: step.ambiguityResolutionReasonCode,
      reviewerMustConfirm: step.reviewerMustConfirm
    }))
  };
}

function hashPayload(result) {
  return {
    approvalCandidateVersion: result.approvalCandidateVersion,
    sourceDraftDigest: result.sourceDraftDigest,
    sourceAmbiguityResolution: result.sourceAmbiguityResolution,
    policy: result.policy,
    candidates: result.candidates,
    blocked: result.blocked
  };
}

function verifyDigest(result) {
  return typeof result?.digestHash === 'string' && result.digestHash === digestHash(hashPayload(result));
}

function markdownFor(result) {
  const lines = [
    '# Strategy approval candidate digest',
    '',
    `Digest hash: \`${result.digestHash}\``,
    `Eligible episodes: ${result.candidateEpisodeCount}`,
    `Blocked episodes: ${result.blockedEpisodeCount}`,
    `Ambiguity resolution loaded: ${result.sourceAmbiguityResolution ? 'yes' : 'no'}`,
    '',
    '> These are proposals only. Nothing in this file is a human-approved Strategy label until the reviewer explicitly confirms this exact digest hash.',
    '> Incidental focus/scroll acquisition may be excluded as HOW noise. Resolved review aids still require explicit human confirmation.',
    '',
    `Required confirmation phrase: \`${HUMAN_CONFIRMATION_PHRASE}\``,
    ''
  ];

  for (const item of result.candidates) {
    lines.push(`## ${item.episodeId}`);
    lines.push('');
    lines.push(`Task: ${String(item.task?.instruction || '').replace(/\s+/g, ' ').trim()}`);
    lines.push(`Split group: ${item.splitGroup}`);
    lines.push(`Included Strategy steps: ${item.includedStrategyStepCount}; excluded capture noise: ${item.excludedCaptureNoiseCount}`);
    lines.push(`Ambiguity aid: strategy=${item.ambiguityResolvedStrategyStepCount}; noise=${item.ambiguityResolvedNoiseCount}`);
    lines.push('');
    for (const step of item.proposedSteps) {
      const target = step.semanticTarget?.label || step.semanticTarget?.role || step.semanticTarget?.tag || '<target missing>';
      const aid = step.ambiguityResolutionStatus ? `; ambiguity=${step.ambiguityResolutionStatus}` : '';
      if (step.proposedInclude !== true) {
        lines.push(`- ${step.transitionId}: include=false; sourceAction=${step.sourceSuggestedActionType || '<missing>'} -> ${target}; exclusionReason=${step.exclusionReason}${aid}`);
        continue;
      }
      const action = step.proposedAction || {};
      lines.push(`- ${step.transitionId}: include=true; action=${action.type || '<missing>'} -> ${target}; actionSucceeded=${step.proposedOutcome?.actionSucceeded}; taskSucceeded=${step.proposedOutcome?.taskSucceeded}; progress=${step.proposedOutcome?.progress}${aid}`);
    }
    lines.push('');
  }

  if (result.blocked.length) {
    lines.push('## Blocked from approval candidate');
    lines.push('');
    for (const item of result.blocked) lines.push(`- ${item.episodeId}: ${item.reasons.join(', ')}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function prepareApprovalCandidates(draftDigestFile, outputDir, options = {}) {
  const fullDigest = path.resolve(draftDigestFile);
  const digest = readJson(fullDigest);
  const resolutionFile = options.resolutionFile ? path.resolve(options.resolutionFile) : null;
  const resolution = resolutionFile ? readJson(resolutionFile) : null;
  const resolutionByEpisode = new Map((Array.isArray(resolution?.items) ? resolution.items : [])
    .map(item => [String(item?.episodeId || ''), item]));
  const outDir = path.resolve(outputDir || path.join(path.dirname(fullDigest), 'approval-candidates-v03'));
  const candidates = [];
  const blocked = [];

  for (const item of Array.isArray(digest?.items) ? digest.items : []) {
    const draftFile = resolveFile(item?.draftFile);
    if (!draftFile || !fs.existsSync(draftFile)) {
      blocked.push({ episodeId: item?.episodeId || null, reasons: ['draft_file_missing'] });
      continue;
    }
    const draft = readJson(draftFile);
    const resolutionItem = resolutionByEpisode.get(String(item?.episodeId || '')) || null;
    const reasons = candidateBlockReasons(item, draft, resolutionItem);
    if (reasons.length) {
      blocked.push({ episodeId: item?.episodeId || null, reasons });
      continue;
    }
    candidates.push(candidateForItem(item, draft, resolutionItem));
  }

  const result = {
    approvalCandidateVersion: APPROVAL_CANDIDATE_VERSION,
    generatedAt: new Date().toISOString(),
    sourceDraftDigest: path.relative(process.cwd(), fullDigest),
    sourceAmbiguityResolution: resolutionFile ? path.relative(process.cwd(), resolutionFile) : null,
    policy: {
      onlyFullyReviewAidResolvedEpisodesEligible: true,
      onlyCapturedSuccessfulIncludedActionsEligible: true,
      onlySuccessfulTerminalEpisodesEligible: true,
      incidentalFocusAcquisitionExcludedFromStrategy: true,
      ambiguityResolverMayExcludeIncidentalHowNoise: true,
      ambiguityResolverMayProposeSemanticActionButNeverVerifyIt: true,
      mediaControlSurfaceClicksAbstractedToSemanticActions: true,
      splitGroupsUseSemanticActionTargetSequence: true,
      proposedProgressPolicy: 'ordered_included_semantic_steps_fraction',
      proposalsAreNotHumanVerification: true,
      explicitDigestHashConfirmationRequired: true,
      autoTrainEligible: false
    },
    candidateEpisodeCount: candidates.length,
    blockedEpisodeCount: blocked.length,
    ambiguityAidCandidateEpisodeCount: candidates.filter(item => item.ambiguityResolvedStrategyStepCount > 0 || item.ambiguityResolvedNoiseCount > 0).length,
    candidates,
    blocked
  };
  result.digestHash = digestHash(hashPayload(result));

  fs.mkdirSync(outDir, { recursive: true });
  const jsonFile = path.join(outDir, 'approval-candidates.json');
  const markdownFile = path.join(outDir, 'approval-candidates.md');
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
    if (!args.digest) throw new Error('Usage: node training-collector/tools/prepare_strategy_approval_candidates.js --digest <approval-digest.json> [--resolution <ambiguity-resolution.json>] [--out dir]');
    const prepared = prepareApprovalCandidates(args.digest, args.out, { resolutionFile: args.resolution });
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      version: prepared.result.approvalCandidateVersion,
      candidateEpisodeCount: prepared.result.candidateEpisodeCount,
      blockedEpisodeCount: prepared.result.blockedEpisodeCount,
      ambiguityAidCandidateEpisodeCount: prepared.result.ambiguityAidCandidateEpisodeCount,
      ambiguityResolutionLoaded: !!prepared.result.sourceAmbiguityResolution,
      digestHash: prepared.result.digestHash,
      autoTrainEligible: prepared.result.policy.autoTrainEligible,
      candidates: path.resolve(prepared.jsonFile),
      markdown: path.resolve(prepared.markdownFile)
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  APPROVAL_CANDIDATE_VERSION,
  HUMAN_CONFIRMATION_PHRASE,
  stableValue,
  stableStringify,
  digestHash,
  tokenList,
  semanticLabelKey,
  semanticMediaActionType,
  taskExplicitlyRequestsFocus,
  sameSemanticTarget,
  isIncidentalFocus,
  semanticizedAction,
  resolutionMap,
  transformDraftSteps,
  semanticSplitGroup,
  candidateBlockReasons,
  proposedOutcome,
  candidateForItem,
  hashPayload,
  verifyDigest,
  markdownFor,
  prepareApprovalCandidates,
  parseArgs,
  main
};
