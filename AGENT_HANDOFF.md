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
- Signal Relay is regression evidence only because its first failure influenced diagnosis/page repair.
- A different **fresh Harbor Dispatch long browser-native family** is now implemented and CI-green; it is the immediate pristine user gate.
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

## Fresh Harbor Dispatch long browser-native gate — READY / PRISTINE

Gate:

`control-center/script/offline_strategy_fresh_long_harbor_gate.js`

This family was created only after the Signal Relay regression PASS and has not yet been run by the user or used to diagnose/tune Strategy/runtime.

Mission:

`type the provided value into Dispatch Token and press Enter, then click Open Berth Schedule, then click Confirm Berth`

Expected subgoals:

1. `typeText@Dispatch Token -> submit@Dispatch Token`
   - transient text execution-time only
   - privacy-safe observer may classify typeText as `no_effect`
   - progression guard must preserve base Strategy `submit`
   - native submit reveals `Open Berth Schedule`
2. `click@Open Berth Schedule -> waitAndObserve`
   - click schedules a 1200ms delayed transition with no immediate semantic mutation
   - first click must become real `no_effect`
   - base Strategy repeats same click/target, so recovery exploration may select `waitAndObserve`
   - wait reveals `Confirm Berth`
3. `click@Confirm Berth`
   - reveals final semantic element `Berth Confirmed`

Exact expected actions:

`[["typeText","submit"],["click","waitAndObserve"],["click"]]`

Exact expected targets:

`[["Dispatch Token","Dispatch Token"],["Open Berth Schedule",null],["Confirm Berth"]]`

Fresh gate invariants:

- `evidenceClass:fresh-unseen-controlled-native`
- frozen v0.3.3 loaded from file
- no fit module imported / model file unchanged
- exact action and target sequences
- all 3 subgoals goal-checked and done
- planned progression evidence on subgoal 1
- recovery evidence on subgoal 2
- transient text redacted / absent from public result
- ordered execution / no literal trajectory replay
- created tab cleanup

Commits:

- `a20b0395a6a2bf8590bb5431aa54a5b3891c2bb8` — fresh Harbor browser gate
- `181f5cccc8b3b15a2cf01cc1e1a6a4ae5fb2219a` — fresh Harbor contract
- `ba55e442a76370336d4c0b28acb898d700504a12` — mission CI gates Harbor

CI:

- full runtime-syntax on Harbor gate/contract commit `33092139022`: success
- dedicated mission-long-native `33092170119`: success
  - transient mission contract PASS
  - recovery progression guard PASS
  - Signal Relay regression contracts PASS
  - fresh Harbor contract PASS

Important: if the first real Harbor run fails and that failure influences a fix, Harbor loses pristine status. Do not tune model/dataset on it; create another fresh family later for pristine proof.

## Immediate user action

Keep Control Center running and one normal `http(s)` anchor tab such as `https://example.com` open.

Windows CMD:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD

set SIX=%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827
node control-center\script\offline_strategy_fresh_long_harbor_gate.js --model "%SIX%\strategy-approved-dataset-v03\baseline-v033\model.json"
```

Expected HEAD is this handoff commit.

Desired fresh PASS:

- `ok:true`
- `result:PASS`
- `gate:offline-strategy-fresh-long-harbor`
- `gateVersion:0.1.0`
- `evidenceClass:fresh-unseen-controlled-native`
- `missionReasonCode:mission_satisfied`
- exact actions/targets above
- all 3 subgoals done
- frozen model / privacy / recovery / progression / goal-check invariants true
- `errors:[]`
- `createdTabClosed:true`

## Continuous-learning phase after fresh Harbor proof

If Harbor passes pristine, shift emphasis from plumbing to approved new user data:

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
