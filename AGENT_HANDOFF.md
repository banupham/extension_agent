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

## Generic semantic text/form resolver milestone

Important commits:

- `74cb9a2c721a0fe9b201b8ecac0a02837ba6c558` — generic semantic text/submit sequence resolver
- `d89e1ac3e3cf9978f6372d0bf8ee8c8e1dfffb7b` — generic resolver contract
- `d4cf192ca27e6e8ba83f19c777a56e961f0803d5` — CI gate

Resolver version: `0.2.0`.

Synthetic contract proves generic search/composer-like `typeText -> submit`, HOW/capture-noise collapse, negative ambiguity blocking, privacy rules, semantic progress `0.5 -> 1`, and no hard-coded teaching-site names.

GitHub Actions run `33070246090` passed.

## Real six-group validation on resolver 0.2.0 — NOT YET PASS

User pulled HEAD `beb15f3` and ran the requested local validation.

Confirmed PASS:

- `training-collector/tests/strategy_text_form_sequence_resolver_contract.js` => PASS
- resolver CLI completed successfully
- approval-candidate CLI completed successfully
- no recollection needed

But the real six-group target was **not** met:

Resolver output:

- episodeCount: 6
- ambiguousTransitionCount: 36
- resolvedSemanticActionCount: 4
- captureNoiseCount: 22
- unresolvedHumanReviewCount: 20
- fullyResolvedEpisodeCount: 4
- autoTrainEligible: false

Approval candidates:

- candidateEpisodeCount: 4
- blockedEpisodeCount: 2
- ambiguityAidCandidateEpisodeCount: 3
- digestHash: `7926cdedd75156338847b25707214b68f98ad2ef2c9bfbca7b29bf3753eabef2`
- autoTrainEligible: false

Still blocked:

- `ep-1787828642619`: `unresolved_ambiguous_transition, suggested_action_missing`
- `ep-1787831377719`: `unresolved_ambiguous_transition, suggested_action_missing`

**Do not approve digest `7926cd...`.** It still excludes the two new text+submit teaching examples.

This means the synthetic contract shape is still narrower than the real capture shape. The next step is diagnosis of the real semantic transition shape, not collection and not approval.

## Privacy-safe real-data diagnostic added

New commits:

- `e715630c9f5dd7400d06fcf50be1fa293de9713f` — `diag(strategy): add privacy-safe text form sequence diagnostic`
- `bf1319e94c7983ed7b1489ae534605cff1f5695a` — diagnostic privacy contract
- `1ac35e65894f84d245e8d128e588d146cbd1dcdd` — CI gate for diagnostic

Tool:

`training-collector/tools/diagnose_strategy_text_form_sequences.js`

The diagnostic intentionally does **not** print:

- typed values
- raw key characters
- selectors
- coordinates
- tab IDs
- raw CDP
- targetRef values

It prints only evidence needed to identify the resolver mismatch:

- raw action kind/operation class
- Enter control classification
- semantic target label/role/tag/editable state
- semantic target continuity key
- action success
- observable semantic state-change boolean
- coarse rejection reason codes

CI job for GitHub Actions run `33070658960` completed successfully, including diagnostic syntax and privacy contract.

## Immediate next step

Do not rerun collection, resolver, or approval candidates yet. Pull the diagnostic commit and run only the privacy-safe diagnostic on the two blocked episodes.

Windows CMD:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD

set SIX=%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827

node training-collector\tools\diagnose_strategy_text_form_sequences.js --pack "%SIX%\review-pack-v01\review-pack.json" --triage "%SIX%\review-pack-v01\triage.v01.json" --episode ep-1787828642619,ep-1787831377719
```

When the user sends that diagnostic output, read it directly and implement the resolver fix. Do not ask the user to repeat already-PASS steps.

After the fix, add/update contract, CI, and handoff, then ask user to rerun only resolver -> approval candidates. Target remains:

- candidateEpisodeCount = 6
- blockedEpisodeCount = 0
- six genuinely distinct semantic split groups
- Topic Search = `typeText -> submit`
- Message Composer = `typeText -> submit`
- progress `0.5 -> 1`
- autoTrainEligible = false until explicit human digest confirmation

Only after explicit digest confirmation:

1. apply approvals
2. build Strategy dataset
3. require `distinctSplitGroupCount >= 6`
4. require `datasetBuilt:true`
5. require `baselineReady:true`
6. require TRAIN contains `click`, `typeText`, `submit`
7. keep validation/test held out

Only when `baselineReady=true`:

- fit Strategy from TRAIN only
- heldout evaluation
- runtime-load learned Strategy alongside learned Behavior
- native long-mission test
- multi-subgoal
- replan
- recovery
- semantic memory

Never promote to `main` without explicit user approval after verified PASS.
