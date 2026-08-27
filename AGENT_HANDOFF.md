# Agent development handoff

This file is the durable continuation point for future ChatGPT sessions. Read this file before changing the repository.

## Working rules

- Active development branch: `feat/agent-tab-context`.
- Do **not** promote or merge to `main` without explicit user approval after a verified PASS.
- Every meaningful development/diagnostic action must be committed to GitHub, and this handoff must be updated whenever current state or next step changes.
- User works in Windows CMD and wants exact sequential commands.
- User does not want long technical explanations; say whether the agent is maturing / being taught, then give the next action.
- Preserve boundaries: Strategy chooses WHAT, Behavior chooses HOW, executor does not choose strategy, Goal Checker does not choose the next action.
- Do not persist selectors, coordinates, tab IDs, raw CDP methods, credentials, secrets, or private reasoning in Strategy/recovery/training memory.
- Human demonstrations never auto-promote to Strategy training; explicit human review remains required.
- Recovery/learning must remain semantic and evidence-based; do not hard-code site-specific PASS titles or generic `failure => scroll` rules.

## Agent maturity status

- Behavior/HOW: learned from real human demonstrations and runtime-loadable.
- Strategy/WHAT: still supervised; first explicit human-approved 3-family dataset already exists.
- Overall: the agent is maturing, but it is still being taught.

## First approved Strategy teaching batch

Explicitly human-confirmed first batch:

- approvedEpisodeCount: 3
- approvedStrategyStepCount: 5
- distinctSplitGroupCount: 3
- datasetBuilt: true
- splitCounts: train=1, validation=1, test=1
- baselineReady: false
- readiness error: `test_action_types_unseen_in_train:submit,typeText`

Approved semantic groups:

1. `semantic-sequence:click:gmail`
2. `semantic-sequence:typeText:t-m-ki-m>submit:t-m-ki-m`
3. `semantic-sequence:click:mission-atlas>click:mission-orion`

Do not move held-out examples into train and do not alter split policy to force readiness.

## Collector bug that is now closed

Second-round task 2 (`Message Composer` + Enter) previously reproduced `episode_success_has_pending_transition`.

The collector was fixed by serializing episode-state mutations. Relevant commits before this handoff include:

- `89fce567c76a5793f656722cde8d23a7ba912a60` — serialized episode-state queue.
- `f49399b044fd2824836d0325b8f1a624421e23da` — queue START/END/STOP/start-episode state mutations and diagnostic endpoint.
- `857369f37c2f2bade414f462e57b2500e78bc81c` — episode-state queue contract.
- `c1d8148735d2db9b477be4a9a97b7c48ee030257` — popup pending-transition diagnostic.
- `fd273ef91ba1cdefa2c1a09cbe411202c98c6829` — CI gate.
- `b99e1bb0276da52fbdc3c386af593b970bebb8d3` — handoff before native retry.

GitHub Actions run `33068893125` passed the collector contracts.

Native proof after the fix:

- task 2 export: `training-collector-ep-1787831377719.task-episode-review.json`
- final outcome: `success`
- `strategyReady: true`
- no pending transitions
- Enter on `Message Composer` is present as a completed transition

Therefore **do not ask the user to repeat task 2 again**. The remaining blocker is semantic Strategy review, not capture reliability.

## Current six-demonstration teaching set

Combined review set contains these six episodes:

First round:

- `ep-1787826569158` — Google Gmail click
- `ep-1787826618214` — Google search: type OpenAI + submit
- `ep-1787826766003` — Mission Atlas + Mission Orion clicks

Second round:

- `ep-1787828642619` — Topic Search: type Atlas + Enter
- `ep-1787831377719` — Message Composer: type Orion + Enter
- `ep-1787828809498` — Teaching Confirm click

Local combined folder used by user:

`%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827`

Latest user pipeline results:

### Human learning batch

- reviewFileCount: 6
- readyForHumanReviewCount: 6
- autoTrainEligibleCount: 0

### Review pack / triage

- episodeCount: 6
- transitionCount: 51
- fastLabelReviewCount: 15
- ambiguousLabelReviewCount: 36
- fastLabelReviewCoverage: `0.29411764705882354`
- episodeFastLabelReviewCount: 2

### Teaching resolver

- ambiguousTransitionCount: 36
- resolvedSemanticActionCount: 5
- captureNoiseCount: 22
- unresolvedHumanReviewCount: 19
- fullyResolvedEpisodeCount: 4

### Approval candidates

- candidateEpisodeCount: 4
- blockedEpisodeCount: 2
- ambiguityAidCandidateEpisodeCount: 3
- digestHash: `004521d14db9c11d78a41f9f1e043d8c7e5a30302e6063aa2a5e70e3cb4dff9b`
- autoTrainEligible: false

Eligible semantic groups are currently:

1. `semantic-sequence:click:gmail`
2. `semantic-sequence:typeText:t-m-ki-m>submit:t-m-ki-m`
3. `semantic-sequence:click:mission-atlas>click:mission-orion`
4. `semantic-sequence:click:teaching-confirm`

Blocked episodes:

- `ep-1787828642619`: `unresolved_ambiguous_transition, suggested_action_missing`
- `ep-1787831377719`: `unresolved_ambiguous_transition, suggested_action_missing`

Do **not** apply/confirm digest `004521d...` yet. The two new form/text demonstrations are the important coverage examples; approving only the four currently eligible episodes does not solve the Strategy coverage goal.

## Immediate next development task

The current bottleneck is the Strategy teaching resolver, not the collector.

Inspect:

- `training-collector/tools/resolve_strategy_teaching_batch.js`
- `training-collector/tools/score_strategy_review_pack.js`
- `training-collector/tools/prepare_strategy_approval_candidates.js`
- `training-collector/core/action_normalizer.js`
- `training-collector/core/strategy_episode_view.js`
- the synthetic contracts around Strategy teaching / ambiguity resolution

Then implement a **generic semantic form/text sequence resolver** for the two blocked episodes. It must not be hard-coded to Atlas/Orion or to the teaching lab URL.

Expected semantic interpretation when evidence supports it:

- focus/click used only to acquire an editable field => HOW/capture noise
- per-character keyboard transitions on one editable semantic target => collapse into one Strategy `typeText`
- Enter on that same field when the task requests sending/submitting and the page outcome supports it => Strategy `submit`
- progress should be semantic: `0.5` after typeText, `1` after submit for a two-step task
- all unrelated extra key/focus/click capture stays excluded as provenance/noise
- if task/target/outcome evidence is insufficient, keep the transition blocked; never guess

Privacy/invariants:

- no selectors, coordinates, tabId, raw CDP, private reasoning, or typed secret values in Strategy labels
- no literal trajectory replay
- no automatic human verification
- `autoTrainEligible:false` remains true until explicit human confirmation

Add a contract that proves at least:

1. Topic Search-like typeText + Enter becomes `typeText -> submit`.
2. Message Composer-like typeText + Enter becomes `typeText -> submit`.
3. incidental focus/click/per-character keys are excluded as HOW/capture noise.
4. unsupported ambiguous sequences remain blocked.
5. solution is semantic/generic, not site-specific.

Integrate the contract into CI and commit every meaningful change on `feat/agent-tab-context`. Update this handoff again.

## What to ask the user to run after the resolver fix

Do not ask the user to recollect demonstrations. Reuse `%SIX%` and rebuild from resolver onward:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD

set SIX=%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827

node training-collector\tests\<new-resolver-contract>.js

node training-collector\tools\resolve_strategy_teaching_batch.js --pack "%SIX%\review-pack-v01\review-pack.json" --triage "%SIX%\review-pack-v01\triage.v01.json" --out "%SIX%\teaching-resolution-v02"

node training-collector\tools\prepare_strategy_approval_candidates.js --digest "%SIX%\review-drafts-v01\approval-digest.json" --resolution "%SIX%\teaching-resolution-v02\ambiguity-resolution.json" --out "%SIX%\approval-candidates-v02"

type "%SIX%\approval-candidates-v02\approval-candidates.md"
```

Expected target before any approval:

- candidateEpisodeCount: 6
- blockedEpisodeCount: 0
- six genuinely distinct semantic split groups
- second-round Topic Search and Message Composer both represented as `typeText -> submit`

Only after reviewing the new digest should the user explicitly confirm it. Then build the Strategy dataset. Target before Strategy fit:

- `distinctSplitGroupCount >= 6`
- `datasetBuilt:true`
- `baselineReady:true`
- TRAIN covers `click`, `typeText`, `submit`
- validation/test remain held out

Only then fit Strategy from TRAIN only, run heldout evaluation, load learned Strategy alongside learned Behavior in runtime, and proceed to native longer-mission testing with replan/recovery. Do not promote `main` without explicit user approval.
