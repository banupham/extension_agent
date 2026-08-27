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

## Agent maturity

- Behavior/HOW is learned from real human interaction and runtime-loadable.
- Strategy/WHAT is supervised and has its first human-approved leakage-safe six-group dataset.
- Recovery/replan/semantic memory already exist.
- Agent is maturing but is not fully autonomous.
- Collector/resolver/approval/dataset readiness are not current blockers.
- v0.3.2 fixed the prior validation target-grounding failure exactly.
- v0.3.3 now decouples **WHAT action selection** from **current-observation target ranking**, while retaining learned TRAIN lexical anchors and the v0.3.2 target-grounding policy.
- Immediate next gate is the unchanged six-group v0.3.3 regression. This is regression evidence, not pristine unseen proof.

## Collector / teaching state — CLOSED

Prior collector bug `episode_success_has_pending_transition` was fixed by serialized episode-state mutation.

Do not recollect the six teaching tasks.

Six episodes:

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

A split group is a semantic-family leakage boundary. One group must stay wholly in exactly one split.

## Resolver / explicit approval — PASS

Resolver version: `0.3.0`.

Real six-group resolver result:

- candidateEpisodeCount 6
- blockedEpisodeCount 0
- fullyResolvedEpisodeCount 6
- Topic Search and Message Composer resolve to `typeText -> submit`
- edit/focus/click/key mechanics remain HOW/capture noise
- `autoTrainEligible:false`

Explicit human-approved digest:

`8f18d4e5b053d9dae57107b4aa021dfbf46128df3c75b9c50dbad996346b8241`

Exact confirmation phrase already received:

`YES-I-REVIEWED-STRATEGY-APPROVAL-DIGEST`

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

Deterministic split (`strategy-episode-v0`):

TRAIN:

- `semantic-sequence:click:gmail`
- `semantic-sequence:click:mission-atlas>click:mission-orion`
- `semantic-sequence:click:teaching-confirm`
- `semantic-sequence:typeText:message-composer>submit:message-composer`

VALIDATION:

- `semantic-sequence:typeText:topic-search>submit:topic-search`

TEST:

- `semantic-sequence:typeText:t-m-ki-m>submit:t-m-ki-m`

`baselineReady:true` only proves data/split validity. It does not prove broad generalization.

## Baseline evolution

### v0.2.0 — genuine FAIL

- validation action type correct, target wrong
- test first action `click` instead of `typeText`; targets wrong

### v0.3.0 — action sequence fixed, target grounding FAIL

- validation actionTypeAccuracy 1, targetRefAccuracy 0
- test actionTypeAccuracy 1, targetRefAccuracy 0
- Topic Search selected e3 instead of e1
- Google Search selected e15 instead of e1

### v0.3.1 — editable gate, real regression still FAIL

- actionTypeAccuracy stayed 1 in validation/test
- target refs remained e3/e15
- this proved e3/e15 passed the prior editable gate

## Real target-grounding diagnostic — PASS and informative

Privacy-safe diagnostic showed:

Topic Search:

- no `focusedElementRef`
- e1 and e3 both looked like available editable inputs
- e1 current-task similarity `0.2222`, TRAIN prototype-label similarity 0
- e3 current-task similarity 0, TRAIN prototype-label similarity 1
- e3 won because TRAIN-local target label memory dominated current-task semantics

Google Search:

- no `focusedElementRef`
- expected e1: textarea/combobox editable
- wrong e15/e151: `input role=button editable=true`
- collector had over-broad editable semantics for input/select controls

Therefore focus was explicitly **not** added as a rule.

## v0.3.2 — diagnostic-driven target grounding

Important commits:

- `310321606a2c87e65e2b8c444e349f3028de3d59` — collector text-editable semantic classification
- `c1d2b1b75b5f6952004e23b13d0c3f8c375c8776` — current-task-dominant target grounding + stale semantic-role veto
- `0a85e5f1bdb653da9b52f2adce0d5a9da0b67192` — model version `0.3.2`
- `0271f8aff1bd59367f66127625a4253c81b4df52` — diagnostic-derived generic transfer contract
- `b80e8f41fef9f43f4d3598a8456c9456e1b42674` — history contract alignment
- `e5d5229feb151f6e4df6eacfdfbb1de396baf8f0` — v0.3.2 handoff milestone

Generic v0.3.2 behavior:

- text actions reject semantic button/link/etc. roles even when stale snapshots say `editable:true`
- non-text input types are rejected when available
- old snapshots remain compatible
- among eligible text targets, current-task label semantics dominate
- TRAIN target labels and learned tag/role traits are supporting evidence
- no site/ref hardcode

## v0.3.2 real six-group regression — FAIL, but validation exact grounding PASS

User ran v0.3.2 on the unchanged approved dataset.

Validation / Topic Search:

- total 2
- actionTypeAccuracy 1
- targetRefAccuracy 1
- exactSemanticAccuracy 1
- `typeText@e1 -> submit@e1` exactly correct

Preserve this target-grounding fix.

Test / Google Search:

- total 2
- actionTypeAccuracy 0
- targetRefAccuracy 0
- exactSemanticAccuracy 0
- step 0 expected `typeText@e1`, predicted `click@e4`
- step 1 inherited predicted click history and predicted `click@e10` instead of `submit@e1`

This exposed an action-selection regression rather than a target-grounding failure.

## Real action-selection diagnostic — PASS and decisive

Privacy-safe action diagnostic was run on the same unchanged dataset at HEAD `c552c57`.

Google test step 0 task features:

- `textEntryIntent:true`
- `submitIntent:true`
- `enterIntent:false`
- `clickIntent:true`

History-eligible candidate comparison:

`click`:

- total score `0.4125`
- instruction similarity `0.166666...`
- learned target-label similarity `0`
- task feature score `0.444444...`
- semantic target score `0.55`
- eligibleTargetCount `72`

`typeText`:

- total score `0.396644...`
- instruction similarity `0.235294...`
- learned target-label similarity `0`
- task feature score `0.666666...`
- semantic target score `0.195454...`
- eligibleTargetCount `3`

Conclusion confirmed by real evidence:

- `typeText` had stronger task-level evidence
- `click` won only because its current-observation `semanticTargetScore` was much higher
- current target-ranking quality was improperly influencing **WHAT action selection**
- the wrong first click then constrained step 1 through autoregressive predicted history

This justified architectural decoupling rather than another target-weight tweak.

## v0.3.3 — WHAT selection decoupled from current target ranking

Provider/fitter/test commits:

- `4db6fd71f88de78943a52dd886146a2aacdb0208` — initial action/target decoupling
- `c72c8683a6bfc05348436f4fae9730735ec34e48` — generic action/target decoupling contract
- `82225a43597ecf459b03135585a6ce0cd136e78b` — dedicated decoupling CI gate
- `07a99b51889a48598a398bc4d892c70a94d6546a` — block ungrounded text actions explicitly
- `14a75c87acc749b318198858b4d5083cdd11eaa3` — refined action score preserving TRAIN lexical anchors
- `ccc88d94377eb4b7e772eb8ff3191973f97e5752` — model version `0.3.3` + model metadata
- `2cb60b28eddb0aea271e2ee3be477c420cd4463d` — offline contract aligned to v0.3.3
- `a542737d3e4152069a73d35d4fda3988d87e1c57` — history contract aligned to v0.3.3

Model metadata:

- `actionSelectionPolicy: task-history-decoupled-from-current-target-ranking`
- `actionSelectionUsesCurrentTargetRanking:false`
- `targetGroundingPolicy: current-task-dominant-with-action-affordance`

### v0.3.3 action score

Current-observation `semanticTargetScore` is still computed for diagnostics/grounding evidence but is **not** used to rank WHAT action.

Action score preserves the prior TRAIN-level evidence ratio and removes only the current-target term:

```text
score = (
  0.12 * instructionSimilarity +
  0.08 * learned TRAIN target-label similarity +
  0.45 * learned task-feature score
) / 0.65
```

Important distinction:

- learned TRAIN target labels remain a small static lexical anchor so semantic action categories such as play/mute are still distinguishable
- current observation target landscape cannot flip WHAT action
- after WHAT is selected, target grounding uses the existing v0.3.2 semantic policy
- if a selected text action has no valid editable target, provider blocks with `offline_baseline_target_not_found` and `reobserve`; it does not act with null target and does not fall through to a different action

### Contract findings during implementation

The new contract deliberately caught two issues before user rerun:

1. Initial provider could return `status:act` with `targetRef:null` for `typeText` because the generic action contract did not itself require a target for that action. Provider now explicitly blocks ungrounded text actions.
2. Removing all learned target-label evidence from action scoring caused `Play Media` to regress to `mute`, because current task-feature extraction has no media-specific feature. The refined policy therefore retains TRAIN lexical label anchors while still removing current-observation target ranking from WHAT selection.

These are generic architecture guards, not six-task/site hardcodes.

### CI — PASS

On provider architecture HEAD `14a75c87acc749b318198858b4d5083cdd11eaa3`:

- strategy-action-target-decoupling run `33079737881`: success
- strategy-action-selection-diagnostic run `33079737922`: success
- strategy-offline-baseline run `33079737926`: success
- runtime-syntax run `33079737904`: success

With v0.3.3 fitter/model metadata:

- dedicated action-target decoupling run `33080054925`: success
- action-selection diagnostic run `33080054901`: success

After all v0.3.3 contract expectations were aligned on HEAD `a542737d3e4152069a73d35d4fda3988d87e1c57`:

- strategy-offline-baseline run `33080180912`: success
- runtime-syntax run `33080180866`: success

## Evaluation methodology

Topic Search and Google Search were originally legitimate heldout records, but their failures have now influenced generic redesigns. Repeated evaluation is therefore regression testing, not pristine unseen proof.

If v0.3.3 regression passes, use a **fresh unseen controlled/native family or mission** before claiming broader Strategy generalization.

Do not recollect/relabel the six to manufacture a new heldout claim.

## Immediate next step — v0.3.3 unchanged six-group regression

Do **not** rerun collector, resolver, approval, or dataset builder.

Windows CMD:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD

set SIX=%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827

node training-collector\tools\fit_strategy_offline_baseline.js "%SIX%\strategy-approved-dataset-v03\dataset" --output "%SIX%\strategy-approved-dataset-v03\baseline-v033"

type "%SIX%\strategy-approved-dataset-v03\baseline-v033\evaluation.json"
```

Desired regression target, without forcing it:

- modelVersion `0.3.3`
- validation actionTypeAccuracy 1, targetRefAccuracy 1, exactSemanticAccuracy 1
- test actionTypeAccuracy 1, targetRefAccuracy 1, exactSemanticAccuracy 1

If PASS:

1. record exact regression PASS in this handoff
2. state explicitly that it is regression evidence, not fresh-unseen proof
3. next gate is a fresh unseen controlled/native family/mission
4. only after fresh unseen PASS inspect/integrate learned Strategy model loading beside learned Behavior for native long-mission validation

If FAIL:

1. inspect exact remaining action/target details
2. improve generic model only with evidence and contracts
3. do not alter split policy, weaken exact evaluation, or recollect the six

Never promote to `main` without explicit user approval after verified PASS.
