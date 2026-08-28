#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  HUMAN_CONFIRMATION_PHRASE,
  digestHash,
  verifyDigest
} = require('./prepare_strategy_approval_candidates.js');

const APPROVAL_APPLICATOR_VERSION = '0.3.0';

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
    if (step?.proposedInclude === false) {
      if (!step?.exclusionReason) throw new Error(`candidate_excluded_step_reason_missing:${step?.transitionId || '<missing>'}`);
      return {
        transitionId: step.transitionId,
        include: false,
        exclusionReason: step.exclusionReason,
        action: null,
        outcome: null
      };
    }
    if (step?.proposedInclude !== true) throw new Error(`candidate_step_include_decision_missing:${step?.transitionId || '<missing>'}`);
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
  const includedCount = steps.filter(step => step.include === true).length;
  if (!includedCount) throw new Error(`candidate_episode_has_no_strategy_steps:${candidate?.episodeId || '<missing>'}`);
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
      excludedCaptureNoisePreservedAsExcludedProvenance: true,
      autoTrainEligibleBeforeDatasetSplit: false
    }
  };
}

function machineEligibilityHashPayload(eligibility) {
  return {
    machineTrainingEligibilityVersion: eligibility?.machineTrainingEligibilityVersion || null,
    policy: eligibility?.policy || {},
    counts: eligibility?.counts || {},
    machineAcceptEpisodeIds: eligibility?.machineAcceptEpisodeIds || [],
    quarantineEpisodeIds: eligibility?.quarantineEpisodeIds || [],
    rejectEpisodeIds: eligibility?.rejectEpisodeIds || [],
    items: eligibility?.items || []
  };
}

function machineEligibilityDigest(eligibility) {
  return digestHash(machineEligibilityHashPayload(eligibility));
}

function assertMachineEligibilityProof(candidateFile, candidate, eligibilityFile, eligibility) {
  if (!verifyDigest(candidate)) throw new Error('machine_candidate_digest_integrity_failed');
  if (candidate?.policy?.onlyCapturedSuccessfulIncludedActionsEligible !== true) {
    throw new Error('machine_candidate_captured_success_policy_missing');
  }
  if (eligibility?.policy?.failClosed !== true || eligibility?.policy?.independentOutcomeVerificationRequiredForAccept !== true) {
    throw new Error('machine_eligibility_fail_closed_policy_missing');
  }
  const items = Array.isArray(eligibility?.items) ? eligibility.items : [];
  const accepted = items.filter(item => item?.status === 'accept');
  const declared = new Set(Array.isArray(eligibility?.machineAcceptEpisodeIds) ? eligibility.machineAcceptEpisodeIds.map(String) : []);
  if (accepted.some(item => !declared.has(String(item?.episodeId || '')))) {
    throw new Error('machine_eligibility_accept_list_mismatch');
  }
  for (const item of accepted) {
    if (item?.outcomeVerification?.status !== 'verified') throw new Error(`machine_accept_outcome_not_verified:${item?.episodeId || '<missing>'}`);
    if (item?.semantic?.ok !== true) throw new Error(`machine_accept_semantic_not_verified:${item?.episodeId || '<missing>'}`);
  }
  return {
    method: 'machine-eligibility-gate',
    candidateFile: path.relative(process.cwd(), path.resolve(candidateFile)),
    eligibilityFile: path.relative(process.cwd(), path.resolve(eligibilityFile)),
    sourceCandidateDigest: String(candidate.digestHash || ''),
    eligibilityVersion: String(eligibility?.machineTrainingEligibilityVersion || ''),
    eligibilityDigest: machineEligibilityDigest(eligibility),
    acceptedItems: new Map(accepted.map(item => [String(item?.episodeId || ''), item]))
  };
}

function machineAnnotationForCandidate(candidate, proof, eligibilityItem) {
  if (!eligibilityItem || eligibilityItem.status !== 'accept') {
    throw new Error(`machine_candidate_not_accepted:${candidate?.episodeId || '<missing>'}`);
  }
  if (eligibilityItem?.outcomeVerification?.status !== 'verified' || eligibilityItem?.semantic?.ok !== true) {
    throw new Error(`machine_candidate_accept_proof_incomplete:${candidate?.episodeId || '<missing>'}`);
  }
  const steps = (Array.isArray(candidate?.proposedSteps) ? candidate.proposedSteps : []).map(step => {
    if (step?.proposedInclude === false) {
      if (!step?.exclusionReason) throw new Error(`candidate_excluded_step_reason_missing:${step?.transitionId || '<missing>'}`);
      return {
        transitionId: step.transitionId,
        include: false,
        exclusionReason: step.exclusionReason,
        action: null,
        outcome: null
      };
    }
    if (step?.proposedInclude !== true) throw new Error(`candidate_step_include_decision_missing:${step?.transitionId || '<missing>'}`);
    if (!step?.proposedAction || !step?.proposedOutcome) throw new Error(`candidate_step_proposal_incomplete:${step?.transitionId || '<missing>'}`);
    return {
      transitionId: step.transitionId,
      include: true,
      action: step.proposedAction,
      outcome: {
        ...step.proposedOutcome,
        metadata: {
          ...(step.proposedOutcome.metadata || {}),
          labelSource: 'verified-machine-evidence',
          requiresHumanConfirmation: false,
          machineEligibilityDigest: proof.eligibilityDigest,
          machineOutcomeSource: eligibilityItem.outcomeVerification.source || null
        }
      }
    };
  });
  const includedCount = steps.filter(step => step.include === true).length;
  if (!includedCount) throw new Error(`machine_candidate_episode_has_no_strategy_steps:${candidate?.episodeId || '<missing>'}`);
  return {
    contractVersion: '0.1.1',
    episodeId: candidate.episodeId,
    splitGroup: candidate.splitGroup,
    steps,
    machineVerification: {
      method: proof.method,
      status: 'accept',
      eligibilityVersion: proof.eligibilityVersion,
      eligibilityDigest: proof.eligibilityDigest,
      sourceCandidateDigest: proof.sourceCandidateDigest,
      taskPrivacyVerified: true,
      semanticLabelsVerified: true,
      outcomeVerified: true,
      credentialsExcluded: true,
      secretsExcluded: true,
      outcomeVerification: eligibilityItem.outcomeVerification,
      verifiedAt: new Date().toISOString()
    },
    policy: {
      createdOnlyAfterMachineEligibilityAccept: true,
      humanApprovalClaimed: false,
      quarantineOrRejectNeverMaterialized: true,
      excludedCaptureNoisePreservedAsExcludedProvenance: true,
      productionPromotionAllowed: false
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
  let reviewedTransitionCount = 0;
  let approvedStrategyStepCount = 0;
  let excludedCaptureNoiseCount = 0;
  for (const item of Array.isArray(candidate?.candidates) ? candidate.candidates : []) {
    const annotation = annotationForCandidate(item, proof);
    reviewedTransitionCount += annotation.steps.length;
    approvedStrategyStepCount += annotation.steps.filter(step => step.include === true).length;
    excludedCaptureNoiseCount += annotation.steps.filter(step => step.include === false).length;
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
    approvedTransitionCount: reviewedTransitionCount,
    approvedStrategyStepCount,
    excludedCaptureNoiseCount,
    blockedEpisodeCount: Array.isArray(candidate?.blocked) ? candidate.blocked.length : 0,
    explicitHumanConfirmationVerified: true,
    policy: {
      candidateDigestIntegrityVerified: true,
      exactDigestHashConfirmedByHuman: true,
      exactConfirmationPhraseRequired: true,
      noBlockedEpisodeApproved: true,
      excludedNoiseNeverBecomesStrategyStep: true,
      annotationsRemainUnassignedUntilDatasetSplit: true
    },
    annotationFiles: files.map(file => path.relative(process.cwd(), file))
  };
  const receiptFile = path.join(outDir, 'approval-receipt.json');
  fs.writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return { receipt, receiptFile, annotationFiles: files };
}

function applyMachineAcceptedCandidates(candidateFile, eligibilityFile, outputDir) {
  const fullCandidate = path.resolve(candidateFile);
  const fullEligibility = path.resolve(eligibilityFile);
  const candidate = readJson(fullCandidate);
  const eligibility = readJson(fullEligibility);
  const proof = assertMachineEligibilityProof(fullCandidate, candidate, fullEligibility, eligibility);
  const outDir = path.resolve(outputDir || path.join(path.dirname(fullCandidate), 'machine-verified-annotations'));
  fs.mkdirSync(outDir, { recursive: true });

  const candidateByEpisode = new Map((Array.isArray(candidate?.candidates) ? candidate.candidates : [])
    .map(item => [String(item?.episodeId || ''), item]));
  const files = [];
  let verifiedTransitionCount = 0;
  let verifiedStrategyStepCount = 0;
  let excludedCaptureNoiseCount = 0;

  for (const episodeId of Array.isArray(eligibility?.machineAcceptEpisodeIds) ? eligibility.machineAcceptEpisodeIds : []) {
    const id = String(episodeId || '');
    const item = candidateByEpisode.get(id);
    if (!item) throw new Error(`machine_accept_candidate_missing:${id || '<missing>'}`);
    const eligibilityItem = proof.acceptedItems.get(id);
    const annotation = machineAnnotationForCandidate(item, proof, eligibilityItem);
    verifiedTransitionCount += annotation.steps.length;
    verifiedStrategyStepCount += annotation.steps.filter(step => step.include === true).length;
    excludedCaptureNoiseCount += annotation.steps.filter(step => step.include === false).length;
    const file = path.join(outDir, `${safeName(id)}.strategy-review.machine-verified.json`);
    fs.writeFileSync(file, `${JSON.stringify(annotation, null, 2)}\n`, 'utf8');
    files.push(file);
  }
  if (!files.length) throw new Error('no_machine_accepted_strategy_candidates');

  const receipt = {
    approvalApplicatorVersion: APPROVAL_APPLICATOR_VERSION,
    generatedAt: new Date().toISOString(),
    verificationMode: 'machine-eligibility',
    sourceCandidateFile: path.relative(process.cwd(), fullCandidate),
    sourceEligibilityFile: path.relative(process.cwd(), fullEligibility),
    sourceCandidateDigest: proof.sourceCandidateDigest,
    eligibilityDigest: proof.eligibilityDigest,
    machineAcceptedEpisodeCount: files.length,
    machineVerifiedTransitionCount: verifiedTransitionCount,
    machineVerifiedStrategyStepCount: verifiedStrategyStepCount,
    excludedCaptureNoiseCount,
    quarantineEpisodeCount: Array.isArray(eligibility?.quarantineEpisodeIds) ? eligibility.quarantineEpisodeIds.length : 0,
    rejectEpisodeCount: Array.isArray(eligibility?.rejectEpisodeIds) ? eligibility.rejectEpisodeIds.length : 0,
    explicitHumanConfirmationVerified: false,
    policy: {
      candidateDigestIntegrityVerified: true,
      machineEligibilityFailClosedVerified: true,
      independentOutcomeVerificationRequired: true,
      onlyAcceptEpisodesMaterialized: true,
      quarantineNeverMaterialized: true,
      rejectNeverMaterialized: true,
      humanApprovalClaimed: false,
      productionPromotionAllowed: false
    },
    annotationFiles: files.map(file => path.relative(process.cwd(), file))
  };
  const receiptFile = path.join(outDir, 'machine-verification-receipt.json');
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
    if (args['machine-eligibility']) {
      if (!args.candidates) throw new Error('--candidates is required with --machine-eligibility');
      const applied = applyMachineAcceptedCandidates(args.candidates, args['machine-eligibility'], args.out);
      console.log(JSON.stringify({
        ok: true,
        result: 'PASS',
        version: applied.receipt.approvalApplicatorVersion,
        verificationMode: applied.receipt.verificationMode,
        machineAcceptedEpisodeCount: applied.receipt.machineAcceptedEpisodeCount,
        quarantineEpisodeCount: applied.receipt.quarantineEpisodeCount,
        rejectEpisodeCount: applied.receipt.rejectEpisodeCount,
        explicitHumanConfirmationVerified: false,
        annotations: path.resolve(path.dirname(applied.receiptFile)),
        receipt: path.resolve(applied.receiptFile)
      }, null, 2));
      return;
    }
    if (!args.candidates) {
      throw new Error('Usage: node training-collector/tools/apply_strategy_approval_candidates.js --candidates <approval-candidates.json> (--confirm-digest <sha256> --confirm <phrase> | --machine-eligibility <machine-eligibility.json>) [--out dir]');
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
      approvedStrategyStepCount: applied.receipt.approvedStrategyStepCount,
      excludedCaptureNoiseCount: applied.receipt.excludedCaptureNoiseCount,
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
  machineEligibilityHashPayload,
  machineEligibilityDigest,
  assertMachineEligibilityProof,
  machineAnnotationForCandidate,
  applyApprovalCandidates,
  applyMachineAcceptedCandidates,
  parseArgs,
  main
};
