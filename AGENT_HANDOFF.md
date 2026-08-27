# Agent development handoff

Read this file before changing the repository.

## Working rules

- Active branch: `feat/agent-tab-context` only.
- Do **not** merge/promote to `main` without explicit user approval after verified PASS.
- Commit every meaningful development, diagnostic, test, and state milestone to GitHub.
- Update this handoff after milestones/state changes.
- User runs Windows CMD, not PowerShell.
- Strategy chooses **WHAT**; Behavior chooses **HOW**.
- No site/ref hardcode to force PASS.
- No generic `failure => scroll`.
- Never move heldout into TRAIN or change split policy merely to force PASS.
- Do not recollect/relabel the six historical teaching tasks merely to force PASS.
- Do not persist selectors, coordinates, tab IDs, raw CDP, credentials/passwords/secrets, typed sensitive values, or private reasoning in Strategy/recovery/memory/training.
- No literal trajectory replay.
- Human demonstrations never auto-promote; exact digest confirmation is required before approval is applied.
- Raw user interaction never auto-trains directly.

## Current maturity

- Behavior/HOW is learned from real human interaction and runtime-loadable.
- Strategy/WHAT is supervised and trained from the first human-approved leakage-safe six-group dataset.
- Strategy v0.3.3 passes unchanged six-group regression exactly on validation/test.
- Frozen v0.3.3 passed two fresh-unseen semantic decision families.
- Frozen v0.3.3 passed a real fresh browser-native Cargo end-to-end family.
- Mission/replan/recovery/world-model infrastructure is integrated with the learned Strategy.
- Signal Relay long browser-native regression passes all 3 subgoals with real recovery, progression guard, goal checks, privacy redaction, and frozen model invariants.
- **Frozen v0.3.3 now also passes a pristine fresh-unseen long browser-native Harbor Dispatch mission on the first real user run.**
- Current primary phase is now **continuous learning from approved new user interactions**, not more controlled lab tuning.
- Incremental Strategy ingestion is now wired through a review-only orchestrator that stops before approval/dataset/fit and is CI-gated.
- Agent is maturing but is not broadly autonomous.

## Historical teaching data — CLOSED

Six fixed episodes:

1. `ep-1787826569158` — Google -> Gmail click
2. `ep-1787826618214` — Google -> type OpenAI -> submit search
3. `ep-1787826766003` — Mission Atlas -> Mission Orion
4. `ep-1787828642619` — Topic Search -> type Atlas -> Enter
5. `ep-1787831377719` — Message Composer -> type Orion -> Enter
6. `ep-1787828809498` — Teaching Confirm click

Approved digest:

`8f18d4e5b053d9dae57107b4aa021dfbf46128df3c75b9c50dbad996346b8241`

Exact human approval already received. Do not ask again.

Dataset:

- approvedEpisodeCount 6
- approvedStrategyStepCount 10
- excludedCaptureNoiseCount 41
- adaptedEpisodeCount 6
- distinctSplitGroupCount 6
- train 4 / validation 1 / test 1
- `baselineReady:true`
- heldout never used for fit

TRAIN:
- click:gmail
- click:mission-atlas>click:mission-orion
- click:teaching-confirm
- typeText:message-composer>submit:message-composer

VALIDATION:
- typeText:topic-search>submit:topic-search

TEST:
- typeText:t-m-ki-m>submit:t-m-ki-m

Six-group reruns are regression evidence, not pristine unseen proof.

## Strategy v0.3.3

Policy:

- `actionSelectionPolicy: task-history-decoupled-from-current-target-ranking`
- `actionSelectionUsesCurrentTargetRanking:false`
- `targetGroundingPolicy: current-task-dominant-with-action-affordance`

Do not keep tuning on the six historical records.

## Fresh semantic + Cargo evidence

Frozen v0.3.3, no fit/mutation:

- fresh parcel approval: click + correct target
- fresh dispatch note: `typeText -> submit` + target continuity
- Cargo native: exact `typeText -> submit`, exact `Cargo Instruction -> Cargo Instruction`, real Chrome goal PASS
- model unchanged, transient text redacted, no selectors/literal replay

Cargo is closed evidence. Do not optimize/train on it.

## Mission runtime upgrades

### Transient payload + step hooks

- `4cec004bd51a01185f59e2b16f4f56f2252e45d6` — mission executor passes execution-time transient args + step hook into each subgoal and verifies cross-subgoal redaction
- `32f6df2540f3e946491118f0c116669813ebf5d1` — contract

### Recovery planned-progression guard

Generic behavior:

- ask base Strategy for planned next semantic decision before recovery
- if action type changes, preserve progression
- if same action type but semantic target changes, preserve progression
- recovery explores only when base repeats the same failed action/target or otherwise does not progress
- no generic `failure => scroll`

Commits:

- `cc7acf88e2a559c9229c366a8c208cf4118ee587`
- `f42a1f38f719c6c7c509b0f2aabf633f0a6dd5b4`

## Signal Relay — REGRESSION PASS / CLOSED

Mission:

`Click Open Relay Console, then type the provided value into Relay Note and press Enter, then click Finalize Relay`

After fixing only the controlled page's native form semantics, real browser regression returned:

- `ok:true`, `result:PASS`
- `gateVersion:0.1.1`
- `evidenceClass:regression-after-diagnosis`
- `missionReasonCode:mission_satisfied`
- progress `3/3`
- exact actions `[["click","waitAndObserve"],["typeText","submit"],["click"]]`
- exact targets `[["Open Relay Console",null],["Relay Note","Relay Note"],["Finalize Relay"]]`
- recovery on subgoal 1 came from `recoveryExploration`
- subgoal 2 preserved planned `typeText -> submit` with `recoveryDeferredForBaseProgression:true`
- model frozen/unchanged
- transient payload redacted and absent from public result
- ordered execution / semantic goal checks / no literal replay all true
- errors empty, created tab closed

Signal Relay is closed regression evidence. Do not optimize it further.

## Harbor Dispatch — PRISTINE FRESH LONG NATIVE PASS / CLOSED

Gate:

`control-center/script/offline_strategy_fresh_long_harbor_gate.js`

Family was created only after Signal Relay regression PASS and was not used for diagnosis/tuning before the user's first real run.

Mission:

`type the provided value into Dispatch Token and press Enter, then click Open Berth Schedule, then click Confirm Berth`

First real user run at HEAD `8d7351c` returned PASS immediately:

- `ok:true`
- `result:PASS`
- `gate:offline-strategy-fresh-long-harbor`
- `gateVersion:0.1.0`
- `evidenceClass:fresh-unseen-controlled-native`
- `modelVersion:0.3.3`
- `missionReasonCode:mission_satisfied`
- progress `3/3`, `missionDone:true`, `missionTerminal:true`
- exact actions `[["typeText","submit"],["click","waitAndObserve"],["click"]]`
- exact targets `[["Dispatch Token","Dispatch Token"],["Open Berth Schedule",null],["Confirm Berth"]]`

Subgoal 1:

- `typeText@Dispatch Token` used transient execution text and was privacy-redacted
- privacy-safe observer reported `no_effect`
- base Strategy progressed to `submit@Dispatch Token`
- `recoveryDeferredForBaseProgression:true`
- submit produced real semantic effect and goal satisfied

Subgoal 2:

- `click@Open Berth Schedule` produced real `no_effect`
- recovery source `recoveryExploration`
- `waitAndObserve` observed delayed semantic transition and goal satisfied

Subgoal 3:

- `click@Confirm Berth`
- semantic effect observed and mission satisfied

Invariants all true:

- `frozenModelOnly:true`
- `modelLoadedFromFile:true`
- `modelFileMutated:false`
- `transientPayloadRedacted:true`
- `publicResultContainsTransientText:false`
- `orderedExecution:true`
- `semanticSubgoalCountMatchesPlan:true`
- `allCompletedSubgoalsGoalChecked:true`
- `noLiteralTrajectoryReplay:true`
- `errors:[]`
- `createdTabClosed:true`

This is the first pristine fresh-unseen **long** browser-native mission proof for learned Strategy v0.3.3 with real recovery/replan. It is stronger than Signal Relay regression evidence. It is still controlled native evidence, not broad web autonomy proof.

Harbor is now closed evidence. Do not tune/train on Harbor merely to accumulate PASSes.

Gate/CI commits:

- `a20b0395a6a2bf8590bb5431aa54a5b3891c2bb8` — Harbor gate
- `181f5cccc8b3b15a2cf01cc1e1a6a4ae5fb2219a` — Harbor contract
- `ba55e442a76370336d4c0b28acb898d700504a12` — mission CI gates Harbor
- full runtime-syntax `33092139022`: success
- dedicated mission-long-native `33092170119`: success

## Current primary development — continuous learning

Now shift the main source of new capability from controlled runtime plumbing to approved new user data.

Target pipeline:

`new user interaction -> raw capture -> privacy/noise filter -> semantic episode candidate -> resolver -> human review/explicit digest approval -> approved dataset -> retrain -> fresh evaluation`

Required properties:

1. no `capture -> auto-train`
2. raw typed secrets/credentials/private values never enter Strategy/memory/training
3. capture mechanics such as focus/click/edit noise remain excluded unless semantically necessary
4. semantic candidate must distinguish WHAT from HOW before approval
5. human approval must be explicit and digest-bound before candidate promotion
6. approved episodes append/merge into a versioned dataset without mutating old heldout evidence merely to improve metrics
7. retraining creates a new Strategy version; v0.3.3 remains a frozen comparison baseline
8. every new model must be evaluated on old regression gates plus new fresh-unseen families
9. recovery experience may be learned only from successful, privacy-safe episodes; no literal trajectory replay

## Incremental Strategy ingestion — REVIEW-ONLY GATE PASS

New orchestrator:

`training-collector/tools/prepare_incremental_strategy_learning.js`

Version `0.1.0`.

Purpose:

- consume genuinely new `*.task-episode-review.json` exports, optionally alongside raw session data
- reuse the existing privacy-safe learning batch, review pack, triage, review-draft, teaching resolver, and digest-candidate tools
- deduplicate previously processed episode IDs and duplicate current exports before the review pack
- produce one reviewable digest-bound candidate bundle
- **stop before approval, dataset construction, or model fitting**

Pipeline:

`new reviews/raw -> privacy batch -> incremental episode filter -> review pack -> triage -> review drafts -> teaching resolver -> approval candidate digest -> STOP`

CLI options:

- `--reviews <task-episode-review-dir>` required
- `--raw <raw-session-dir>` optional
- `--exclude-approved <approved-annotations-dir>` optional
- `--exclude-episodes <episode-id-file>` optional
- `--out <output-dir>` optional

Hard boundaries:

- candidate digest must verify before output
- candidate policy must remain `autoTrainEligible:false`
- process throws if `apply_strategy_approval_candidates.js` is imported
- process throws if `build_strategy_dataset_from_approvals.js` is imported
- process throws if `fit_strategy_offline_baseline.js` is imported
- manifest records `approvalApplied:false`, `datasetBuilt:false`, `trainingPerformed:false`
- previously approved episode IDs can be excluded by scanning `.strategy-review.approved.json` annotations
- duplicate current exports with the same episode ID are reduced to one review-queue entry
- privacy-unsafe review exports remain blocked before candidate generation

Default output layout:

- `01-learning-batch/`
- `02-incremental-filter/incremental-manifest.json`
- `03-review-pack/`
- `04-triage/triage.json`
- `05-review-drafts/`
- `06-resolution/`
- `07-approval-candidates/`
- `incremental-strategy-learning-manifest.json`
- `incremental-strategy-learning-review.md`

Commits:

- `caff7ad78949bac6b9a81ddc603b52465f428a5f` — incremental review-only orchestrator
- `ae4dac8bac4742bd6ee6aeee7dea32ce5189f882` — synthetic incremental boundary contract
- `fca2f20d49143deb44c7eb66b7490e5794559b84` — dedicated incremental-learning CI workflow

Synthetic contract proves in one batch:

- one previously approved episode is excluded
- one duplicate current export is deduplicated
- one privacy-unsafe review stays blocked before review pack/candidate
- one genuinely new safe successful click review becomes exactly one digest candidate
- digest integrity verifies
- no approved annotation, approval receipt, train/validation/test dataset, or model is created
- approval applicator/dataset builder/fitter modules are not imported by the orchestrator process

CI:

- full runtime-syntax on orchestrator + boundary contract `33093032281`: success
- dedicated `strategy-incremental-learning` run `33093059221`: success
  - incremental Strategy learning boundary PASS
  - privacy-safe human learning batch PASS
  - Strategy teaching resolver PASS
  - explicit approval/dataset boundary PASS

### Immediate next step

Use genuinely new post-v0.3.3 user interaction episodes as the first real incremental input. Do not reuse the historical six teaching tasks, Cargo, Signal Relay, or Harbor as training additions.

The first real incremental run should stop at a candidate digest. Inspect its candidate count, blocked count, unresolved count, privacy invariants, semantic sequences, and digest hash. Only after the user explicitly reviews and confirms that exact digest may approval annotations be created. Dataset merge/versioning and retraining come after that separate approval milestone.

Never promote to `main` without explicit user approval after verified PASS.
