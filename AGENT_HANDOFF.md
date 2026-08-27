# Agent development handoff

This file is the durable continuation point for future ChatGPT sessions. Read this file before changing the repository.

## Working rules

- Active development branch: `feat/agent-tab-context`.
- Do **not** promote or merge to `main` without explicit user approval after a verified PASS.
- Every meaningful development/diagnostic action must be committed to GitHub, and this handoff must be updated whenever current state or next step changes.
- Preserve boundaries: Strategy chooses WHAT, Behavior chooses HOW, executor does not choose strategy, Goal Checker does not choose the next action.
- Do not persist selectors, coordinates, tab IDs, raw CDP methods, credentials, secrets, or private reasoning in Strategy/recovery/training memory.
- Human demonstrations never auto-promote to Strategy training; explicit human review remains required.
- User wants concise progress framing: say whether the agent is maturing / being taught, then give the next action. Avoid long technical explanations.

## Agent maturity status

- Behavior/HOW: learned from real human demonstrations and runtime-loadable.
- Strategy/WHAT: still supervised, with the first explicit human-approved 3-family dataset already built.
- Overall: agent is maturing, but still being taught.

## First approved Strategy teaching batch

- approvedEpisodeCount: 3
- approvedStrategyStepCount: 5
- distinctSplitGroupCount: 3
- datasetBuilt: true
- splitCounts: train=1, validation=1, test=1
- baselineReady: false
- readiness error: `test_action_types_unseen_in_train:submit,typeText`

Do not move held-out examples into train and do not alter split policy to force readiness.

## Second teaching round

The controlled lab is `http://127.0.0.1:8092/` and adds three new semantic groups:

1. Topic Search: type text + submit.
2. Message Composer: type text + submit.
3. Teaching Confirm: click.

Second-round review exports now available:

- task 1 / Topic Search: `training-collector-ep-1787828642619.task-episode-review.json`
- task 2 / Message Composer: `training-collector-ep-1787831377719.task-episode-review.json`
- task 3 / Teaching Confirm: `training-collector-ep-1787828809498.task-episode-review.json`

Task 2 previously reproduced `episode_success_has_pending_transition` repeatedly. Root-fix v3 serialized all episode-state mutations through one queue so rapid transition updates cannot overwrite each other.

Root-fix commits:

- `89fce567c76a5793f656722cde8d23a7ba912a60` — serialized episode-state queue.
- `f49399b044fd2824836d0325b8f1a624421e23da` — queue START/END/STOP/start-episode state mutations and safe diagnostic endpoint.
- `857369f37c2f2bade414f462e57b2500e78bc81c` — episode state queue contract.
- `c1d8148735d2db9b477be4a9a97b7c48ee030257` — popup pending-transition diagnostic.
- `fd273ef91ba1cdefa2c1a09cbe411202c98c6829` — CI gate.
- `b99e1bb0276da52fbdc3c386af593b970bebb8d3` — durable handoff before native retry.

GitHub Actions run `33068893125` passed stop-settlement, transition-order, episode-state-queue, and Strategy teaching coverage contracts.

## Native proof after root fix v3

The user retried only task 2 and exported `ep-1787831377719` successfully.

Verified from the exported review:

- task instruction: `nhập Orion vào ô Message Composer rồi gửi bằng Enter.`
- final outcome: `success`
- `strategyReady: true`
- no `status: pending` transitions remain
- the Enter action on `Message Composer` is present as a completed transition

Therefore the pending-transition blocker is closed for the controlled teaching scenario. Do not ask the user to repeat task 2 again.

## Immediate next action: six-group Strategy teaching dataset

Build a fresh combined review set with the original first 3 approved teaching demonstrations plus the 3 second-round demonstrations, then rerun review -> triage -> teaching resolver -> approval candidates.

Original first-round files:

- `training-collector-ep-1787826569158.task-episode-review.json`
- `training-collector-ep-1787826618214.task-episode-review.json`
- `training-collector-ep-1787826766003.task-episode-review.json`

Second-round files:

- `training-collector-ep-1787828642619.task-episode-review.json`
- `training-collector-ep-1787831377719.task-episode-review.json`
- `training-collector-ep-1787828809498.task-episode-review.json`

Use a fresh local folder such as `%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827` and do not mutate the previous three-group dataset.

Run:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD

set SIX=%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827
mkdir "%SIX%\reviews" 2>nul

copy /Y "%USERPROFILE%\Downloads\extension_agent-local-data\teaching-batch-20260827\reviews\training-collector-ep-1787826569158.task-episode-review.json" "%SIX%\reviews\"
copy /Y "%USERPROFILE%\Downloads\extension_agent-local-data\teaching-batch-20260827\reviews\training-collector-ep-1787826618214.task-episode-review.json" "%SIX%\reviews\"
copy /Y "%USERPROFILE%\Downloads\extension_agent-local-data\teaching-batch-20260827\reviews\training-collector-ep-1787826766003.task-episode-review.json" "%SIX%\reviews\"
copy /Y "%USERPROFILE%\Downloads\training-collector-ep-1787828642619.task-episode-review.json" "%SIX%\reviews\"
copy /Y "%USERPROFILE%\Downloads\training-collector-ep-1787831377719.task-episode-review.json" "%SIX%\reviews\"
copy /Y "%USERPROFILE%\Downloads\training-collector-ep-1787828809498.task-episode-review.json" "%SIX%\reviews\"

node training-collector\tools\prepare_human_learning_batch.js --reviews "%SIX%\reviews" --out "%SIX%\batch-v01"
node training-collector\tools\prepare_strategy_review_pack.js --manifest "%SIX%\batch-v01\manifest.json" --out "%SIX%\review-pack-v01"
node training-collector\tools\score_strategy_review_pack.js --pack "%SIX%\review-pack-v01\review-pack.json" --out "%SIX%\review-pack-v01\triage.v01.json"
node training-collector\tools\resolve_strategy_teaching_batch.js --pack "%SIX%\review-pack-v01\review-pack.json" --triage "%SIX%\review-pack-v01\triage.v01.json" --out "%SIX%\teaching-resolution-v01"
node training-collector\tools\prepare_strategy_review_drafts.js --pack "%SIX%\review-pack-v01\review-pack.json" --triage "%SIX%\review-pack-v01\triage.v01.json" --out "%SIX%\review-drafts-v01"
node training-collector\tools\prepare_strategy_approval_candidates.js --digest "%SIX%\review-drafts-v01\approval-digest.json" --resolution "%SIX%\teaching-resolution-v01\ambiguity-resolution.json" --out "%SIX%\approval-candidates-v01"
type "%SIX%\approval-candidates-v01\approval-candidates.md"
```

Stop before applying approvals. Explicit human confirmation of the new exact digest is still required.

Target after approval/build: `distinctSplitGroupCount >= 6`, `datasetBuilt:true`, `baselineReady:true`, train covers `click`, `typeText`, and `submit`, validation/test remain held out. Only then fit Strategy from TRAIN only and evaluate heldout. Do not promote `main`.
