#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { splitGroupHint } = require('./prepare_strategy_review_pack.js');

const APPROVAL_CANDIDATE_VERSION = '0.1.0';
const HUMAN_CONFIRMATION_PHRASE = 'YES-I-REVIEWED-STRATEGY-APPROVAL-DIGEST';

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

function candidateBlockReasons(item, draft) {
  const reasons = [];
  const transitions = Array.isArray(item?.transitions) ? item.transitions : [];
  const draftSteps = Array.isArray(draft?.steps) ? draft.steps : [];
  if (String(item?.finalOutcomeStatus || '').toLowerCase() !== 'success') reasons.push('episode_final_outcome_not_success');
  if (!transitions.length) reasons.push('episode_has_no_transitions');
  if (draftSteps.length !== transitions.length) reasons.push('draft_transition_count_mismatch');
  if (transitions.some(step => step?.reviewClass !== 'fast-label-review')) reasons.push('ambiguous_transition_present');
  if (transitions.some(step => step?.capturedActionSucceeded !== true)) reasons.push('captured_action_failure_present');
  if (draftSteps.some(step => step?.reviewerAid?.suggestedActionReadyForCopy !== true || !step?.reviewerAid?.suggestedAction)) {
    reasons.push('suggested_action_missing');
  }
  return [...new Set(reasons)];
}

function proposedOutcome(index, total) {
  const terminal = index === total - 1;
  return {
    actionSucceeded: true,
    taskSucceeded: terminal,
    progress: terminal ? 1 : 0,
    evidence: [],
    errorCode: null,
    metadata: {
      proposalSource: 'strategy-approval-candidate',
      progressProposalPolicy: 'zero_until_verified_terminal_success',
      requiresHumanConfirmation: true
    }
  };
}

function candidateForItem(item, draft) {
  const steps = (Array.isArray(draft?.steps) ? draft.steps : []).map((step, index, all) => ({
    transitionId: step?.transitionId || null,
    proposedInclude: true,
    proposedAction: step?.reviewerAid?.suggestedAction || null,
    proposedOutcome: proposedOutcome(index, all.length),
    reviewClass: step?.reviewerAid?.reviewClass || null,
    labelConfidence: Number(step?.reviewerAid?.labelConfidence || 0),
    semanticTarget: step?.reviewerAid?.semanticTarget || null,
    reviewerMustConfirm: {
      taskRelevance: true,
      includeOrExclude: true,
      semanticAction: true,
      outcome: true,
      progress: true
    }
  }));
  return {
    episodeId: item?.episodeId || null,
    task: item?.task || null,
    finalOutcomeStatus: item?.finalOutcomeStatus || null,
    splitGroup: splitGroupHint({ task: item?.task || {}, episodeId: item?.episodeId || null }),
    draftFile: item?.draftFile || null,
    transitionCount: steps.length,
    proposedSteps: steps
  };
}

function hashPayload(result) {
  return {
    approvalCandidateVersion: result.approvalCandidateVersion,
    sourceDraftDigest: result.sourceDraftDigest,
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
    '',
    '> These are proposals only. Nothing in this file is a human-approved Strategy label until the reviewer explicitly confirms this exact digest hash.',
    '',
    `Required confirmation phrase: \`${HUMAN_CONFIRMATION_PHRASE}\``,
    ''
  ];

  for (const item of result.candidates) {
    lines.push(`## ${item.episodeId}`);
    lines.push('');
    lines.push(`Task: ${String(item.task?.instruction || '').replace(/\s+/g, ' ').trim()}`);
    lines.push(`Split group: ${item.splitGroup}`);
    lines.push('');
    for (const step of item.proposedSteps) {
      const action = step.proposedAction || {};
      const target = step.semanticTarget?.label || step.semanticTarget?.role || step.semanticTarget?.tag || '<target missing>';
      lines.push(`- ${step.transitionId}: include=true; action=${action.type || '<missing>'} -> ${target}; actionSucceeded=${step.proposedOutcome.actionSucceeded}; taskSucceeded=${step.proposedOutcome.taskSucceeded}; progress=${step.proposedOutcome.progress}`);
    }
    lines.push('');
  }

  if (result.blocked.length) {
    lines.push('## Blocked from fast approval');
    lines.push('');
    for (const item of result.blocked) lines.push(`- ${item.episodeId}: ${item.reasons.join(', ')}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function prepareApprovalCandidates(draftDigestFile, outputDir) {
  const fullDigest = path.resolve(draftDigestFile);
  const digest = readJson(fullDigest);
  const outDir = path.resolve(outputDir || path.join(path.dirname(fullDigest), 'approval-candidates-v01'));
  const candidates = [];
  const blocked = [];

  for (const item of Array.isArray(digest?.items) ? digest.items : []) {
    const draftFile = resolveFile(item?.draftFile);
    if (!draftFile || !fs.existsSync(draftFile)) {
      blocked.push({ episodeId: item?.episodeId || null, reasons: ['draft_file_missing'] });
      continue;
    }
    const draft = readJson(draftFile);
    const reasons = candidateBlockReasons(item, draft);
    if (reasons.length) {
      blocked.push({ episodeId: item?.episodeId || null, reasons });
      continue;
    }
    candidates.push(candidateForItem(item, draft));
  }

  const result = {
    approvalCandidateVersion: APPROVAL_CANDIDATE_VERSION,
    generatedAt: new Date().toISOString(),
    sourceDraftDigest: path.relative(process.cwd(), fullDigest),
    policy: {
      onlyFullyFastLabelEpisodesEligible: true,
      onlyCapturedSuccessfulActionsEligible: true,
      onlySuccessfulTerminalEpisodesEligible: true,
      proposedProgressPolicy: 'zero_until_verified_terminal_success',
      proposalsAreNotHumanVerification: true,
      explicitDigestHashConfirmationRequired: true,
      autoTrainEligible: false
    },
    candidateEpisodeCount: candidates.length,
    blockedEpisodeCount: blocked.length,
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
    if (!args.digest) throw new Error('Usage: node training-collector/tools/prepare_strategy_approval_candidates.js --digest <approval-digest.json> [--out dir]');
    const prepared = prepareApprovalCandidates(args.digest, args.out);
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      version: prepared.result.approvalCandidateVersion,
      candidateEpisodeCount: prepared.result.candidateEpisodeCount,
      blockedEpisodeCount: prepared.result.blockedEpisodeCount,
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
