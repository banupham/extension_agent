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
- Recovery/replan/semantic memory already exist.
- Agent is maturing but is not fully autonomous.
- Collector/resolver/approval/dataset readiness are not blockers.
- Strategy v0.3.3 passes the unchanged six-group regression exactly on validation and test.
- Frozen v0.3.3 also passed two fresh-unseen semantic families created after model freeze.
- Strategy model-file runtime loading is implemented with privacy validation.
- Native `typeText` receives typed content only through transient execution payload; public result/history/Strategy model remain redacted.
- Real browser-native Cargo runs have repeatedly proven exact Strategy sequence and target grounding: `typeText -> submit` on `Cargo Instruction -> Cargo Instruction`.
- Current remaining gate is editable-target native submit/goal completion; this is execution plumbing, not Strategy selection.

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

Six-group reruns are regression evidence, not pristine unseen proof, because prior heldout failures influenced v0.3.x redesign.

## Strategy v0.3.3 — PASS regression

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

## Fresh-unseen frozen-model semantic gate — PASS

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

## Runtime loading / transient execution — PASS contracts

Runtime Strategy loader validates frozen model files and rejects forbidden/private persisted keys.

Execution boundary:

`Strategy WHAT + target -> transient execution payload -> Behavior HOW -> browser execution`

Properties:

- typed text is execution-time only
- public step/history/decision/action/plan are redacted
- text actions require targetRef
- `typeText` acquires semantic target before inserting text
- button submit remains click semantics
- editable submit uses native Enter semantics

Important CI:

- Strategy runtime model loading `33083343691`: success
- transient payload `33084021426`: success
- full runtime after plumbing `33084676420`: success

## Fresh browser-native Cargo gate

Gate:

`control-center/script/offline_strategy_fresh_native_text_gate.js`

Controlled family:

- page `Cargo Routing Lab`
- task: type transient value into `Cargo Instruction` and press Enter
- distractors: Cargo Reference, Crew Note, Destination Memo, Route Cargo
- expected semantic sequence `typeText -> submit`
- expected target continuity `Cargo Instruction -> Cargo Instruction`
- success title `CARGO INSTRUCTION PASS`

Gate invariants:

- frozen model loaded from file
- no fit path
- no selector targeting by Strategy
- transient text redacted
- model hash unchanged
- created tab cleanup required

### Native attempt history

1. First real run visibly typed into correct field, but CMD hung after cleanup.
   - root: unbounded `server.close()` waiting on Chrome localhost connection
   - fixed by bounded/forced cleanup commits `13b9692`, `65ec3cf`
   - CI `33087500659` and runtime `33087500282`: success

2. Next real run returned JSON:
   - exact actions `typeText -> submit`
   - exact targets `Cargo Instruction -> Cargo Instruction`
   - final title remained `Cargo Routing Lab`
   - `final_goal_not_satisfied`
   - `budget_consecutive_failures_reached`
   - proves Strategy/target correct; remaining issue was editable submit execution

3. Submit key path was changed from `rawKeyDown -> keyUp` to `keyDown -> keyUp`:
   - commit `85540fea4310e3e0626c33c49d77d94cbf93b2c1`
   - dedicated contract `f459566b45925f384b83baa0daee59a8a21b4323`
   - CI `33088244754`: success

4. A compatibility regression then exposed module-version/wire-version conflation:
   - local error `unsupported_cdp_plan_version`
   - fixed by separating submit implementation version from supported CDP wire schema
   - commit `25e77d7a1a06903bb41257624093e08248270ca0`
   - dispatcher-validation contract `083430d8546e0257591569c8bcc5d81334b9cb3a`
   - dedicated CI `33088623615`: success
   - full runtime `33088623858`: success

5. Latest real run after compatibility fix again reached exact Strategy actions/targets but goal still did not change title.
   - This preserves proof that model selection is correct.
   - Deeper diagnosis: CDP `keyDown` supports generated `text/unmodifiedText`; Enter keyboard mapping uses carriage return `\r`.
   - editable-submit key event was missing this payload.

Latest generic execution fix, without Strategy/model change:

- `e7c6215962d588b31f4b1eca93ab72e67bff6a7f` — submit plan v0.2.2 sends Enter `keyDown` with `text:"\r"` and `unmodifiedText:"\r"`, followed by `keyUp`; button submit remains click-only; CDP wire version remains supported `0.1.2`
- `f983621a6c7d64505b08ad3f01bdc1bf6a05f5b8` — contract requires exact Enter payload and dispatcher compatibility
- dedicated fresh-native/submit contract run `33089075418`: success
- full runtime-syntax run `33089075384`: success

Do not retrain on Cargo Routing Lab to force PASS.

## Immediate next user action

Pull latest branch and rerun the same frozen-model browser gate once. Keep Control Center running and one normal `http(s)` anchor tab such as `https://example.com` open.

Windows CMD:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD

set SIX=%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827
node control-center\script\offline_strategy_fresh_native_text_gate.js --model "%SIX%\strategy-approved-dataset-v03\baseline-v033\model.json"
```

Expected HEAD is this handoff commit.

Desired native PASS:

- `ok:true`
- `result:PASS`
- `modelVersion:0.3.3`
- `actualActionTypes:["typeText","submit"]`
- `actualTargetLabels:["Cargo Instruction","Cargo Instruction"]`
- `finalTitle:"CARGO INSTRUCTION PASS"`
- frozen model/redaction/no-selector invariants true
- `createdTabClosed:true`

If it still FAILs, preserve proven Strategy/target correctness and diagnose execution/effect generically. Do not change six split, retrain on Cargo, weaken goal, or hardcode lab.

## Next phase: make the agent smarter

After native PASS, stop optimizing on Cargo and move to learning-capability gates.

### A. Fresh long controlled/native mission

Create a new family after Cargo with multiple subgoals and dynamic observations, using already-known action types but new semantic composition. The mission should require:

- observe -> choose next semantic action
- execute -> observe-after
- intermediate goal/progress check
- change plan based on new state
- at least one recoverable failure or alternate state
- recovery/replan without generic `failure => scroll`
- semantic memory useful across subgoals

Do not fit on this fresh evaluation family.

### B. Continuous-learning loop from new user interaction

Once runtime long-mission behavior is stable, shift emphasis from hand-written plumbing to new data:

`new user interaction -> raw capture -> privacy/noise filter -> semantic episode candidate -> resolver -> human review/explicit digest approval -> approved dataset -> retrain -> fresh evaluation`

Rules:

- raw interaction never auto-trains directly
- typed secrets/credentials/private values stay out of Strategy/memory/training
- clicks/focus/edit mechanics remain HOW/capture noise unless semantically necessary
- no literal trajectory replay
- new evaluation families stay held out and are never moved into TRAIN just to pass

The goal is that increasing semantic diversity in approved user demonstrations, not site-specific rules, becomes the main source of additional capability.

### C. Strategy next model

After enough new approved groups exist, fit a new Strategy version using the expanded train split while preserving validation/test family boundaries. Compare against v0.3.3 on:

- action type accuracy
- target grounding
- exact semantic sequence
- long-mission completion
- recovery quality
- fresh-unseen family performance

Do not promote to `main` without explicit user approval after verified PASS.
