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
- Mission/replan/recovery/world-model infrastructure exists and is integrated with the learned Strategy.
- Real Signal Relay long-mission run proved recovery and multi-subgoal orchestration partly work, and exposed a controlled-lab form-design defect at subgoal 2.
- Signal Relay form semantics are now repaired and CI-green; the next real run is regression/runtime validation only.
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

Six-group reruns are regression evidence, not pristine unseen proof, because prior failures influenced v0.3.x redesign.

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

## Runtime loading / transient execution

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

- Strategy model loading `33083343691`: success
- transient payload `33084021426`: success
- full runtime after plumbing `33084676420`: success

## Fresh browser-native Cargo family — PASS / CLOSED

Gate:

`control-center/script/offline_strategy_fresh_native_text_gate.js`

Real local PASS at HEAD `bcec745` with frozen v0.3.3:

- `ok:true`, `result:PASS`
- exact actions `typeText -> submit`
- exact targets `Cargo Instruction -> Cargo Instruction`
- final title `CARGO INSTRUCTION PASS`
- model loaded from file and unchanged
- transient text redacted and absent from public result
- no selector targeting by Strategy
- no literal trajectory replay
- created tab closed

Cargo is now closed evaluation evidence. Do not keep optimizing or training on Cargo.

## Mission stack upgrades

### Transient payload and step hooks

- `4cec004bd51a01185f59e2b16f4f56f2252e45d6` — mission executor passes `resolveTransientActionArgs` + `onStep` to each subgoal episode and verifies cross-subgoal redaction
- `32f6df2540f3e946491118f0c116669813ebf5d1` — mission transient payload contract
- `6e2eab02a70c6e42ff4257fc7ac8de427461422c` — dedicated mission workflow

### Recovery planned-progression guard

Problem:

- privacy-safe observation does not persist typed values
- successful `typeText` can therefore look like semantic `no_effect`
- old recovery could hijack a correct `typeText -> submit` sequence

Generic fix:

- ask base Strategy for planned next semantic decision before recovery
- if action type changes, preserve planned progression
- if same action type but semantic target label changes, preserve planned progression
- recovery explores only when base repeats the same failed action/semantic target or otherwise does not progress
- no generic `failure => scroll` rule

Commits:

- `cc7acf88e2a559c9229c366a8c208cf4118ee587` — recovery exploration v0.5.0 progression guard
- `f42a1f38f719c6c7c509b0f2aabf633f0a6dd5b4` — progression guard contract
- `8324b0dfde0a66ba2c23d73c63cce4d91b203240` — mission CI includes recovery contract

## Signal Relay long browser-native family — REGRESSION AFTER DIAGNOSIS

Gate:

`control-center/script/offline_strategy_fresh_long_mission_gate.js`

Mission:

`Click Open Relay Console, then type the provided value into Relay Note and press Enter, then click Finalize Relay`

Expected:

1. `click@Open Relay Console -> waitAndObserve`
2. `typeText@Relay Note -> submit@Relay Note`
3. `click@Finalize Relay`

Initial gate commits:

- `7260930f1278ec814faf1d8fc67f8d4bd564c05e` — browser-native long mission gate
- `90ec4cb3fd084967cc1c6d6f99468ba6b4fbe79e` — gate contract

Initial CI:

- dedicated mission run `33090453237`: success
- full runtime run `33090453289`: success

### First real user run

Real browser run returned FAIL:

- `missionReasonCode:subgoal_failed`
- progress `1/3`
- model version `0.3.3`
- frozen model invariant true
- model file unchanged
- transient payload redacted
- no literal trajectory replay
- created tab closed

Subgoal 1 — **PASS and useful recovery evidence**:

- action 0 `click@Open Relay Console`
- control `failed`, reason `action_no_observable_effect`
- effect `no_effect`; only incidental `focus_changed`
- recovery action `waitAndObserve`
- recovery source `recoveryExploration`
- after wait: `elements_added/elements_removed`
- subgoal goal satisfied

This proves the generic recovery loop can observe a real no-effect state, choose a bounded semantic recovery action, reobserve, and complete the subgoal.

Subgoal 2 — **Strategy/progression PASS, page submit FAIL**:

- step 0 `typeText@Relay Note`
- transient text was applied and redacted; user visibly saw text in the correct field
- privacy-safe effect observer called it `no_effect`, as expected
- step 1 base Strategy correctly progressed to `submit@Relay Note`
- `recoveryDeferredForBaseProgression:true` proves the progression guard worked
- submit produced `no_effect`, no DOM/state change
- recovery then explored `waitAndObserve`, `scrollVertical`, `scrollHorizontal`, `scrollIntoView`
- none could satisfy the goal; episode ended `budget_max_steps_reached`

### Root cause

The controlled Signal Relay page had a test-design defect, not a learned-Strategy failure:

- `relayForm` contained two text `<input>` controls (`Relay Note`, `Operator Memo`)
- its only button inside the form was `type="button"` (`Review Template`)
- there was no submit control
- page progression to stage 3 occurred only inside `relayForm.addEventListener('submit', ...)`
- pressing Enter in `Relay Note` therefore did not produce the form submit event in the real browser

Do **not** change Strategy v0.3.3, its weights, dataset, or heldout split because of this failure.

Do **not** treat the recovery scroll attempts as evidence for adding a generic failure-to-scroll rule; they were bounded exploration after a genuine no-effect submit.

Signal Relay is no longer pristine unseen evidence because this failure influenced diagnosis. It may be rerun only as regression/runtime validation. A different fresh family is required later for pristine long-mission generalization evidence.

### Form semantics repair — CI PASS, real regression pending

Generic controlled-page repair:

- added a real default `type="submit"` control inside `relayForm`
- submit control is hidden/aria-hidden/non-tabbable so it supplies native implicit Enter-submit semantics without becoming a visible Strategy target
- did **not** add a target-specific `keydown` handler
- did **not** use `requestSubmit()` or direct `.submit()` bypasses
- gate version is now `0.1.1`
- result explicitly reports `evidenceClass:"regression-after-diagnosis"`
- mission metadata no longer claims `frozenEvaluationFamily:true`

Commits:

- `972b78c5d4ea20b0477f2910e7a1b2f5a2d5c83e` — repair Signal Relay form semantics and mark regression evidence
- `3cba592894bc7b4e6373a36c570499eee0230e99` — align gate contract with regression evidence class
- `9c2f94bf47afb963b337091edd08dd99d315bb3f` — Enter-submit semantics contract requiring a native submit control and forbidding keydown/requestSubmit/direct-submit hacks
- `5edd70c875339ba2e64da0cbf9681199371ae3e1` — mission workflow gates the new form semantics contract

CI:

- full runtime-syntax for the form repair commit `33091479720`: success
- dedicated mission-long-native final run `33091577192`: success
  - mission transient payload contract PASS
  - recovery progression guard contract PASS
  - Signal Relay Enter-submit semantics contract PASS
  - Signal Relay regression gate contract PASS

## Immediate next user action

Rerun Signal Relay once with the frozen v0.3.3 model. This run is **regression/runtime validation**, not fresh-unseen evidence.

Windows CMD:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD

set SIX=%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827
node control-center\script\offline_strategy_fresh_long_mission_gate.js --model "%SIX%\strategy-approved-dataset-v03\baseline-v033\model.json"
```

Expected HEAD is this handoff commit.

Desired regression result:

- `ok:true`
- `result:PASS`
- `gateVersion:0.1.1`
- `evidenceClass:regression-after-diagnosis`
- `missionReasonCode:mission_satisfied`
- actions exactly `[["click","waitAndObserve"],["typeText","submit"],["click"]]`
- targets exactly `[["Open Relay Console",null],["Relay Note","Relay Note"],["Finalize Relay"]]`
- all 3 subgoals done
- model frozen/unchanged
- transient text redacted
- created tab closed

If this regression passes, create a different fresh long native family for pristine multi-subgoal/recovery evidence before making broader generalization claims.

## Continuous-learning phase

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
