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
- Do not change split seed/ratios or move heldout into TRAIN to force PASS.
- Do not recollect/relabel the six historical teaching tasks to force PASS.
- Do not persist selectors, coordinates, tab IDs, raw CDP, credentials/passwords/secrets, typed sensitive values, or private reasoning in Strategy/recovery/memory/training.
- No literal trajectory replay.
- Human demonstrations never auto-promote; exact digest confirmation is required before approval is applied.

## Current maturity

- Behavior/HOW is learned from real human interaction and runtime-loadable.
- Strategy/WHAT is supervised and trained from the first human-approved leakage-safe six-group dataset.
- Recovery/replan/semantic world-model infrastructure already exists.
- Collector/resolver/approval/dataset readiness are not blockers.
- Strategy v0.3.3 passes the unchanged six-group regression exactly on validation and test.
- Frozen v0.3.3 passed two fresh-unseen semantic decision families created after model freeze.
- **Frozen v0.3.3 now also passes a real browser-native end-to-end fresh family**: Strategy chose `typeText -> submit`, grounded `Cargo Instruction -> Cargo Instruction`, Behavior executed the actions in Chrome, the page reached the semantic goal, model hash stayed unchanged, and transient typed text stayed redacted.
- Cargo is now closed as an evaluation family. Do not tune/train on Cargo merely to accumulate PASSes.
- Next capability gate is a fresh long controlled/native mission with multiple subgoals, dynamic observations, goal checks, replan/recovery, and semantic state carry-over.
- Agent is maturing but is not yet broadly autonomous.

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

Dataset state:

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

Six-group reruns are regression evidence, not pristine unseen proof, because prior heldout failures influenced v0.3.x redesign.

## Strategy v0.3.3 — regression PASS

Policy:

- `actionSelectionPolicy: task-history-decoupled-from-current-target-ranking`
- `actionSelectionUsesCurrentTargetRanking:false`
- `targetGroundingPolicy: current-task-dominant-with-action-affordance`

Real unchanged six-group rerun:

Validation Topic Search:
- actionTypeAccuracy 1
- targetRefAccuracy 1
- exactSemanticAccuracy 1
- `typeText@e1 -> submit@e1`

Test Google Search:
- actionTypeAccuracy 1
- targetRefAccuracy 1
- exactSemanticAccuracy 1
- `typeText@e1 -> submit@e1`

Do not keep tuning on these six records.

## Fresh-unseen frozen-model semantic decision gate — PASS

Frozen `baseline-v033/model.json`, no fit or mutation.

Fresh families created after model freeze:

- `fresh-parcel-approval`: expected/actual `click`, target correct
- `fresh-dispatch-note`: expected/actual `typeText -> submit`, target continuity correct

Invariants:

- `modelVersion:0.3.3`
- `trainingOrFitPerformed:false`
- `modelMutatedInMemory:false`
- `modelFileMutated:false`
- no selector/coordinate targeting
- no literal trajectory replay

This is controlled fresh-unseen semantic evidence, not broad web autonomy proof.

## Runtime loading / transient execution

Runtime Strategy loader validates frozen model files and rejects forbidden/private persisted keys.

Execution boundary:

`Strategy WHAT + target -> transient execution payload -> Behavior HOW -> browser execution`

Properties:

- typed text is execution-time only
- public step/history/decision/action/plan are redacted
- text actions require targetRef
- `typeText` acquires semantic target before inserting text
- button submit uses click semantics
- editable submit uses native Enter semantics

Important CI:

- Strategy runtime model loading `33083343691`: success
- transient payload `33084021426`: success
- full runtime after plumbing `33084676420`: success

## Fresh browser-native Cargo family — PASS / CLOSED

Gate:

`control-center/script/offline_strategy_fresh_native_text_gate.js`

Fresh controlled family:

- page `Cargo Routing Lab`
- task: type a transient value into `Cargo Instruction` and press Enter
- distractors: Cargo Reference, Crew Note, Destination Memo, Route Cargo
- expected semantic sequence `typeText -> submit`
- expected target continuity `Cargo Instruction -> Cargo Instruction`
- success title `CARGO INSTRUCTION PASS`

Execution fixes found while making the generic runtime work:

1. bounded local HTTP cleanup (`13b9692`, `65ec3cf`)
2. editable submit changed from `rawKeyDown -> keyUp` to semantic `keyDown -> keyUp` (`85540fe`)
3. submit implementation version separated from supported CDP wire schema (`25e77d7`, `083430d`)
4. Enter `keyDown` now carries `text:"\r"` and `unmodifiedText:"\r"` while button submit remains click-only (`e7c6215`, `f983621`)

Latest execution CI before local PASS:

- dedicated fresh-native/submit contract `33089075418`: success
- full runtime-syntax `33089075384`: success

### Real local browser-native PASS

User ran at local HEAD `bcec745` with frozen `baseline-v033/model.json`.

Exact result:

- `ok:true`
- `result:PASS`
- gate `offline-strategy-fresh-native-text`
- gateVersion `0.1.1`
- modelVersion `0.3.3`
- expected/actual action types: `typeText -> submit`
- expected/actual target labels: `Cargo Instruction -> Cargo Instruction`
- finalTitle `CARGO INSTRUCTION PASS`
- step 0 confidence `0.4712550607287449`, `prototypeSource:historyPrototypes`, `historyMatched:true`, `actionSelectionTargetIndependent:true`
- step 1 same confidence/source/history properties
- transient payload applied only to `typeText`, redacted, key list `["text"]`
- submit received no text payload
- `frozenModelOnly:true`
- `modelLoadedFromFile:true`
- `modelFileMutated:false`
- `noLiteralTrajectoryReplay:true`
- `noSelectorTargetingByStrategy:true`
- `transientPayloadRedacted:true`
- `publicResultContainsTransientText:false`
- `errors:[]`
- `createdTabClosed:true`

Interpretation:

- this is the first real controlled fresh browser-native end-to-end PASS for the learned Strategy model
- Strategy WHAT, target grounding, learned Behavior execution, observe-after, goal checking, privacy boundary, frozen model loading, and cleanup all completed in one real Chrome run
- this is stronger evidence than the offline fresh decision gate, but it is still a controlled family and not broad web autonomy proof
- **stop optimizing on Cargo now**; it has become evaluation evidence

## Next capability gate — fresh long mission

Use the existing mission stack rather than adding site-specific rules:

- `control-center/manager/mission/mission_plan.js`
- `control-center/manager/mission/mission_executor.js`
- `control-center/manager/mission/mission_strategy_executor.js`
- `control-center/manager/agent/bounded_episode_loop.js`
- semantic goal/world-model infrastructure

The new family must be created after the frozen model and must not be a trivial Cargo/Google/Topic/Message relabel.

Required properties:

1. multiple ordered subgoals
2. page/UI state changes after subgoal completion
3. observe-after before choosing the next action
4. intermediate semantic progress checks
5. at least one recoverable alternate/failure state
6. Strategy must replan from semantic history/effect evidence; no generic `failure => scroll`
7. semantic state carry-over must be useful across subgoals without persisting observation-local refs, selectors, coordinates, tab IDs, typed secrets, or private reasoning
8. use already-supported action families first (`click`, `typeText`, `submit`) so the gate tests composition/replanning rather than unseen action-type coverage
9. frozen v0.3.3 stays frozen during this evaluation family
10. exact mission completion + recovery evidence required for PASS

Do not fit on this long-mission family after failures; if architecture defects are found, fix them generically and later use a new fresh family for pristine evidence.

## Continuous-learning phase after long-mission runtime is stable

Shift the main source of additional capability from hand-written plumbing to approved user data:

`new user interaction -> raw capture -> privacy/noise filter -> semantic episode candidate -> resolver -> human review/explicit digest approval -> approved dataset -> retrain -> fresh evaluation`

Rules:

- raw interaction never auto-trains directly
- typed secrets/credentials/private values stay out of Strategy/memory/training
- click/focus/edit mechanics remain HOW/capture noise unless semantically necessary
- no literal trajectory replay
- new evaluation families stay held out and are never moved into TRAIN just to pass
- human approval remains explicit before candidate data is promoted

After enough new approved semantic groups exist, fit a new Strategy version using the expanded train split and compare it against v0.3.3 on action type, target grounding, exact semantic sequence, long-mission completion, recovery quality, and fresh-unseen families.

Never promote to `main` without explicit user approval after verified PASS.
