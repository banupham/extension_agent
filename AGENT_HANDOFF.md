# Agent development handoff

Read this file before changing the repository.

## Working rules

- Active development branch: `feat/agent-tab-context`.
- Do **not** merge/promote to `main` without explicit user approval after verified PASS.
- Commit every meaningful development/diagnostic/test milestone to GitHub.
- Update this handoff after each milestone.
- User uses Windows CMD, not PowerShell.
- Keep technical explanation short; say whether agent is maturing / being taught and give next action.
- Strategy chooses WHAT. Behavior chooses HOW.
- Do not persist selectors, coordinates, tab IDs, raw CDP, credentials, secrets, passwords, typed sensitive values, or private reasoning in Strategy/memory/training.
- No literal trajectory replay.
- No generic `failure => scroll` behavior.
- Human demonstrations never auto-promote; exact digest confirmation is required before approval annotations are created.
- Do not change split policy, seed, ratios, or move heldout groups into TRAIN to force PASS.

## Agent maturity

- Behavior/HOW: learned from real human demonstrations and runtime-loadable.
- Strategy/WHAT: supervised and has its first human-approved, leakage-safe six-group dataset.
- Recovery/replan/semantic memory already exist.
- Dataset gate is `baselineReady:true`.
- Agent is maturing but not fully autonomous.
- Baseline v0.2.0 exposed action-sequence + target-grounding weaknesses.
- Baseline v0.3.0 fixed action-sequence transfer: validation and test both reached `actionTypeAccuracy=1`.
- Baseline v0.3.1 added generic editable-affordance gating, but the real six-group regression still fails exact target grounding.
- Current blocker is now narrowly identified as **choosing among multiple semantically editable candidates**, not action sequencing, collector, approval, dataset, or split policy.
- Immediate next step is a privacy-safe target-grounding diagnostic on the existing validation/test records. Do not change the model again before reading that output.

## Collector state — CLOSED

The prior `episode_success_has_pending_transition` bug was fixed by serialized episode-state mutation queue.

Message Composer proof exists:

- `training-collector-ep-1787831377719.task-episode-review.json`
- final outcome success
- `strategyReady:true`
- no pending transition
- Enter completed

Do **not** recollect Message Composer or the six-task set.

## Six teaching demonstrations

Local folder:

`%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827`

Episodes:

1. `ep-1787826569158` — Google -> Gmail click
2. `ep-1787826618214` — Google -> type OpenAI -> submit search
3. `ep-1787826766003` — Mission Atlas -> Mission Orion
4. `ep-1787828642619` — Topic Search -> type Atlas -> Enter
5. `ep-1787831377719` — Message Composer -> type Orion -> Enter
6. `ep-1787828809498` — Teaching Confirm click

Six semantic split groups:

1. `semantic-sequence:click:gmail`
2. `semantic-sequence:typeText:t-m-ki-m>submit:t-m-ki-m`
3. `semantic-sequence:click:mission-atlas>click:mission-orion`
4. `semantic-sequence:typeText:topic-search>submit:topic-search`
5. `semantic-sequence:click:teaching-confirm`
6. `semantic-sequence:typeText:message-composer>submit:message-composer`

One split group is one semantic-family leakage boundary. All records from one family stay in one split only.

## Resolver / teaching approval — PASS

Resolver version `0.3.0`.

Important commits:

- `673e3fbb5671dc24b993f342dd0a2f920b0434d9` — generic real editable text mechanics fix
- `91605b632f7ac8cb7634ce6d53e04754ead7eabd` — real-shape + negative-case contract

Real six-group resolver result:

- candidateEpisodeCount: 6
- blockedEpisodeCount: 0
- fullyResolvedEpisodeCount: 6
- Topic Search: `typeText -> submit`, progress `0.5 -> 1`
- Message Composer: `typeText -> submit`, progress `0.5 -> 1`
- focus/click/editing mechanics excluded as HOW noise
- later Message Send click excluded as redundant post-Enter HOW noise
- `autoTrainEligible:false`

Human-approved exact digest:

`8f18d4e5b053d9dae57107b4aa021dfbf46128df3c75b9c50dbad996346b8241`

User confirmation received:

`YES-I-REVIEWED-STRATEGY-APPROVAL-DIGEST`

Do not ask for this confirmation again.

## Approved dataset — PASS

Approval receipt:

- approvedEpisodeCount: 6
- approvedTransitionCount: 51
- approvedStrategyStepCount: 10
- excludedCaptureNoiseCount: 41
- blockedEpisodeCount: 0
- explicitHumanConfirmationVerified: true

Dataset/readiness:

- adaptedEpisodeCount: 6
- distinctSplitGroupCount: 6
- datasetBuilt: true
- splitCounts: train=4, validation=1, test=1
- baselineReady: true
- baselineReadinessErrors: []
- TRAIN actions: click=3, typeText=1, submit=1
- validation actions: typeText=1, submit=1
- test actions: typeText=1, submit=1
- unseen heldout action types: none
- lowGroupCoverage: none

Deterministic split with seed `strategy-episode-v0`:

- train: `semantic-sequence:click:gmail`
- train: `semantic-sequence:click:mission-atlas>click:mission-orion`
- train: `semantic-sequence:click:teaching-confirm`
- train: `semantic-sequence:typeText:message-composer>submit:message-composer`
- validation: `semantic-sequence:typeText:topic-search>submit:topic-search`
- test: `semantic-sequence:typeText:t-m-ki-m>submit:t-m-ki-m`

`baselineReady:true` means the data/split is valid for fitting. It does **not** mean broad Strategy generalization is established.

## Baseline v0.2.0 — genuine FAIL

User ran train-only fitting on HEAD `f0507cc`.

Result:

- validation actionTypeAccuracy=1, exactSemanticAccuracy=0
- test actionTypeAccuracy=0.5, exactSemanticAccuracy=0

Observed failures:

- Topic Search predicted correct `typeText -> submit`, wrong target `e3` instead of `e1`
- Google Search first action was `click` instead of `typeText`; target wrong

This exposed a real model weakness, not collector/split failure.

## Baseline v0.3.0 — action sequence fixed, target grounding FAIL

Important commits:

- `42fa9d70b2449fdbadbca0a7eb8493bb24c07e1d`
- `bfb274d199568d605af47c05a5702e3f8c1ef18f`
- `478d57511fa82a5992fe62721494c2a2c37481bd`
- `07cb9f362f78d1b5a6683c6bf2ef3c0b0cbe18fa`

Generic improvements included Unicode/Vietnamese tokenization, task semantic intent, learned target role/tag/editable traits, learned local target continuity, shared fitter/runtime decision engine, and evaluation history based on model predictions.

Real six-group v0.3.0 regression on HEAD `6a640f8`:

- validation: actionTypeAccuracy=1, targetRefAccuracy=0, exactSemanticAccuracy=0
- test: actionTypeAccuracy=1, targetRefAccuracy=0, exactSemanticAccuracy=0
- Topic Search: `typeText@e3 -> submit@e3`, expected e1
- Google Search: `typeText@e15 -> submit@e15`, expected e1

Interpretation: action sequence matured; remaining failure is target grounding. Wrong first target propagates via correct learned submit continuity.

## Baseline v0.3.1 — editable affordance gate, real regression still FAIL

Important commits:

- `539e1cfb6b76fd5da64e7322a531e5d7b7cf7646` — corrected generic editable-affordance provider
- `04359b288833e1cc046fd371b2ba083402086872` — model version 0.3.1
- `1b213f60da3537b55b6a95593345b32ace9f307e` — adversarial grounding contract
- `bda0010d42fca64a386b37fdec1782546394089b` — history contract alignment

Generic rule:

- `typeText`, `replaceText`, `clear` require an editable semantic target
- editable evidence: `editable=true`, role `textbox/searchbox/combobox`, or tag `input/textarea`
- button/link cannot win a text target only due to label overlap
- if no editable candidate exists, target chooser returns no target
- no site/ref hardcode

Repository CI for v0.3.1 implementation:

- strategy-offline-baseline run `33074632606`: success
- runtime-syntax run `33074632620`: success

User then ran the real six-group v0.3.1 regression on HEAD `105efb4`.

Observed result:

- modelVersion: `0.3.1`
- overall: FAIL
- validation actionTypeAccuracy=1, targetRefAccuracy=0, exactSemanticAccuracy=0
- test actionTypeAccuracy=1, targetRefAccuracy=0, exactSemanticAccuracy=0
- Topic Search remains `typeText@e3 -> submit@e3`, expected e1
- Google Search remains `typeText@e15 -> submit@e15`, expected e1

Important inference:

- v0.3.1 did not change the selected refs at all
- therefore e3/e15 are themselves passing the generic editable-affordance gate
- the problem is not simply editable-vs-button anymore; it is ranking among multiple editable candidates
- do not change weights blindly

## Observation schema evidence

Collector semantic observer `training-collector/observer/semantic_observer.js` exports each interactive element with:

- ref
- tag
- role
- redacted label
- editable
- enabled
- rendered
- inViewport
- interactable
- visible

The observation also contains `focusedElementRef`.

Runtime target registry similarly exposes tag/role/label/editable/enabled/visible.

This makes `focusedElementRef`, `inViewport`, and `interactable` plausible generic grounding signals, but do **not** add them to the model until the real diagnostic below confirms how e1/e3/e15 differ.

## Target grounding diagnostic — READY, CI PASS

New tool:

`training-collector/tools/diagnose_strategy_target_grounding.js`

Commits:

- `c23c9915a13659de32f28b8cbfec8d2c317bc1fd` — privacy-safe target grounding diagnostic
- `6575ab75e6bcf51935595a959d91e154ff54a865` — diagnostic privacy contract
- `5653c4a1a07a8b561776075c1659dfdd63bc34c7` — corrected privacy assertion contract

Final CI:

- strategy-offline-baseline run `33075367261`: completed success
- runtime-syntax run `33075367110`: completed success

Diagnostic version: `0.1.0`.

Default output only inspects `typeText` steps from validation/test and includes per candidate:

- ref
- expected/predicted/focused booleans
- tag/role/editable/enabled/visible/rendered/inViewport/interactable
- affordance eligibility
- label token count only (no raw label)
- task-label similarity
- prototype-label similarity
- trait score
- compatibility score

Privacy contract guarantees diagnostic output omits:

- raw labels
- typed values
- selectors
- coordinates
- tab IDs
- raw CDP

## Evaluation methodology

Topic Search and Google Search were originally valid heldout records. Their failures have now influenced generic model redesigns, so repeated runs are regression checks rather than pristine unseen proofs.

After this regression family eventually passes, use a fresh unseen family/native mission before claiming broader generalization.

Do not recollect/relabel the existing six to manufacture a new heldout claim.

## Immediate next step — run diagnostic only

Do **not** rerun collector, resolver, approval, dataset builder, or baseline fit yet.

Windows CMD:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD

set SIX=%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827

node training-collector\tools\diagnose_strategy_target_grounding.js "%SIX%\strategy-approved-dataset-v03\dataset"
```

Expected HEAD after this handoff commit will be newer than `5653c4a`.

When user sends diagnostic output:

1. compare expected e1 with predicted e3/e15 on each typeText step
2. inspect `isFocusedTarget`, `inViewport`, `interactable`, role/tag/editable, and similarity scores
3. identify the smallest generic semantic signal that distinguishes correct from wrong candidate
4. update fitter + runtime provider together
5. add generic positive + negative contract
6. require Strategy CI + runtime syntax PASS
7. rerun six-group regression only after the generic fix passes CI
8. do not alter split policy

Never promote to `main` without explicit user approval after verified PASS.
