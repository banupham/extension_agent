# Agent development handoff

This file is the durable continuation point for future ChatGPT sessions. Read this file before changing the repository.

## Working rules

- Active development branch: `feat/agent-tab-context`.
- Do **not** promote or merge to `main` without explicit user approval after a verified PASS.
- Every meaningful development/diagnostic action must be committed to GitHub, and this handoff must be updated whenever current state or next step changes.
- User works in Windows CMD and wants exact sequential commands.
- User does not want long technical explanations; say whether the agent is maturing / being taught, then give the next action.
- Preserve boundaries: Strategy chooses WHAT, Behavior chooses HOW, executor does not choose strategy, Goal Checker does not choose the next action.
- Do not persist selectors, coordinates, tab IDs, raw CDP methods, credentials, secrets, passwords, typed sensitive values, or private reasoning in Strategy/recovery/training memory.
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

## Collector bug is closed

The previous `episode_success_has_pending_transition` problem on Message Composer + Enter was fixed by serialized episode-state mutation queue.

Native proof already exists:

- task export: `training-collector-ep-1787831377719.task-episode-review.json`
- final outcome: `success`
- `strategyReady: true`
- no pending transitions
- Enter is a completed transition

Therefore **do not ask the user to recollect Message Composer or the six-task set**. Collector is not the blocker.

## Current six-demonstration teaching set

Local folder:

`%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827`

Episodes:

1. `ep-1787826569158` — Google -> Gmail click
2. `ep-1787826618214` — Google -> type OpenAI -> submit search
3. `ep-1787826766003` — Mission Atlas -> Mission Orion
4. `ep-1787828642619` — Topic Search -> type Atlas -> Enter
5. `ep-1787831377719` — Message Composer -> type Orion -> Enter
6. `ep-1787828809498` — Teaching Confirm click

Latest pre-fix pipeline results:

- reviewFileCount: 6
- readyForHumanReviewCount: 6
- transitionCount: 51
- fastLabelReviewCount: 15
- ambiguousLabelReviewCount: 36
- resolver resolvedSemanticActionCount: 5
- resolver captureNoiseCount: 22
- resolver unresolvedHumanReviewCount: 19
- resolver fullyResolvedEpisodeCount: 4
- approval candidateEpisodeCount: 4
- approval blockedEpisodeCount: 2
- previous digestHash: `004521d14db9c11d78a41f9f1e043d8c7e5a30302e6063aa2a5e70e3cb4dff9b`
- autoTrainEligible: false

Do **not** approve the previous digest.

The two previously blocked episodes were:

- `ep-1787828642619`: `unresolved_ambiguous_transition, suggested_action_missing`
- `ep-1787831377719`: `unresolved_ambiguous_transition, suggested_action_missing`

## Generic semantic text/form resolver milestone — implemented and CI PASS

The Strategy teaching resolver bottleneck has now been addressed generically.

Important commits on `feat/agent-tab-context`:

- `74cb9a2c721a0fe9b201b8ecac0a02837ba6c558` — `feat(strategy): resolve generic semantic text submit sequences`
- `d89e1ac3e3cf9978f6372d0bf8ee8c8e1dfffb7b` — `test(strategy): add generic text form sequence resolver contract`
- `d4cf192ca27e6e8ba83f19c777a56e961f0803d5` — `ci(strategy): gate generic text form resolver contract`

Resolver version is now `0.2.0`.

Implemented semantics:

- task-declared non-sensitive text is the only text allowed into proposed `typeText`
- focus/click used to acquire an editable field are HOW/capture noise
- per-character `text-key/type-char` transitions on one continuous semantic editable target collapse into one Strategy `typeText`
- intermediate `text-change` capture is provenance/HOW noise
- Enter on the same semantic editable target becomes Strategy `submit` only when task wording requests submit/search/send/Enter and successful task outcome evidence is present
- target continuity can use semantic editable target identity, not site-specific names
- insufficient target/task/outcome evidence remains `needs-human-review`
- human confirmation is still required; `autoTrainEligible:false`
- no literal trajectory replay was added

New contract:

`training-collector/tests/strategy_text_form_sequence_resolver_contract.js`

It proves:

1. search-like text + Enter -> `typeText -> submit`
2. composer-like text + Enter -> `typeText -> submit`
3. semantic progress is `0.5` then `1`
4. focus/click/text-change/extra per-character capture is excluded as HOW/capture noise
5. Enter on a different editable target remains blocked
6. failed final outcome does not resolve the sequence
7. resolver source does not hard-code Atlas, Orion, Topic Search, Message Composer, or localhost:8092
8. sensitive task text is not extracted

CI integration:

- workflow: `.github/workflows/strategy-teaching-batch-resolver.yml`
- GitHub Actions run: `33070246090`
- head SHA: `d4cf192ca27e6e8ba83f19c777a56e961f0803d5`
- conclusion: `success`

## Immediate next step — local six-group validation only

Do not recollect anything. User should pull and rerun only from resolver onward using the existing six-group folder.

Run in Windows CMD exactly:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD

set SIX=%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827

node training-collector\tests\strategy_text_form_sequence_resolver_contract.js

node training-collector\tools\resolve_strategy_teaching_batch.js --pack "%SIX%\review-pack-v01\review-pack.json" --triage "%SIX%\review-pack-v01\triage.v01.json" --out "%SIX%\teaching-resolution-v02"

node training-collector\tools\prepare_strategy_approval_candidates.js --digest "%SIX%\review-drafts-v01\approval-digest.json" --resolution "%SIX%\teaching-resolution-v02\ambiguity-resolution.json" --out "%SIX%\approval-candidates-v02"

type "%SIX%\approval-candidates-v02\approval-candidates.md"
```

Expected target before any approval:

- contract PASS
- `candidateEpisodeCount = 6`
- `blockedEpisodeCount = 0`
- six genuinely distinct semantic split groups
- Topic Search represented as `typeText -> submit`
- Message Composer represented as `typeText -> submit`
- first semantic progress `0.5`, terminal submit progress `1`
- `autoTrainEligible:false`

When the user sends the output, read it and continue immediately. Do not repeat already-passed collection steps.

If the target is met, show the new digest hash and wait for the user's explicit human confirmation. **Do not auto-approve.**

Only after explicit human confirmation:

1. apply approvals
2. build Strategy dataset
3. require `distinctSplitGroupCount >= 6`
4. require `datasetBuilt:true`
5. require `baselineReady:true`
6. require TRAIN contains `click`, `typeText`, `submit`
7. keep validation/test held out

Only when `baselineReady=true`:

- fit Strategy model from TRAIN only
- heldout evaluation
- load learned Strategy with learned Behavior at runtime
- native long-mission test
- multi-subgoal
- replan
- recovery
- semantic memory

Never promote to `main` without explicit user approval after verified PASS.
