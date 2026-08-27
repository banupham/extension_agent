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
- Strategy/WHAT is supervised and has its first human-approved leakage-safe six-group dataset.
- Recovery/replan/semantic memory already exist.
- Agent is maturing but is not fully autonomous.
- Collector/resolver/approval/dataset readiness are not current blockers.
- v0.3.3 now passes the unchanged six-group regression exactly on both validation and test.
- That six-group PASS is regression evidence, **not pristine unseen proof**, because earlier heldout failures influenced v0.3.x redesigns.
- A new frozen-model fresh-unseen decision gate is implemented and CI-tested; the user's real v0.3.3 model has **not yet run it**.
- Native text execution has a separate known blocker: the learned offline provider currently emits `typeText` with `args:{}`, while CDP execution inserts only `mappedAction.args.text`. Do not claim native text-entry readiness until this semantic payload path is fixed and tested.

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

Resolver version: `0.3.0`.

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
- instruction similarity `0.166666...`
- TRAIN target-label similarity `0`
- task feature score `0.444444...`
- current semantic target score `0.55`
- eligible target count `72`

`typeText`:

- score `0.396644...`
- instruction similarity `0.235294...`
- TRAIN target-label similarity `0`
- task feature score `0.666666...`
- current semantic target score `0.195454...`
- eligible target count `3`

Conclusion: `typeText` had stronger task evidence; `click` won solely because current target-ranking evidence leaked too strongly into WHAT selection.

Diagnostic commits:

- `24ed4361c0aa0c5f48077bf61a88ada7af4d921d`
- `4e95a3aace50f78a079ee228b5496b88797a71bd`
- `00ebc762cfb47e91596f66b58d41f4bc4b5c9fca`

CI run `33077622407`: success.

## v0.3.3 — WHAT selection decoupled from current target ranking

Provider/fitter/test commits:

- `4db6fd71f88de78943a52dd886146a2aacdb0208` — initial action/target decoupling
- `c72c8683a6bfc05348436f4fae9730735ec34e48` — generic decoupling contract
- `82225a43597ecf459b03135585a6ce0cd136e78b` — dedicated decoupling CI
- `07a99b51889a48598a398bc4d892c70a94d6546a` — explicitly block ungrounded text actions
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

Action score:

```text
score = (
  0.12 * instructionSimilarity +
  0.08 * learned TRAIN target-label similarity +
  0.45 * learned task-feature score
) / 0.65
```

Current-observation `semanticTargetScore` remains available for diagnostics/grounding but is not used to rank WHAT action.

Important guards:

- TRAIN target labels remain a small static lexical anchor so categories such as play/mute do not collapse.
- After WHAT selection, target grounding uses the v0.3.2 current-task-dominant semantic policy.
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

Fit policy remained leakage-safe:

- `trainOnly:true`
- `validationUsedForFit:false`
- `testUsedForFit:false`
- `evaluationHistoryUsesModelPredictions:true`

Validation / Topic Search `human-ep-1787828642619`:

- actionTypeCorrect 2/2
- targetRefCorrect 2/2
- exactSemanticCorrect 2/2
- all accuracies `1`
- expected/predicted `typeText@e1 -> submit@e1`

Test / Google Search `human-ep-1787826618214`:

- actionTypeCorrect 2/2
- targetRefCorrect 2/2
- exactSemanticCorrect 2/2
- all accuracies `1`
- expected/predicted `typeText@e1 -> submit@e1`

Interpretation:

- v0.3.3 preserves the v0.3.2 target-grounding fix and removes the Google action-selection regression.
- The six-group regression gate is closed PASS.
- Do not keep tuning on these six records merely to accumulate PASSes.
- This is not pristine unseen evidence because prior validation/test failures influenced redesign.

## Runtime architecture inspection after six-group PASS

### Strategy factory

`control-center/manager/strategy/index.js`:

- `createStrategy()` accepts only provider `"baseline"` or an already-created provider object implementing `decide()`.
- `createOfflineBaselineProvider()` already exists and is exported.
- No Strategy model-file loader/path wiring exists yet.

### Offline Strategy provider

`control-center/manager/strategy/offline_baseline_provider.js`:

- `createOfflineBaselineProvider({ model, minimumConfidence })` requires a model object.
- It validates the model, chooses semantic action/target, and blocks ungrounded text actions.
- It performs no file I/O.

### Mission Strategy executor

`control-center/manager/mission/mission_strategy_executor.js`:

- accepts either `strategy` or per-subgoal `createStrategy`.
- Behavior baseline is independently resolved through `resolveBehaviorBaseline({ baseline, baselineFile })`.
- Strategy is passed separately to `executeBoundedEpisodeLoop`.
- This is already the correct Strategy WHAT / Behavior HOW separation.

### Learned Behavior loader pattern

`control-center/manager/behavior/baseline_loader.js` already provides the pattern Strategy should later mirror:

- isolated file I/O
- strong artifact validation
- forbidden/private-key boundary checks
- object-or-file resolution
- safe metadata describing what was loaded

Do not invent a parallel Strategy loading architecture; reuse this pattern after fresh unseen Strategy proof.

## Native text execution blocker discovered during runtime inspection

The learned offline Strategy provider currently constructs actions with:

```js
args: {}
```

including `typeText`.

`control-center/manager/execution/cdp_plan.js` executes `typeText` using only:

```js
mappedAction.args?.text
```

Therefore a semantically correct learned decision such as `typeText@field` currently produces an empty text insertion at native execution time.

This does **not** invalidate the Strategy semantic PASSes. It means native execution needs a separate generic semantic-payload bridge, likely from transient task/runtime args into the AgentAction, with privacy tests proving typed values are not persisted into Strategy model/recovery/memory/training.

Do not solve this by storing demonstrated typed values in the learned Strategy model.

## Fresh unseen frozen-model decision gate — READY, CI PASS

This gate was created **after** v0.3.3 and the six-group model were frozen. It does not fit or modify the model.

Files/commits:

- `70e3a5e398d8602f93a88853b56fbdb091642936` — `control-center/script/offline_strategy_fresh_unseen_decision_gate.js`
- `b46e423eb27166c702b17e76ef013bd18fe7349a` — fresh-unseen gate contract
- `3706f3abbe365d633ecc27a84f1ccedbcfd54a45` — dedicated CI workflow

Dedicated CI:

- strategy-fresh-unseen-decision run `33081805755`: success

The CI contract uses a separate synthetic model only to validate gate mechanics. It is **not** evidence that the user's real v0.3.3 model passes.

Fresh families in the gate:

1. `fresh-parcel-approval`
   - instruction: `Click Approve Parcel`
   - new button/field landscape
   - expected semantic action: `click` on the new `Approve Parcel` target
2. `fresh-dispatch-note`
   - instruction: `Type the requested parcel code into Dispatch Note and press Enter`
   - new textarea + competing editable field + button distractors
   - expected semantic sequence: `typeText -> submit`
   - expected target continuity: both actions on the new `Dispatch Note` target

The gate:

- loads an existing model file
- does not import or run the fitter
- checks the model object is unchanged in memory
- hashes the model file before/after and fails if it changes
- emits no selector/coordinate/raw-CDP targeting
- does not use or persist an actual typed value

## Evaluation methodology / current gate

Topic Search and Google Search were originally legitimate heldout records, but their failures influenced v0.3.x. Their current PASS is regression evidence only.

The next evidence must come from the new fresh-unseen gate using the user's already-fitted `baseline-v033/model.json` without refitting.

If that real frozen-model gate PASSes:

1. record the exact fresh-unseen PASS in this handoff
2. treat it as first controlled fresh-unseen semantic evidence, still not broad web autonomy
3. implement Strategy model-file loading by following the existing Behavior loader pattern
4. implement the transient semantic text payload bridge so `typeText` can execute real task text without persisting typed values in Strategy/memory/training
5. then run a fresh native browser execution gate
6. only after native PASS move to longer mission / multi-subgoal / replan / recovery / semantic memory validation

If the fresh-unseen decision gate FAILs, diagnose the exact new family generically; do not touch the six split, do not recollect, and do not fit on the fresh family merely to force PASS.

Never promote to `main` without explicit user approval after verified PASS.
