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
- Do not recollect the six teaching tasks to force PASS.
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
- Current Strategy blocker is now **action selection stability across semantic target-grounding changes**.

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
- e1 had current-task similarity `0.2222`, TRAIN prototype-label similarity 0
- e3 had current-task similarity 0, TRAIN prototype-label similarity 1
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

Repository CI before real rerun:

- strategy-offline-baseline run `33076663823`: success
- runtime-syntax run `33076663685`: success

## v0.3.2 real six-group regression — FAIL, but validation target grounding FIXED

User ran v0.3.2 on the unchanged approved dataset.

Overall: FAIL.

Validation / Topic Search:

- total 2
- actionTypeAccuracy 1
- targetRefAccuracy 1
- exactSemanticAccuracy 1
- step 0 expected `typeText@e1`, predicted `typeText@e1`
- step 1 expected `submit@e1`, predicted `submit@e1`

This is the first full exact-semantic PASS for the prior Topic Search target-grounding failure. Preserve this fix.

Test / Google Search:

- total 2
- actionTypeAccuracy 0
- targetRefAccuracy 0
- exactSemanticAccuracy 0
- step 0 expected `typeText@e1`, predicted `click@e4`, score `0.4125`
- step 1 evaluation history therefore begins with predicted `click`
- step 1 expected `submit@e1`, predicted `click@e10`, score `0.2845`
- both predictions report `historyMatched:true`

Important interpretation:

- target-grounding work fixed validation exactly
- v0.3.2 introduced/exposed an action-selection regression on the Google test
- do **not** undo the target fix or alter split policy
- current provider action scoring mixes task/action evidence with `semanticTargetScore`; changing target-grounding semantics can therefore change action ranking
- this coupling is a plausible cause, but it is **not yet confirmed** from the real action candidate scores
- do not change action weights blindly

## Action-selection diagnostic — READY, CI PASS

New privacy-safe tool:

`training-collector/tools/diagnose_strategy_action_selection.js`

Commits:

- `24ed4361c0aa0c5f48077bf61a88ada7af4d921d` — action-selection diagnostic
- `4e95a3aace50f78a079ee228b5496b88797a71bd` — diagnostic privacy contract
- `00ebc762cfb47e91596f66b58d41f4bc4b5c9fca` — dedicated CI gate

CI:

- strategy-action-selection-diagnostic run `33077622407`: completed success

Diagnostic output intentionally omits raw instructions, raw labels, typed values, selectors, coordinates, tab IDs, and raw CDP.

For each validation/test step it reports:

- expected/predicted action type
- prior predicted action types
- current task semantic feature booleans
- history/composition match metadata
- per action candidate:
  - type
  - total score
  - instruction similarity
  - learned target-label similarity
  - task feature score
  - semantic target score
  - eligible target count
  - learned task-feature rates

Purpose: confirm whether `click` beats `typeText` because target compatibility is leaking too strongly into **action choice**, or whether another scoring component is responsible.

## Evaluation methodology

Topic Search and Google Search were originally legitimate heldout records, but their failures have now influenced generic redesigns. Repeated evaluation is therefore regression testing, not pristine unseen proof.

After regression passes, use a fresh unseen family/native mission before claiming broader Strategy generalization.

## Immediate next step — action diagnostic only

Do **not** rerun collector, resolver, approval, dataset builder, or baseline fit yet.

Windows CMD:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD

set SIX=%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827

node training-collector\tools\diagnose_strategy_action_selection.js "%SIX%\strategy-approved-dataset-v03\dataset"
```

When output arrives:

1. compare `click` vs `typeText` candidate score components at Google test step 0
2. compare predicted-history candidates at step 1
3. if target score is causing action flip, separate action-type selection from target grounding generically rather than hardcoding Google
4. preserve v0.3.2 validation grounding PASS
5. add generic positive/negative contract and require CI before rerunning regression
6. never move heldout or recollect to force PASS

Never promote to `main` without explicit user approval after verified PASS.
