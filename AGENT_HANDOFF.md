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
- Do not persist selectors, coordinates, tab IDs, raw CDP, credentials, passwords, secrets, typed sensitive values, or private reasoning in Strategy/recovery/memory/training.
- No literal trajectory replay.
- Human demonstrations never auto-promote; exact digest confirmation is required before approval is applied.

## Current maturity

- Behavior/HOW is learned from real human interaction and runtime-loadable.
- Strategy/WHAT is supervised and trained from the first human-approved leakage-safe six-group dataset.
- Recovery/replan/semantic memory already exist.
- Agent is maturing but is not fully autonomous.
- Collector/resolver/approval/dataset readiness are not blockers.
- Strategy v0.3.3 passes the unchanged six-group regression exactly on validation and test.
- The user's frozen v0.3.3 model passed two fresh-unseen semantic families created after the model was frozen.
- Strategy model-file runtime loading is implemented with privacy validation.
- Native `typeText` receives text only through a transient execution payload; typed values are redacted from public result/history and are not stored in Strategy.
- Real browser-native Cargo execution has already proven the exact Strategy sequence and exact target grounding: `typeText -> submit` on `Cargo Instruction -> Cargo Instruction`.
- Current blocker is execution plumbing for editable-target submit, not Strategy/model selection.

## Historical teaching data — CLOSED

Six fixed historical episodes:

1. `ep-1787826569158` — Google -> Gmail click
2. `ep-1787826618214` — Google -> type OpenAI -> submit search
3. `ep-1787826766003` — Mission Atlas -> Mission Orion
4. `ep-1787828642619` — Topic Search -> type Atlas -> Enter
5. `ep-1787831377719` — Message Composer -> type Orion -> Enter
6. `ep-1787828809498` — Teaching Confirm click

Approved digest:

`8f18d4e5b053d9dae57107b4aa021dfbf46128df3c75b9c50dbad996346b8241`

Human approval already received exactly. Do not ask again.

Dataset readiness:

- approvedEpisodeCount 6
- approvedStrategyStepCount 10
- excludedCaptureNoiseCount 41
- adaptedEpisodeCount 6
- distinctSplitGroupCount 6
- train 4 / validation 1 / test 1
- `baselineReady:true`
- heldout is never fit

Split:

TRAIN:
- click:gmail
- click:mission-atlas>click:mission-orion
- click:teaching-confirm
- typeText:message-composer>submit:message-composer

VALIDATION:
- typeText:topic-search>submit:topic-search

TEST:
- typeText:t-m-ki-m>submit:t-m-ki-m

Current six-group reruns are regression evidence, not pristine unseen proof, because earlier failures influenced v0.3.x redesigns.

## Strategy v0.3.3 state

v0.3.3 separates WHAT selection from current-target ranking:

- `actionSelectionPolicy: task-history-decoupled-from-current-target-ranking`
- `actionSelectionUsesCurrentTargetRanking:false`
- `targetGroundingPolicy: current-task-dominant-with-action-affordance`

Important commits:

- `14a75c87acc749b318198858b4d5083cdd11eaa3` — retain TRAIN lexical anchors while removing current target ranking from WHAT
- `ccc88d94377eb4b7e772eb8ff3191973f97e5752` — model v0.3.3
- `a542737d3e4152069a73d35d4fda3988d87e1c57` — final v0.3.3 contract alignment
- `eb388be5ab438a553a4e67e288d065753b48d306` — records real six-group regression PASS

Six-group real regression PASS:

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

## Real fresh-unseen semantic gate — PASS

Frozen `baseline-v033/model.json`, no fit/modification.

Fresh family 1 `fresh-parcel-approval`:
- expected/actual `click`
- target correct

Fresh family 2 `fresh-dispatch-note`:
- expected/actual `typeText -> submit`
- target continuity correct

Result/invariants:

- PASS
- `modelVersion:0.3.3`
- `trainingOrFitPerformed:false`
- `modelMutatedInMemory:false`
- `modelFileMutated:false`
- `freshFamilyCount:2`
- no literal trajectory replay
- no selector/coordinate targeting

This is controlled fresh-unseen semantic evidence, not broad web autonomy proof.

## Runtime Strategy loading + transient text execution — PASS contracts

Strategy file loader:

- `control-center/manager/strategy/offline_model_loader.js`
- runtime can create Strategy from frozen model file
- loader rejects forbidden/private persisted keys
- CI `33083343691`: success

Transient text bridge:

`Strategy WHAT + target -> transient execution payload -> Behavior HOW -> native execution`

Properties:

- typed text is execution-time only
- public step/history/decision/action/plan are redacted
- text actions require targetRef
- `typeText` acquires semantic target before inserting text
- submit button can click; editable submit uses Enter semantics

CI:

- transient payload `33084021426`: success
- full runtime suite after plumbing `33084676420`: success

## Fresh browser-native Cargo gate

Gate:

`control-center/script/offline_strategy_fresh_native_text_gate.js`

Controlled family:

- page: `Cargo Routing Lab`
- task: type provided transient value into `Cargo Instruction` and press Enter
- distractors: Cargo Reference, Crew Note, Destination Memo, Route Cargo
- expected sequence `typeText -> submit`
- expected target labels `Cargo Instruction -> Cargo Instruction`
- success title `CARGO INSTRUCTION PASS`

Gate invariants:

- frozen Strategy model loaded from file
- no fit path
- no selector targeting by Strategy
- transient text redacted from public output
- model hash unchanged
- created lab tab cleaned up

### Cleanup hang fix — PASS

First local attempt visibly typed into correct target but CMD hung after lab tab closed.

Cause: unbounded `server.close()` could wait on lingering Chrome localhost connection.

Fix:

- `13b96925ca927e3f496c71a7e36449352c07278a` — bounded/forced local server cleanup
- `65ec3cfaa4d9e5c197ef8fbaee5892892efeb8a9` — cleanup regression contract
- native cleanup CI `33087500659`: success
- full runtime-syntax `33087500282`: success

### Real browser-native rerun — Strategy/target PASS, goal FAIL

User reran gate v0.1.1 with frozen model v0.3.3.

Observed result:

- exact action sequence `typeText -> submit`
- exact target labels `Cargo Instruction -> Cargo Instruction`
- `modelLoadedFromFile:true`
- `modelFileMutated:false`
- transient payload redacted
- no selector targeting by Strategy
- `createdTabClosed:true`
- final title remained `Cargo Routing Lab`
- `final_goal_not_satisfied`
- `final_budget:budget_consecutive_failures_reached`

Interpretation:

- Strategy WHAT and target grounding are proven correct on this real native run.
- `typeText` executed visibly in the real browser.
- remaining failure is editable-target submit/Enter execution.

### Editable submit key semantics fix — PASS contracts

Diagnosis:

- generic `pressKey` emits `keyDown -> keyUp`
- editable submit had emitted `rawKeyDown -> keyUp`

Generic fix, no Strategy/model change:

- `85540fea4310e3e0626c33c49d77d94cbf93b2c1` — editable submit now emits semantic Enter `keyDown -> keyUp`; button submit remains click-only
- `f459566b45925f384b83baa0daee59a8a21b4323` — dedicated submit native key semantics contract
- `0d8aeeceeb72522b4a00b7342369eef664c16d67` — native workflow gates contract

CI:

- runtime-syntax `33088198806`: success
- transient payload execution `33088198866`: success
- dedicated fresh-native + submit semantics `33088244754`: success

### Real rerun after key semantics fix — compatibility FAIL

User pulled handoff HEAD `059087f` and reran the same frozen model.

Result failed immediately during CDP dispatch with:

`unsupported_cdp_plan_version`

Root cause:

- `submit_plan.js` used `SUBMIT_PLAN_VERSION = 0.2.0` as `cdpPlanVersion`
- Agent Runtime dispatcher accepts wire schemas only `0.1.0` through `0.1.3`
- module implementation version and CDP wire schema version had been conflated

This failure is execution compatibility only. It does not invalidate prior Strategy/target evidence and does not involve retraining.

Generic compatibility fix:

- `25e77d7a1a06903bb41257624093e08248270ca0` — separates `SUBMIT_PLAN_VERSION = 0.2.1` from `CDP_PLAN_VERSION = 0.1.2`; submit plans now emit supported wire schema `0.1.2`
- `083430d8546e0257591569c8bcc5d81334b9cb3a` — contract imports Agent Runtime `cdp_plan_dispatcher.js` and requires both editable/button submit plans to pass `Dispatcher.validatePlan()`

CI after compatibility fix:

- dedicated fresh-native/submit contract `33088623615`: success
- full runtime-syntax `33088623858`: success

Do not retrain on Cargo Routing Lab to force PASS.

## Immediate next user action

Pull latest branch and rerun the same frozen-model browser gate. Control Center should remain running and one normal `http(s)` anchor tab such as `https://example.com` should be open.

Windows CMD:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD

set SIX=%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827
node control-center\script\offline_strategy_fresh_native_text_gate.js --model "%SIX%\strategy-approved-dataset-v03\baseline-v033\model.json"
```

Expected HEAD is the handoff commit created after `083430d`.

Desired native PASS:

- `ok:true`
- `result:PASS`
- `modelVersion:0.3.3`
- `actualActionTypes:["typeText","submit"]`
- `actualTargetLabels:["Cargo Instruction","Cargo Instruction"]`
- `finalTitle:"CARGO INSTRUCTION PASS"`
- frozen model / redaction / no-selector invariants true
- `createdTabClosed:true`

If it still FAILs, preserve the proven Strategy/target correctness and diagnose execution/effect generically. Do not change the six split, retrain on Cargo, weaken the goal, or hardcode the lab.

## After native PASS

1. Record exact native PASS in this handoff and commit.
2. Stop optimizing on Cargo.
3. Move to a new longer controlled/native mission with multi-subgoal + observe-after + goal check + replan/recovery + semantic memory.
4. Only after those runtime gates shift emphasis to continuous learning:
   `new user interaction -> raw capture -> privacy/noise curation -> semantic candidate -> explicit approval -> dataset -> later retrain`.
5. Never auto-train directly from raw user interaction.
6. Never promote to `main` without explicit user approval after verified PASS.
