#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  HUMAN_CONFIRMATION_PHRASE,
  verifyDigest
} = require('./prepare_strategy_approval_candidates.js');

const APPROVAL_APPLICATOR_VERSION = '0.1.0';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function safeName(value) {
  return String(value || 'episode').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 140) || 'episode';
}

function assertExplicitHumanConfirmation(candidateFile, candidate, options = {}) {
  if (!verifyDigest(candidate)) throw new Error('approval_candidate_digest_integrity_failed');
  const expectedHash = String(candidate.digestHash || '');
  if (String(options.confirmDigest || '') !== expectedHash) {
    throw new Error('approval_digest_hash_confirmation_required');
  }
  if (String(options.confirmationPhrase || '') !== HUMAN_CONFIRMATION_PHRASE) {
    throw new Error('explicit_human_confirmation_phrase_required');
  }
  if (candidate?.policy?.autoTrainEligible !== false || candidate?.policy?.proposalsAreNotHumanVerification !== true) {
    throw new Error('approval_candidate_policy_boundary_failed');
  }
  return {
    method: 'explicit-digest-hash-cli-confirmation',
    candidateFile: path.relative(process.cwd(), path.resolve(candidateFile)),
    digestHash: expectedHash,
    confirmationPhraseMatched: true,
    reviewerAssertions: {
      taskPrivacyReviewed: true,
      semanticLabelsVerified: true,
      outcomeVerified: true,
      progressReviewed: true,
      includeExcludeReviewed: true,
      credentialsExcluded: true,
      secretsExcluded: true
    }
  };
}

function annotationForCandidate(candidate, proof) {
  const steps = (Array.isArray(candidate?.proposedSteps) ? candidate.proposedSteps : []).map(step => {
    if (step?.proposedInclude !== true) throw new Error(`candidate_step_not_included:${step?.transitionId || '<missing>'}`);
    if (!step?.proposedAction || !step?.proposedOutcome) throw new Error(`candidate_step_proposal_incomplete:${step?.transitionId || '<missing>'}`);
    return {
      transitionId: step.transitionId,
      include: true,
      action: step.proposedAction,
      outcome: {
        ...step.proposedOutcome,
        metadata: {
          ...(step.proposedOutcome.metadata || {}),
          labelSource: 'verified-human-review',
          humanDigestHash: proof.digestHash
        }
      }
    };
  });
  if (!steps.length) throw new Error(`candidate_episode_has_no_steps:${candidate?.episodeId || '<missing>'}`);
  return {
    contractVersion: '0.1.1',
    episodeId: candidate.episodeId,
    splitGroup: candidate.splitGroup,
    review: {
      taskPrivacyReviewed: true,
      semanticLabelsVerified: true,
      outcomeVerified: true,
      credentialsExcluded: true,
      secretsExcluded: true
    },
    steps,
    humanConfirmation: {
      ...proof,
      confirmedAt: new Date().toISOString()
    },
    policy: {
      createdOnlyAfterExplicitDigestConfirmation: true,
      rawEvidenceNeverAutoPromotedWithoutHumanConfirmation: true,
      autoTrainEligibleBeforeDatasetSplit: false
    }
  };
}

function applyApprovalCandidates(candidateFile, outputDir, options = {}) {
  const fullCandidate = path.resolve(candidateFile);
  const candidate = readJson(fullCandidate);
  const proof = assertExplicitHumanConfirmation(fullCandidate, candidate, options);
  const outDir = path.resolve(outputDir || path.join(path.dirname(fullCandidate), 'approved-annotations'));
  fs.mkdirSync(outDir, { recursive: true });

  const files = [];
  let approvedTransitionCount = 0;
  for (const item of Array.isArray(candidate?.candidates) ? candidate.candidates : []) {
    const annotation = annotationForCandidate(item, proof);
    approvedTransitionCount += annotation.steps.length;
    const file = path.join(outDir, `${safeName(item.episodeId)}.strategy-review.approved.json`);
    fs.writeFileSync(file, `${JSON.stringify(annotation, null, 2)}\n`, 'utf8');
    files.push(file);
  }
  if (!files.length) throw new Error('no_eligible_strategy_approval_candidates');

  const receipt = {
    approvalApplicatorVersion: APPROVAL_APPLICATOR_VERSION,
    generatedAt: new Date().toISOString(),
    sourceCandidateFile: path.relative(process.cwd(), fullCandidate),
    digestHash: candidate.digestHash,
    approvedEpisodeCount: files.length,
    approvedTransitionCount,
    blockedEpisodeCount: Array.isArray(candidate?.blocked) ? candidate.blocked.length : 0,
    explicitHumanConfirmationVerified: true,
    policy: {
      candidateDigestIntegrityVerified: true,
      exactDigestHashConfirmedByHuman: true,
      exactConfirmationPhraseRequired: true,
      noBlockedEpisodeApproved: true,
      annotationsRemainUnassignedUntilDatasetSplit: true
    },
    annotationFiles: files.map(file => path.relative(process.cwd(), file))
  };
  const receiptFile = path.join(outDir, 'approval-receipt.json');
  fs.writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return { receipt, receiptFile, annotationFiles: files };
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
    if (!args.candidates) {
      throw new Error('Usage: node training-collector/tools/apply_strategy_approval_candidates.js --candidates <approval-candidates.json> --confirm-digest <sha256> --confirm <phrase> [--out dir]');
    }
    const applied = applyApprovalCandidates(args.candidates, args.out, {
      confirmDigest: args['confirm-digest'],
      confirmationPhrase: args.confirm
    });
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      version: applied.receipt.approvalApplicatorVersion,
      approvedEpisodeCount: applied.receipt.approvedEpisodeCount,
      approvedTransitionCount: applied.receipt.approvedTransitionCount,
      blockedEpisodeCount: applied.receipt.blockedEpisodeCount,
      explicitHumanConfirmationVerified: applied.receipt.explicitHumanConfirmationVerified,
      annotations: path.resolve(path.dirname(applied.receiptFile)),
      receipt: path.resolve(applied.receiptFile)
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  APPROVAL_APPLICATOR_VERSION,
  safeName,
  assertExplicitHumanConfirmation,
  annotationForCandidate,
  applyApprovalCandidates,
  parseArgs,
  main
};
