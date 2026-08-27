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
- Do not change split seed/ratios or move heldout into TRAIN to force PASS.
- Do not recollect/relabel the six teaching tasks to force PASS or manufacture fresh heldout proof.
- No generic `failure => scroll`.
- Do not persist selectors, coordinates, tab IDs, raw CDP, credentials, passwords, secrets, typed sensitive values, or private reasoning in Strategy/recovery/memory/training.
- No literal trajectory replay.
- Human demonstrations never auto-promote; exact digest confirmation is required.

## Current agent maturity

- Behavior/HOW is learned from real human interaction and runtime-loadable.
- Strategy/WHAT is supervised and trained from the first human-approved leakage-safe six-group dataset.
- Recovery/replan/semantic memory already exist.
- Agent is maturing but is not fully autonomous.
- Collector/resolver/approval/dataset readiness are not current blockers.
- v0.3.3 passes the unchanged six-group regression exactly on validation and test.
- The six-group PASS is regression evidence, not pristine unseen proof, because earlier heldout failures influenced v0.3.x redesigns.
- The user's frozen v0.3.3 model also passed a **new fresh-unseen decision gate** on two families created after the model was frozen.
- Strategy model-file runtime loading is implemented with privacy validation.
- Native `typeText` now receives text through a **transient execution payload**; typed values are redacted from public episode result/history and are not stored in the Strategy model.
- Native `submit` routing and text-target acquisition are implemented and contract-tested.
- The user's first local browser-native run visibly opened the Cargo lab and typed into `Cargo Instruction`; the run then hung during local HTTP server cleanup after the lab tab closed. This is execution evidence, not a native PASS.
- Fresh native gate cleanup is now bounded and force-closes lingering localhost sockets after a deadline; dedicated contract and full runtime suite are PASS. The next gate is rerunning the same frozen model locally.

## Collector / teaching state — CLOSED

Prior collector bug `episode_success_has_pending_transition` was fixed by serialized episode-state mutation. Do not recollect the six teaching tasks.

Six fixed historical episodes:

1. `ep-1787826569158` — Google -> Gmail click
2. `ep-1787826618214` — Google -> type OpenAI -> submit search
3. `ep-1787826766003` — Mission Atlas -> Mission Orion
4. `ep-1787828642619` — Topic Search -> type Atlas -> Enter
5. `ep-1787831377719` — Message Composer -> type Orion -> Enter
6. `ep-1787828809498` — Teaching Confirm click

Six split groups:

1. `semantic-sequence:click:gmail`
2. `semantic-sequence:typeText:t-m-ki-m>submit:t-m-ki-m`
3. `semantic-sequence:click:mission-atlas>click:mission-orion`
4. `semantic-sequence:typeText:topic-search>submit:topic-search`
5. `semantic-sequence:click:teaching-confirm`
6. `semantic-sequence:typeText:message-composer>submit:message-composer`

A split group is a semantic-family leakage boundary; one group stays wholly in exactly one split.

## Resolver / explicit approval — PASS

Resolver version `0.3.0`.

Real six-group resolver result:

- candidateEpisodeCount 6
- blockedEpisodeCount 0
- fullyResolvedEpisodeCount 6
- Topic Search and Message Composer resolve to `typeText -> submit`
- edit/focus/click/key mechanics remain HOW/capture noise
- `autoTrainEligible:false`

Approved digest:

`8f18d4e5b053d9dae57107b4aa021dfbf46128df3c75b9c50dbad996346b8241`

Exact human confirmation already received:

`YES-I-REVIEWED-STRATEGY-APPROVAL-DIGEST 8f18d4e5b053d9dae57107b4aa021dfbf46128df3c75b9c50dbad996346b8241`

Do not ask user to reconfirm.

## Approved dataset/readiness — PASS

- approvedEpisodeCount 6
- approvedTransitionCount 51
- approvedStrategyStepCount 10
- excludedCaptureNoiseCount 41
- adaptedEpisodeCount 6
- distinctSplitGroupCount 6
- train 4 / validation 1 / test 1
- `baselineReady:true`
- readiness errors `[]`

Deterministic split seed `strategy-episode-v0`:

TRAIN:

- `semantic-sequence:click:gmail`
- `semantic-sequence:click:mission-atlas>click:mission-orion`
- `semantic-sequence:click:teaching-confirm`
- `semantic-sequence:typeText:message-composer>submit:message-composer`

VALIDATION:

- `semantic-sequence:typeText:topic-search>submit:topic-search`

TEST:

- `semantic-sequence:typeText:t-m-ki-m>submit:t-m-ki-m`

`baselineReady:true` proves data/split validity only, not broad generalization.

## Strategy baseline evolution

### v0.2.0 — genuine FAIL

- validation action type correct, target wrong
- test first action `click` instead of `typeText`; targets wrong

### v0.3.0 — action sequence fixed, target grounding FAIL

- validation actionTypeAccuracy 1, targetRefAccuracy 0
- test actionTypeAccuracy 1, targetRefAccuracy 0
- Topic Search selected e3 instead of e1
- Google Search selected e15 instead of e1

### v0.3.1 — editable affordance gate, still target FAIL

- actionTypeAccuracy remained 1
- target refs remained e3/e15
- proved both wrong refs passed the prior editable gate

### v0.3.2 — target grounding fixed, action selection regressed on Google

Privacy-safe target diagnostic established:

- Topic Search had two editable-looking candidates; TRAIN-local label memory incorrectly dominated current-task semantics.
- Google wrong controls included `input role=button editable=true`, exposing stale/over-broad editable semantics.
- Focus was absent and was explicitly **not** added as a rule.

Important v0.3.2 commits:

- `310321606a2c87e65e2b8c444e349f3028de3d59` — collector text-editable semantic classification
- `c1d2b1b75b5f6952004e23b13d0c3f8c375c8776` — current-task-dominant grounding + stale-role veto
- `0a85e5f1bdb653da9b52f2adce0d5a9da0b67192` — model v0.3.2
- `0271f8aff1bd59367f66127625a4253c81b4df52` — diagnostic transfer contract
- `b80e8f41fef9f43f4d3598a8456c9456e1b42674` — history alignment
- `e5d5229feb151f6e4df6eacfdfbb1de396baf8f0` — handoff milestone

Real v0.3.2 regression:

Validation Topic Search:

- actionTypeAccuracy 1
- targetRefAccuracy 1
- exactSemanticAccuracy 1
- exact sequence `typeText@e1 -> submit@e1`

Google test:

- actionTypeAccuracy 0
- targetRefAccuracy 0
- exactSemanticAccuracy 0
- first action expected `typeText@e1`, predicted `click@e4`
- predicted click history then caused step 1 to remain click

### Action-selection diagnostic — decisive

Real Google test step 0 candidate evidence:

`click`:

- score `0.4125`
- task feature score `0.444444...`
- current semantic target score `0.55`

`typeText`:

- score `0.396644...`
- task feature score `0.666666...`
- current semantic target score `0.195454...`

Conclusion: `typeText` had stronger task evidence; `click` won solely because current target-ranking evidence leaked too strongly into WHAT selection.

Diagnostic commits:

- `24ed4361c0aa0c5f48077bf61a88ada7af4d921d`
- `4e95a3aace50f78a079ee228b5496b88797a71bd`
- `00ebc762cfb47e91596f66b58d41f4bc4b5c9fca`

CI run `33077622407`: success.

## v0.3.3 — WHAT selection decoupled from current target ranking

Important commits:

- `4db6fd71f88de78943a52dd886146a2aacdb0208` — initial action/target decoupling
- `c72c8683a6bfc05348436f4fae9730735ec34e48` — generic decoupling contract
- `82225a43597ecf459b03135585a6ce0cd136e78b` — dedicated decoupling CI
- `07a99b51889a48598a398bc4d892c70a94d6546a` — block ungrounded text actions
- `14a75c87acc749b318198858b4d5083cdd11eaa3` — retain TRAIN lexical anchors while removing current target ranking from WHAT
- `ccc88d94377eb4b7e772eb8ff3191973f97e5752` — model v0.3.3 + metadata
- `2cb60b28eddb0aea271e2ee3be477c420cd4463d` — offline contract aligned
- `a542737d3e4152069a73d35d4fda3988d87e1c57` — history contract aligned
- `d073f5b1eab801cb5815458d350f9079c045b9a3` — pre-rerun milestone
- `eb388be5ab438a553a4e67e288d065753b48d306` — records real six-group PASS

Model metadata:

- `actionSelectionPolicy: task-history-decoupled-from-current-target-ranking`
- `actionSelectionUsesCurrentTargetRanking:false`
- `targetGroundingPolicy: current-task-dominant-with-action-affordance`

Important guards:

- TRAIN target labels remain a small static lexical anchor so categories such as play/mute do not collapse.
- After WHAT selection, target grounding uses current-task semantic evidence.
- If selected text action has no valid editable target, provider blocks with `offline_baseline_target_not_found` + `reobserve`; it does not act with null target and does not fall through to another action.

CI after v0.3.3 alignment:

- strategy-offline-baseline `33080180912`: success
- runtime-syntax `33080180866`: success
- dedicated action-target decoupling `33080054925`: success
- action diagnostic `33080054901`: success

## v0.3.3 real six-group regression — PASS

User reran the unchanged approved six-group dataset at local HEAD `d073f5b`.

Fitter:

- result `PASS`
- modelVersion `0.3.3`
- trainRecords 4
- validationRecords 1
- testRecords 1
- actionPrototypeCount 3
- historyPrototypeCount 4
- `trainOnly:true`
- `validationUsedForFit:false`
- `testUsedForFit:false`
- `evaluationHistoryUsesModelPredictions:true`

Validation / Topic Search:

- actionTypeAccuracy 1
- targetRefAccuracy 1
- exactSemanticAccuracy 1
- `typeText@e1 -> submit@e1`

Test / Google Search:

- actionTypeAccuracy 1
- targetRefAccuracy 1
- exactSemanticAccuracy 1
- `typeText@e1 -> submit@e1`

Interpretation:

- six-group regression gate is closed PASS
- do not keep tuning on these six records merely to accumulate PASSes
- this is regression evidence only because prior failures influenced redesign

## Real fresh-unseen frozen-model decision gate — PASS

User ran the frozen `baseline-v033/model.json` at local HEAD `15fcbb7` using:

`control-center/script/offline_strategy_fresh_unseen_decision_gate.js`

Result:

- `ok:true`
- `result:PASS`
- `modelVersion:0.3.3`
- `trainingOrFitPerformed:false`
- `modelMutatedInMemory:false`
- `modelFileMutated:false`
- `freshFamilyCount:2`
- model file SHA256 before/after identical: `75a21fd12e2db304769b38b3f7b137105ed1930bac6f5554142200f8ab6b0f30`

Fresh family 1 — `fresh-parcel-approval`:

- expected/actual sequence `click`
- expected/actual target `fresh-approve`
- `actionSelectionTargetIndependent:true`

Fresh family 2 — `fresh-dispatch-note`:

- expected/actual sequence `typeText -> submit`
- expected/actual target continuity `fresh-dispatch-note -> fresh-dispatch-note`
- `actionSelectionTargetIndependent:true`

Invariant PASS:

- frozen model only
- no fit path imported
- no literal trajectory replay
- no selector/coordinate targeting

Interpretation:

- this is the first controlled fresh-unseen semantic evidence for v0.3.3
- still not broad web autonomy proof
- do not fit on these fresh families now that they have become evaluation evidence

## Runtime Strategy model-file loading — IMPLEMENTED / CI PASS

New runtime loader mirrors the learned Behavior loader pattern:

- `control-center/manager/strategy/offline_model_loader.js`
- `control-center/manager/strategy/index.js` can create Strategy from a model file
- provider-object and model-file configuration are mutually exclusive
- loader validates artifact type and training metadata
- loader rejects forbidden/private persisted keys including selector/ref/coordinate/raw-CDP/secret/private-reasoning classes
- loader exposes only safe runtime metadata

Dedicated CI:

- strategy runtime model loading run `33083343691`: success

Do not bypass this loader by directly requiring arbitrary model JSON.

## Transient text execution + submit plumbing — IMPLEMENTED / CI PASS

The original blocker was that learned Strategy emitted semantic `typeText@target` with `args:{}` while CDP execution required `args.text`.

The runtime now keeps the boundary:

`Strategy WHAT + target -> transient execution payload resolver -> Behavior HOW -> native execution`

Key properties:

- Strategy model still does **not** persist typed values.
- `resolveTransientActionArgs` can supply text only at execution time.
- public step/history/decision/action/plan are redacted so the typed canary is not returned or persisted.
- raw text reaches only the internal CDP execution request.
- text actions require a targetRef.
- `typeText` acquires the semantic target before key insertion instead of assuming focus.
- `submit` is routed generically: editable target submits by Enter; submit button semantics can click.

Files added/updated include:

- `control-center/manager/agent/bounded_episode_loop.js`
- `control-center/manager/agent/one_action_bridge.js`
- `control-center/manager/execution/text_plan.js`
- `control-center/manager/execution/submit_plan.js`
- `control-center/manager/strategy/agent_action_contract.js`
- `training-collector/tests/strategy_transient_payload_execution_contract.js`

Dedicated transient payload CI:

- run `33084021426`: success

Full runtime suite after compatibility fixture alignment:

- runtime-syntax run `33084676420`: success

This work does not change model v0.3.3 scoring or retrain Strategy.

## Fresh browser-native text gate — READY FOR USER RERUN

Gate:

`control-center/script/offline_strategy_fresh_native_text_gate.js`

Controlled family created after the model was frozen:

- page family: `Cargo Routing Lab`
- instruction: type the provided value into `Cargo Instruction` and press Enter
- distractors: `Cargo Reference`, `Crew Note`, `Destination Memo`, `Route Cargo`
- expected semantic sequence: `typeText -> submit`
- expected target label continuity: `Cargo Instruction -> Cargo Instruction`
- success title: `CARGO INSTRUCTION PASS`

The gate:

- starts a local temporary HTTP lab server on a random localhost port
- discovers exactly one connected Agent Runtime extension through broker `/agents`
- uses an existing browser tab only as an anchor to open a new lab tab
- loads the user's frozen Strategy model from file through the runtime loader
- injects a random transient text value only at execution time
- runs the bounded episode loop on the new lab tab
- requires goal success and exact semantic sequence/target labels
- hashes model before/after and fails on mutation
- verifies no fitter path is imported
- verifies typed transient text does not appear in public result
- closes the created lab tab during cleanup and fails if cleanup does not succeed

Native gate contract history:

- initial CI `33085322784` failed only because the contract used an over-broad source substring assertion for the fitter name; runtime gate itself did not import the fitter.
- fix commit `53d98946acf2a6e6dec5d0b18b1fb7dea1cea5bd` changed the test to detect an actual `require(...)` import pattern.
- dedicated native contract run `33085920612`: success
- full runtime-syntax run `33085920613`: success

### First local browser-native attempt — execution reached target, cleanup hung

Observed locally by the user:

- gate opened the localhost Cargo Routing Lab from an `https://example.com` anchor tab
- Agent Runtime visibly selected `Cargo Instruction`
- native text insertion visibly began with the generated `cargo-...` value
- lab tab was later closed and browser returned to the anchor tab
- CMD did not return a JSON result, so this is **not** a native PASS

Diagnosis:

- `runGate()` had already entered `finally` because the created lab tab was closed
- `closeServer()` used an unbounded `await server.close(...)`
- a lingering Chrome localhost HTTP connection could keep that callback pending indefinitely

Generic cleanup fix:

- commit `13b96925ca927e3f496c71a7e36449352c07278a` — gate v0.1.1 tracks local sockets and bounds server shutdown to 1500ms; after deadline it closes idle/all connections and destroys tracked sockets
- commit `65ec3cfaa4d9e5c197ef8fbaee5892892efeb8a9` — contract simulates a server whose `close()` callback never fires and requires bounded forced cleanup
- dedicated native contract run `33087500659`: success
- full runtime-syntax job in run `33087500282`: success

This cleanup fix does not change model v0.3.3, Strategy scoring, target grounding, or transient typed data handling.

Current code HEAD before this handoff-only commit:

`65ec3cfaa4d9e5c197ef8fbaee5892892efeb8a9`

### User local rerun prerequisites

1. Stop the currently hung old gate with `Ctrl+C` if it is still running.
2. Pull the latest branch.
3. Keep Control Center running; reload the unpacked Agent Runtime extension only if needed after pulling extension-runtime changes (the cleanup fix itself is Node-side only).
4. Keep one normal `http(s)` web tab such as `https://example.com` open as the anchor.
5. Use the existing frozen model:
   `%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827\strategy-approved-dataset-v03\baseline-v033\model.json`

Native gate command from repo root:

```bat
set SIX=%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827
node control-center\script\offline_strategy_fresh_native_text_gate.js --model "%SIX%\strategy-approved-dataset-v03\baseline-v033\model.json"
```

Expected key PASS fields:

- `ok:true`
- `result:PASS`
- `modelVersion:0.3.3`
- `actualActionTypes:["typeText","submit"]`
- `actualTargetLabels:["Cargo Instruction","Cargo Instruction"]`
- final title `CARGO INSTRUCTION PASS`
- `frozenModelOnly:true`
- `modelLoadedFromFile:true`
- `modelFileMutated:false`
- `transientPayloadRedacted:true`
- `publicResultContainsTransientText:false`
- `createdTabClosed:true`

If local native gate FAILs, diagnose the exact execution/observation failure generically. Do not retrain on Cargo Routing Lab merely to force PASS.

## Evaluation methodology / next gates

- Six-group PASS = regression evidence only.
- Fresh decision PASS = first controlled unseen semantic evidence.
- Fresh browser-native run is the current end-to-end gate.
- If native browser PASSes, record exact PASS in this handoff.
- Then move to longer mission / multi-subgoal / replan / recovery / semantic-memory validation with new controlled/native families.
- Only after those gates should the project shift into the next continuous-learning phase where new user interaction becomes candidate data, passes privacy/noise curation and explicit approval, then feeds later retraining.
- Do not auto-train directly from raw user interaction.
- Never promote to `main` without explicit user approval after verified PASS.
