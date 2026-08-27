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
- **Frozen v0.3.3 also passes a pristine fresh-unseen long browser-native Harbor Dispatch mission on the first real user run.**
- Current primary phase is **continuous learning from approved new user interactions**, not more controlled lab tuning.
- Incremental Strategy ingestion is wired through a review-only orchestrator that stops before approval/dataset/fit and is CI-gated.
- Incremental post-approval dataset merge now preserves every existing base split assignment across future appends.
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

Real browser regression after fixing only the controlled page's form semantics:

- `ok:true`, `result:PASS`
- `evidenceClass:regression-after-diagnosis`
- progress `3/3`
- exact actions `[["click","waitAndObserve"],["typeText","submit"],["click"]]`
- exact targets `[["Open Relay Console",null],["Relay Note","Relay Note"],["Finalize Relay"]]`
- real recovery on subgoal 1
- planned `typeText -> submit` preserved on subgoal 2
- model frozen/unchanged
- privacy/no-literal-replay invariants true

Signal Relay is closed regression evidence.

## Harbor Dispatch — PRISTINE FRESH LONG NATIVE PASS / CLOSED

Gate:

`control-center/script/offline_strategy_fresh_long_harbor_gate.js`

Mission:

`type the provided value into Dispatch Token and press Enter, then click Open Berth Schedule, then click Confirm Berth`

First real user run at HEAD `8d7351c` returned PASS immediately:

- `ok:true`
- `result:PASS`
- `evidenceClass:fresh-unseen-controlled-native`
- `modelVersion:0.3.3`
- `missionReasonCode:mission_satisfied`
- progress `3/3`
- exact actions `[["typeText","submit"],["click","waitAndObserve"],["click"]]`
- exact targets `[["Dispatch Token","Dispatch Token"],["Open Berth Schedule",null],["Confirm Berth"]]`
- subgoal 1: privacy-safe `typeText` no-effect observation, then planned submit preserved and succeeded
- subgoal 2: real click no-effect, `recoveryExploration -> waitAndObserve`, delayed transition observed
- subgoal 3: click succeeded
- model frozen/unchanged
- transient text redacted and absent from public result
- ordered execution / semantic goal checks / no literal replay all true
- errors empty, created tab closed

This is the first pristine fresh-unseen **long** browser-native mission proof for learned Strategy v0.3.3 with real recovery/replan. It is still controlled native evidence, not broad web autonomy proof.

Harbor is closed evidence.

Gate/CI:

- `a20b0395a6a2bf8590bb5431aa54a5b3891c2bb8` — Harbor gate
- `181f5cccc8b3b15a2cf01cc1e1a6a4ae5fb2219a` — Harbor contract
- `ba55e442a76370336d4c0b28acb898d700504a12` — CI
- full runtime-syntax `33092139022`: success
- dedicated mission-long-native `33092170119`: success

## Continuous learning target

Pipeline:

`new user interaction -> raw capture -> privacy/noise filter -> semantic episode candidate -> resolver -> human review/explicit digest approval -> approved dataset -> retrain -> fresh evaluation`

Required properties:

1. no `capture -> auto-train`
2. raw typed secrets/credentials/private values never enter Strategy/memory/training
3. capture mechanics such as focus/click/edit noise remain excluded unless semantically necessary
4. semantic candidate must distinguish WHAT from HOW before approval
5. human approval must be explicit and digest-bound before candidate promotion
6. approved episodes append/merge into a versioned dataset without moving old heldout evidence
7. retraining creates a new Strategy version; v0.3.3 remains a frozen comparison baseline
8. every new model must be evaluated on old regression gates plus new fresh-unseen families
9. recovery experience may be learned only from successful, privacy-safe episodes; no literal trajectory replay

## Incremental Strategy ingestion — REVIEW-ONLY PASS

Orchestrator:

`training-collector/tools/prepare_incremental_strategy_learning.js`

Version `0.1.0`.

Pipeline:

`new reviews/raw -> privacy batch -> incremental episode filter -> review pack -> triage -> review drafts -> teaching resolver -> approval candidate digest -> STOP`

Hard boundaries:

- digest integrity must verify
- candidate policy remains `autoTrainEligible:false`
- approval applicator, dataset builder, and fitter are forbidden from the orchestrator process
- output says `approvalApplied:false`, `datasetBuilt:false`, `trainingPerformed:false`
- previously approved IDs can be excluded before review pack creation
- duplicate current episode exports are deduplicated by semantic episode ID
- privacy-unsafe reviews remain blocked before candidate generation

CLI:

```text
node training-collector/tools/prepare_incremental_strategy_learning.js --reviews <review-dir> [--raw <raw-dir>] [--exclude-approved <approved-dir>] [--exclude-episodes <episode-id-file>] [--out <dir>]
```

Commits:

- `caff7ad78949bac6b9a81ddc603b52465f428a5f` — orchestrator
- `ae4dac8bac4742bd6ee6aeee7dea32ce5189f882` — boundary contract
- `fca2f20d49143deb44c7eb66b7490e5794559b84` — dedicated CI

Synthetic boundary proof:

- previously approved episode excluded
- duplicate current export deduplicated
- privacy-unsafe review blocked
- one genuinely new safe episode becomes exactly one digest candidate
- no approval receipt, approved annotation, dataset, or model created

CI:

- full runtime-syntax `33093032281`: success
- dedicated incremental-learning `33093059221`: success

## Incremental post-approval dataset merge — STABLE SPLITS PASS

Problem found during continuous-learning audit:

- the original batch builder orders all split groups by hash and then allocates a count of test/validation/train groups based on total group count
- adding new groups can therefore move the old train/validation/test boundaries even with the same seed
- that is acceptable for a one-time dataset build, but unsafe for longitudinal continuous learning because historical heldout evidence must remain fixed

New builder:

`training-collector/tools/build_incremental_strategy_dataset.js`

Version `0.1.0`.

Policy:

- load the existing assigned base dataset (`train.jsonl`, `validation.jsonl`, `test.jsonl`)
- only accept newly approved annotations through the existing explicit human-approval proof boundary
- never reassign any base episode
- if a new episode has a `splitGroup` already present in the base dataset, inherit that group's existing split
- if a group is completely new, assign it using an independent stable hash threshold with seed `strategy-episode-v0`
- independent threshold means appending future groups cannot move any already assigned group
- validate the combined assigned dataset and recompute training eligibility from split
- write a new versioned dataset package; never overwrite or mutate the frozen v0.3.3 dataset in place

Commits:

- `7f40dc6a0819c48c8ba035fb382da16a4d90dacc` — stable incremental dataset builder
- `ab2d2108086563de029908571972591e37f014da` — split-preservation contract
- `a5cc6adcc2986568cb7bdb5f1f59078aa76da41f` — incremental CI includes split preservation

Contract proves:

- existing train/validation/test episodes remain in their original split
- a new episode sharing an existing semantic splitGroup inherits that exact split
- a completely new group gets a deterministic independent split
- a second future append cannot move records from the first append or the original base
- duplicate episode IDs are rejected
- train records become training-eligible; validation/test records stay heldout/ineligible for fit

CI:

- full runtime-syntax on builder + contract `33093540067`: success
- dedicated `strategy-incremental-learning` `33093577877`: success
  - review-only incremental boundary PASS
  - stable split-preservation PASS
  - privacy-safe learning batch PASS
  - Strategy teaching resolver PASS
  - explicit approval/dataset boundary PASS

## Immediate next user phase — genuinely new demonstrations

Collector task-episode flow remains:

`enter task instruction -> Start Episode -> perform task -> Mark Success/Failed -> Stop Episode -> Export Task Episode for Review`

The export is named:

`training-collector-<episodeId>.task-episode-review.json`

Do not reuse the historical six tasks, Cargo, Signal Relay, or Harbor as new training data.

First real incremental batch should be small and privacy-safe. Produce new task-episode review exports, then run the review-only orchestrator and stop at the digest. Inspect candidate count, blocked count, unresolved count, semantic sequences and privacy invariants. Only after the user explicitly reviews and confirms the exact new digest may approval annotations be created.

After approval, use the incremental dataset builder so v0.3.3's existing heldout split assignments remain unchanged. Fit a new Strategy version only from the resulting train split; keep v0.3.3 as the frozen comparison baseline.

Never promote to `main` without explicit user approval after verified PASS.

## Training Collector cross-document episode continuity — CODE/CONTRACT PASS, MANUAL PENDING

During the first new Wikipedia demonstration, a full-page navigation destroyed the old content-script document before its delayed `TRANSITION_END` messages completed. The new document restored the active episode flag, but the background had no cross-document settlement step, leaving 18 transitions pending and correctly blocking `Mark Success` with `episode_success_has_pending_transition`.

Minimal fix in Training Collector `0.8.2`:

- the new top document sends a privacy-safe `EPISODE_DOCUMENT_READY` observation when it resumes an active episode
- background settles only pending transitions belonging to an older `pageInstanceId`, scoped to the original episode tab
- settled transitions carry explicit `documentChanged:true` and `settlementReason:next_document_ready` provenance
- the new document never settles its own in-flight transitions
- after the socket server confirms `session-closed` through the session's full event count, the closed session is removed from the in-memory waiting/status queue
- socket cleanup never deletes IndexedDB raw evidence or server-side `socket-data` files

Verification completed locally:

- `episode_cross_document_settlement_contract.js`: PASS
- `episode_capture_integration_contract.js`: PASS
- `episode_capture_gate_contract.js`: PASS
- `v08_socket_mirror_contract.js`: PASS
- `node --check` on `background.js` and `content.js`: PASS

Real Chrome navigation retest is still required after reloading Training Collector and reopening/refreshing the target tab. Do not treat this milestone as browser-native PASS yet.

## First incremental Batch 1–2 — CAPTURE VALID / RESOLUTION BLOCKED

Eight new successful review exports were collected and copied into `extension_agent-local-data/incremental-strategy-01`. Every file passes the task-episode review checker and privacy boundary (`selectorsExported:false`, `tabIdExported:false`, `rawActionCoordinatesExported:false`, zero forbidden fields).

The review-only orchestrator stopped safely with:

- source/retained/ready review files: 8 / 8 / 8
- candidate episodes: 0
- blocked episodes: 8
- unresolved human-review transitions: 226
- digest: `4895a7f4295e0e0ffe661dc6eb11157f7b7c7af43362a3f44fc49d03a4492bec`
- approval/dataset/training all remain false

Historical audit finding:

- per-key `text-key/type-char` Task Episode capture has existed since the initial semantic collector commit `7624157`; this is not a new `0.8.2` regression
- previous text episodes resolved because their task instructions explicitly declared the typed payload and submit mechanic (`nhập/gõ ... rồi nhấn Enter`)
- the newly proposed task wording used broad goals such as `Tìm bài viết ...`, which does not satisfy the privacy-safe declared-text resolver contract
- all eight new episodes are blocked, not only the earliest files
- click-only episodes have a small number of unresolved public-site targets with missing semantic labels; text/search episodes contribute most unresolved items because per-key mechanics cannot yet be safely collapsed from the broad task wording

Do not approve the zero-candidate digest. Preserve all eight reviews; diagnose/re-resolve from existing evidence before asking the user to recollect.

## Incremental reviews-v1 ingestion — REVIEW-ONLY PASS / ZERO CANDIDATES

Per explicit user instruction, `extension_agent-local-data/incremental-strategy-01/reviews-v1` was created with exactly these eight review exports:

- `ep-1787851260188`
- `ep-1787851293595`
- `ep-1787851361981`
- `ep-1787851404562`
- `ep-1787851520829`
- `ep-1787851685350`
- `ep-1787851750688`
- `ep-1787851808921`

`ep-1787850674536` remains excluded (failed, empty task, zero transitions, not Strategy-ready). `ep-1787850381182` remains outside the batch as the weaker duplicate task trace. Neither file was deleted.

The required review-only command was run into `strategy-learning-v01-a` and stopped at digest:

- input/retained/ready: 8 / 8 / 8
- excluded previously processed: 0
- duplicate current: 0
- candidate episodes: 0
- blocked episodes: 8
- resolver semantic actions: 0
- HOW/capture noise: 35
- unresolved human-review transitions: 226
- fully resolved episodes: 0
- digest: `0cc944cdbd619da32abd56591c9f795cfd2ac6809943c84e711ed4129ecaa549`

All eight inputs passed the privacy-safe review queue boundary. No raw session root was supplied. The orchestrator invariants remain:

- `approvalApplied:false`
- `datasetBuilt:false`
- `trainingPerformed:false`
- `autoTrainEligible:false`
- approval applicator/dataset builder/fitter not imported

The digest has zero eligible semantic candidates and must not be approved or applied. Mark Success is capture outcome evidence only, not semantic approval.

## Continuous-learning user interaction model — CODEX-CURATED

The user is not responsible for reading raw traces, JSON, transition metrics, semantic internals, dataset splits, or training statistics. Going forward:

- user creates demonstrations and later performs final Agent acceptance testing
- Codex owns privacy inspection, quality filtering, WHAT/HOW semantic curation, ACCEPT/REJECT/REDO decisions, candidate preparation, dataset/training/evaluation, and failure diagnosis
- user receives only concise ACCEPT/REJECT/REDO results and simple redo instructions
- the only mid-pipeline user action remains exact digest approval after Codex has produced a valid candidate bundle
- human digest approval remains mandatory; successful capture never auto-approves training data
- after approval, Codex runs approval application, stable incremental merge, train-only fit, technical evaluation, and prepares 3–5 fresh user acceptance tasks

Current eight-task Codex curation decision:

- ACCEPT: `ep-1787851293595` — search Wikipedia for Hệ Mặt Trời
- ACCEPT: `ep-1787851361981` — open CSS on MDN
- ACCEPT: `ep-1787851404562` — search DuckDuckGo for Linux information
- ACCEPT: `ep-1787851750688` — search for and open the official Python result
- ACCEPT: `ep-1787851808921` — search Wikipedia and switch the AI article to English
- REDO: `ep-1787851260188` — multiple unlabeled clicks prevent reliable identification of the intended Tiếng Việt click
- REDO: `ep-1787851520829` — captured path goes directly to Hà Nội and does not demonstrate the requested Việt Nam-then-Hà Nội sequence
- REDO: `ep-1787851685350` — capture proves opening HTML but not a distinct HTML elements action

No episode is REJECTed for privacy. Preserve all original evidence. Do not expose raw diagnostics to the user unless requested.
