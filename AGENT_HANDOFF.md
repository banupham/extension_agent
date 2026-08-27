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
- Recovery/replan/semantic world-model infrastructure exists and is now being integrated with the frozen learned Strategy.
- Collector/resolver/approval/dataset readiness are not blockers.
- Strategy v0.3.3 passes the unchanged six-group regression exactly on validation and test.
- Frozen v0.3.3 passed two fresh-unseen semantic decision families created after model freeze.
- Frozen v0.3.3 passed a real browser-native end-to-end Cargo family with learned Strategy + Behavior + goal checking + privacy redaction.
- Cargo is closed as evaluation evidence. Do not tune/train on Cargo merely to accumulate PASSes.
- A fresh long browser-native mission gate is now implemented and CI-green. It is the immediate user gate.
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

Latest real local PASS at HEAD `bcec745` with frozen `baseline-v033/model.json`:

- `ok:true`
- `result:PASS`
- gateVersion `0.1.1`
- modelVersion `0.3.3`
- expected/actual `typeText -> submit`
- expected/actual `Cargo Instruction -> Cargo Instruction`
- finalTitle `CARGO INSTRUCTION PASS`
- transient payload applied only to `typeText`, redacted
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

- first real controlled fresh browser-native end-to-end PASS for learned Strategy v0.3.3
- Strategy WHAT, target grounding, learned Behavior execution, observe-after, goal checking, privacy boundary, frozen model loading, and cleanup all completed in one real Chrome run
- stronger than offline decision evidence, but still not broad web autonomy proof
- stop optimizing on Cargo

## Mission stack upgrade for long missions

### Transient payload + step hooks

`mission_strategy_executor.js` now passes execution-time transient args and step hooks into each bounded subgoal episode.

Commits:

- `4cec004bd51a01185f59e2b16f4f56f2252e45d6` — mission executor v0.4.0 passes `resolveTransientActionArgs` + `onStep` with mission/subgoal context and checks cross-subgoal transient redaction
- `32f6df2540f3e946491118f0c116669813ebf5d1` — mission transient payload contract
- `6e2eab02a70c6e42ff4257fc7ac8de427461422c` — dedicated `mission-long-native` CI workflow

This preserves the same privacy boundary as one-action execution: typed values can reach raw browser execution but do not persist in public mission result/history.

### Recovery planned-progression guard

Problem found before running the long mission:

- privacy-safe observations intentionally do not persist typed input values
- therefore a successful `typeText` can look like semantic `no_effect`
- old recovery exploration would treat any failed/no-effect step as a recovery trigger before asking whether base Strategy was deliberately progressing to the next semantic action
- that could hijack a correct learned `typeText -> submit` sequence with `wait/scroll`

Generic fix:

- recovery first asks base Strategy for the next semantic decision
- if base Strategy changes action type, recovery defers because this is planned semantic progression
- if action type is the same but target label changes, recovery also defers because this can be a legitimate multi-target sequence
- recovery exploration proceeds when base Strategy repeats the same failed action/semantic target or is otherwise not progressing
- no generic `failure => scroll` rule was added

Commits:

- `cc7acf88e2a559c9229c366a8c208cf4118ee587` — recovery exploration v0.5.0 planned-progression guard
- `f42a1f38f719c6c7c509b0f2aabf633f0a6dd5b4` — contract proves:
  - failed `typeText` + base `submit` => keep `submit`
  - failed click + same click/target => permit recovery `waitAndObserve`
  - failed click + different semantic target => keep planned click progression
- `8324b0dfde0a66ba2c23d73c63cce4d91b203240` — mission CI gates the recovery contract

## Fresh long browser-native mission — READY

Gate:

`control-center/script/offline_strategy_fresh_long_mission_gate.js`

Family created after the frozen model and after Cargo was closed:

`Signal Relay Lab`

Natural-language mission:

`Click Open Relay Console, then type the provided value into Relay Note and press Enter, then click Finalize Relay`

The mission planner splits this into three ordered subgoals.

Expected subgoal 1:

- Strategy: `click` target `Open Relay Console`
- page intentionally schedules the real transition 1200ms later with no immediate DOM mutation
- normal click settle should observe `no_effect`
- base Strategy would repeat the same click/target
- recovery exploration should choose `waitAndObserve`
- delayed state then reveals `Relay Note`
- subgoal semantic goal becomes satisfied

Expected subgoal 2:

- `typeText@Relay Note -> submit@Relay Note`
- typed value injected only through transient mission payload
- typeText may appear `no_effect` under privacy-safe observation
- base Strategy progresses to `submit`, so recovery progression guard must defer recovery
- submit reveals `Finalize Relay`

Expected subgoal 3:

- `click@Finalize Relay`
- reveals semantic element `Relay Complete`
- mission becomes fully satisfied

Exact expected action sequences:

1. `click -> waitAndObserve`
2. `typeText -> submit`
3. `click`

Exact expected target-label sequences:

1. `Open Relay Console -> null`
2. `Relay Note -> Relay Note`
3. `Finalize Relay`

The gate requires:

- all 3 subgoals done in order
- each subgoal ended through actual goal checking
- subgoal 1 first click produced real `no_effect`/failed control state
- subgoal 1 recovery came from `recoveryExploration` and used `waitAndObserve`
- subgoal 2 preserved `typeText -> submit` and recorded `recoveryDeferredForBaseProgression:true`
- transient text remained redacted
- frozen model loaded from file and hash unchanged
- no fit module imported
- no literal trajectory replay
- created lab tab cleaned up

Gate / contract commits:

- `7260930f1278ec814faf1d8fc67f8d4bd564c05e` — fresh long browser-native gate
- `90ec4cb3fd084967cc1c6d6f99468ba6b4fbe79e` — long mission gate contract with negative checks for missing recovery/progression guard/model mutation

CI on `90ec4cb`:

- dedicated `mission-long-native` run `33090453237`: success
  - mission transient payload contract PASS
  - recovery planned progression guard contract PASS
  - fresh long mission gate contract PASS
- full `runtime-syntax` run `33090453289`: success

This is the immediate fresh runtime evaluation. Do not fit on Signal Relay Lab if it fails; diagnose generic architecture and later use a new fresh family for pristine evidence.

## Immediate user action

Keep Control Center running, keep one normal `http(s)` anchor tab such as `https://example.com` open, and use the same frozen v0.3.3 model.

Windows CMD:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD

set SIX=%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827
node control-center\script\offline_strategy_fresh_long_mission_gate.js --model "%SIX%\strategy-approved-dataset-v03\baseline-v033\model.json"
```

Expected HEAD is this handoff commit.

Desired key PASS fields:

- `ok:true`
- `result:PASS`
- `gate:offline-strategy-fresh-long-mission`
- `modelVersion:0.3.3`
- `missionReasonCode:mission_satisfied`
- actual subgoal actions exactly `[["click","waitAndObserve"],["typeText","submit"],["click"]]`
- actual target labels exactly `[["Open Relay Console",null],["Relay Note","Relay Note"],["Finalize Relay"]]`
- all three subgoals status `done`
- recovery evidence on subgoal 1
- `recoveryDeferredForBaseProgression:true` on subgoal 2 submit decision
- frozen model / redaction / ordered execution / goal-check invariants true
- `errors:[]`
- `createdTabClosed:true`

## Continuous-learning phase after long-mission runtime is stable

Once this class of long mission is stable, shift the main source of additional capability from hand-written plumbing to approved user data:

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
