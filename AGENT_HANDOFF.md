# Agent development handoff

This file is the durable continuation point for future ChatGPT sessions. Read this file before changing the repository.

## Working rules

- Active development branch: `feat/agent-tab-context`.
- Do **not** promote or merge to `main` without explicit user approval after a verified PASS.
- Every meaningful development/diagnostic action must be committed to GitHub, and this handoff must be updated when the current state or next step changes.
- Preserve architecture boundaries: Strategy chooses WHAT, Behavior chooses HOW, executor does not choose strategy, Goal Checker does not choose the next action.
- Do not persist selectors, coordinates, tab IDs, raw CDP methods, credentials, secrets, or private reasoning in Strategy/recovery/training memory.
- Human demonstration data is never auto-promoted to Strategy training. Human review/verification remains required.

## Current checkpoint

User local repo pulled feature branch head `f3d464b` and ran the target-backfill pipeline.

Verified local outputs:

- `training-collector/tests/strategy_target_backfill_contract.js` -> PASS.
- `backfill_strategy_target_evidence.js` over the real batch:
  - sourceRawFileCount: 68
  - requestedTransitionCount: 25
  - recoveredSemanticTargetCount: 0
  - unresolvedTargetCount: 25
  - conflictTargetCount: 0
- `resolve_strategy_review_ambiguity_with_targets.js`:
  - episodeCount: 28
  - ambiguousTransitionCount: 25
  - resolvedSemanticActionCount: 0
  - targetBackfillResolvedCount: 0
  - unresolvedHumanReviewCount: 25
- `prepare_strategy_approval_candidates.js`:
  - candidateEpisodeCount: 3
  - blockedEpisodeCount: 25
  - ambiguityAidCandidateEpisodeCount: 0
  - digestHash: `f0b4aaa723de2f67220e2e70b3f231036524f34eaccfbd3bfbd555df23a01749`
  - autoTrainEligible: false

## Diagnostic result from real batch

The user ran `diagnose_strategy_target_backfill.js` against the 68 real raw files. Result: PASS.

Key aggregate results:

- rawEventCount: 171040
- targetDescriptorEventCount: 14732
- resolvedTargetDescriptorEventCount: 205
- semanticSnapshotElementCount: 25712
- descriptorIndexKeyCount: 21569
- descriptorPageCount: 294
- descriptorRefTokenCount: 4607
- requestedTransitionCount: 25
- exactDescriptorKeyMatchCount: 0
- pagePresentButExactKeyMissingCount: 0
- targetRefSeenOnOtherPageCount: 25
- descriptorPageMissingCount: 0
- likelyBlocker: `element_refs_exist_but_page_identity_does_not_link`

Interpretation: useful semantic evidence exists in the raw telemetry, but the 25 historical review transitions cannot currently be linked to the correct raw page identity. Do not guess or auto-approve these 25 transitions.

## Agent maturity status

- Behavior/HOW: already learned from the user's real demonstrations and is runtime-loadable.
- Strategy/WHAT: early supervised-learning stage. It has some verified semantic experience, but is still being taught and does not yet have enough diverse, trustworthy human Strategy data for a new general Strategy fit.
- Overall: the agent is maturing, but it is still in the teaching phase rather than autonomous self-development.

## Immediate next action

Make the smallest privacy-safe provenance/linkage improvement so future and, where provably possible, historical review transitions can be connected to their semantic evidence. Do not infer targets from task wording alone.

Preferred order:

1. add durable capture provenance that directly connects episode transition to page instance + semantic target evidence at collection time;
2. attempt historical recovery only where correlation is deterministic and unambiguous;
3. leave unresolved historical transitions for human review if deterministic linkage is impossible.

After the capture/provenance patch, add a contract test, run CI, update this handoff, then run a new small human demonstration batch to verify that ambiguous clicks become semantically reviewable.
