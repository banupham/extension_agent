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
- Signal Relay long browser-native regression now passes all 3 subgoals with real recovery, progression guard, goal checks, privacy redaction, and frozen model invariants.
- Signal Relay is regression evidence only because its first failure influenced diagnosis and page repair.
- Next capability gate is a **different fresh long browser-native family** created after the Signal Relay regression PASS.
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

Real six-group regression:

- validation Topic Search: action/target/exact semantic all 1.0
- test Google Search: action/target/exact semantic all 1.0

Do not keep tuning on these six records.

## Fresh-unseen frozen-model semantic gate — PASS

Frozen `baseline-v033/model.json`, no fit/mutation:

- `fresh-parcel-approval`: click + correct target
- `fresh-dispatch-note`: `typeText -> submit` + target continuity
- no literal trajectory replay
- no selector/coordinate targeting

## Browser-native Cargo — PASS / CLOSED

Real local PASS with frozen v0.3.3:

- exact `typeText -> submit`
- exact `Cargo Instruction -> Cargo Instruction`
- final title `CARGO INSTRUCTION PASS`
- model file unchanged
- transient text redacted
- no selector targeting by Strategy
- no literal trajectory replay
- created tab closed

Cargo is closed evaluation evidence. Do not optimize/train on it.

## Mission stack upgrades

### Transient payload + step hooks

- `4cec004bd51a01185f59e2b16f4f56f2252e45d6` — mission executor passes `resolveTransientActionArgs` + `onStep` into each subgoal and checks cross-subgoal redaction
- `32f6df2540f3e946491118f0c116669813ebf5d1` — contract
- `6e2eab02a70c6e42ff4257fc7ac8de427461422c` — mission CI

### Recovery planned-progression guard

Generic rule:

- ask base Strategy for its planned next semantic decision before recovery
- if action type changes, preserve planned progression
- if same action type but semantic target changes, preserve planned progression
- recovery explores only when base repeats the same failed action/semantic target or otherwise does not progress
- no generic `failure => scroll`

Commits:

- `cc7acf88e2a559c9229c366a8c208cf4118ee587` — recovery exploration v0.5.0
- `f42a1f38f719c6c7c509b0f2aabf633f0a6dd5b4` — progression guard contract

## Signal Relay long browser-native — REGRESSION PASS / CLOSED

Gate:

`control-center/script/offline_strategy_fresh_long_mission_gate.js`

Mission:

`Click Open Relay Console, then type the provided value into Relay Note and press Enter, then click Finalize Relay`

First real run exposed a controlled-page defect: the form had two text inputs but no submit control, while page progression depended on the form `submit` event. Strategy/model were not changed.

Repair:

- real hidden native `type="submit"` control added to the form
- no keydown handler, `requestSubmit()`, or direct `.submit()` bypass
- gate version `0.1.1`
- evidence class `regression-after-diagnosis`

Repair commits:

- `972b78c5d4ea20b0477f2910e7a1b2f5a2d5c83e`
- `3cba592894bc7b4e6373a36c570499eee0230e99`
- `9c2f94bf47afb963b337091edd08dd99d315bb3f`
- `5edd70c875339ba2e64da0cbf9681199371ae3e1`

CI:

- full runtime `33091479720`: success
- dedicated mission `33091577192`: success

### Real browser regression PASS

User ran frozen v0.3.3 and received:

- `ok:true`
- `result:PASS`
- `gateVersion:0.1.1`
- `evidenceClass:regression-after-diagnosis`
- `missionReasonCode:mission_satisfied`
- progress `3/3`, `missionDone:true`
- exact actions:
  1. `click -> waitAndObserve`
  2. `typeText -> submit`
  3. `click`
- exact targets:
  1. `Open Relay Console -> null`
  2. `Relay Note -> Relay Note`
  3. `Finalize Relay`
- subgoal 1: click produced `no_effect`; recovery `waitAndObserve` came from `recoveryExploration`, observed elements added/removed, then goal satisfied
- subgoal 2: `typeText` transient payload applied/redacted; base Strategy progressed to `submit` with `recoveryDeferredForBaseProgression:true`; submit produced target disappearance + elements added/removed and goal satisfied
- subgoal 3: `click@Finalize Relay` produced target disappearance + elements added/removed and goal satisfied
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

Interpretation:

- long mission orchestration, real recovery, planned progression, transient text privacy, observe-after, semantic goal checking, and multi-subgoal execution are now proven together in a real Chrome regression run
- because Signal Relay was repaired after its first failure, it is **not** pristine fresh-unseen evidence
- stop optimizing Signal Relay now

## Immediate next development — fresh long family

Create a different family after this regression PASS. Requirements:

1. not Cargo/Signal Relay/Google/Topic/Message relabel
2. frozen v0.3.3; no fit/mutation
3. multiple ordered subgoals
4. use supported learned actions first (`click`, `typeText`, `submit`)
5. at least one real recoverable delayed/no-effect transition
6. preserve planned `typeText -> submit` progression under privacy-safe observation
7. semantic goals after each subgoal
8. typed payload transient and redacted
9. exact action/target sequences required for PASS
10. if this new family fails and influences fixes, retire it from pristine status and create another new family later

Only after a pristine fresh long family PASS should broader multi-subgoal generalization be claimed.

## Continuous-learning phase after fresh long runtime proof

Target pipeline:

`new user interaction -> raw capture -> privacy/noise filter -> semantic episode candidate -> resolver -> human review/explicit digest approval -> approved dataset -> retrain -> fresh evaluation`

Rules:

- raw interaction never auto-trains directly
- typed secrets/credentials/private values stay out of Strategy/memory/training
- click/focus/edit mechanics remain HOW/capture noise unless semantically necessary
- no literal trajectory replay
- fresh evaluation families stay held out and are never moved into TRAIN merely to pass
- human approval remains explicit before promotion

After enough new approved semantic groups exist, fit the next Strategy version and compare against v0.3.3 on action type, target grounding, exact semantic sequence, long-mission completion, recovery quality, and new fresh-unseen families.

Never promote to `main` without explicit user approval after verified PASS.
