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

CI at `f3d464b` is fully green, including semantic mission/goal contracts, behavior baseline contracts, ambiguity profiler, target-backfill contract, and explicit Strategy approval pipeline contract.

## Interpretation

The new target-backfill mechanism is contract-correct but recovered **zero** semantic targets from the user's 68 real raw telemetry files. Therefore the remaining 25 ambiguous click transitions must not be guessed or auto-approved. The blocker is evidence linkage/availability in the real telemetry, not the approval machinery.

## Immediate next action

Diagnose why real raw telemetry cannot be linked to the 25 review transitions. Compare the identifiers available in:

1. review-pack transition IDs / rawAction target refs,
2. task-episode review exports,
3. raw telemetry event `pageInstanceId`, `targetRef`, `resolvedTargetRef`, `targetDescriptor`, and sequence/timestamps.

Then make the smallest privacy-safe linkage improvement. Preferred evidence order:

1. exact page-instance + element-ref correlation,
2. exact transition/page provenance if available,
3. bounded timestamp/sequence correlation only when unambiguous.

Do not infer target semantics from task wording alone. If evidence remains insufficient, leave the 25 transitions unresolved and improve future capture instead.

## Useful local commands

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD
node training-collector\tests\strategy_target_backfill_contract.js
```
