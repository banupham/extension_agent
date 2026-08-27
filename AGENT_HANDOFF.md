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
- Do not change split policy or move heldout groups into TRAIN to force evaluation PASS.

## Agent maturity

- Behavior/HOW: learned from real human demonstrations and runtime-loadable.
- Strategy/WHAT: supervised and has its first human-approved, leakage-safe six-group dataset.
- Agent is maturing but not fully autonomous.
- Recovery/replan/semantic memory already exist.
- Dataset gate is `baselineReady:true`.
- Baseline v0.2.0 exposed both action-sequence and target-grounding weaknesses.
- Baseline v0.3.0 fixed the action-sequence transfer: both validation and test reached actionTypeAccuracy=1.0, but target grounding still failed.
- Baseline v0.3.1 now adds generic action-aware editable affordance gating for text actions; repository Strategy contracts and runtime syntax CI pass.
- Immediate next gate: rerun the same six-group regression with v0.3.1. This remains a regression check, not pristine unseen proof.

## Collector state

The prior `episode_success_has_pending_transition` bug was fixed by serialized episode-state mutation queue.

Message Composer proof already exists:

- export: `training-collector-ep-1787831377719.task-episode-review.json`
- final outcome: success
- strategyReady: true
- no pending transition
- Enter is a completed transition

Do **not** recollect Message Composer or the six-task set.

## Six-demonstration teaching set

Local folder:

`%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827`

Episodes:

1. `ep-1787826569158` — Google -> Gmail click
2. `ep-1787826618214` — Google -> type OpenAI -> submit search
3. `ep-1787826766003` — Mission Atlas -> Mission Orion
4. `ep-1787828642619` — Topic Search -> type Atlas -> Enter
5. `ep-1787831377719` — Message Composer -> type Orion -> Enter
6. `ep-1787828809498` — Teaching Confirm click

Six distinct semantic split groups:

1. `semantic-sequence:click:gmail`
2. `semantic-sequence:typeText:t-m-ki-m>submit:t-m-ki-m`
3. `semantic-sequence:click:mission-atlas>click:mission-orion`
4. `semantic-sequence:typeText:topic-search>submit:topic-search`
5. `semantic-sequence:click:teaching-confirm`
6. `semantic-sequence:typeText:message-composer>submit:message-composer`

A split group is a leakage boundary for one semantic family. All records from one family remain in exactly one assigned split; the same split group must not appear in train/validation/test simultaneously.

## Resolver milestone — PASS

Important commits:

- `673e3fbb5671dc24b993f342dd0a2f920b0434d9` — generic real editable text mechanics fix
- `91605b632f7ac8cb7634ce6d53e04754ead7eabd` — real-shape + negative-case contract

Resolver version: `0.3.0`.

CI PASS:

- strategy teaching resolver workflow run `33071121431`: success
- runtime syntax workflow run `33071121512`: success

Real six-group validation:

- candidateEpisodeCount: 6
- blockedEpisodeCount: 0
- unresolvedHumanReviewCount: 0
- fullyResolvedEpisodeCount: 6
- Topic Search: `typeText -> submit`, progress `0.5 -> 1`
- Message Composer: `typeText -> submit`, progress `0.5 -> 1`
- edit/focus/click/text mechanics remain HOW/capture noise with provenance
- later Message Send click is excluded as redundant post-Enter HOW noise

## Human approval — CONFIRMED

Exact confirmed digest:

`8f18d4e5b053d9dae57107b4aa021dfbf46128df3c75b9c50dbad996346b8241`

Exact confirmation phrase received from user:

`YES-I-REVIEWED-STRATEGY-APPROVAL-DIGEST`

Do not ask the user to reconfirm this digest.

## Approved annotations + six-group dataset — PASS

Approval receipt:

- result: PASS
- approvalApplicatorVersion: `0.2.0`
- approvedEpisodeCount: 6
- approvedTransitionCount: 51
- approvedStrategyStepCount: 10
- excludedCaptureNoiseCount: 41
- blockedEpisodeCount: 0
- explicitHumanConfirmationVerified: true

Dataset builder/readiness:

- result: PASS
- approvedDatasetBuilderVersion: `0.1.0`
- adaptedEpisodeCount: 6
- distinctSplitGroupCount: 6
- datasetBuilt: true
- splitCounts: train=4, validation=1, test=1
- baselineReady: true
- baselineReadinessErrors: []
- TRAIN action coverage: click=3, typeText=1, submit=1
- validation action coverage: typeText=1, submit=1
- test action coverage: typeText=1, submit=1
- unseen heldout action types: none
- lowGroupCoverage: none

Actual deterministic split assignment with seed `strategy-episode-v0`:

- train: `semantic-sequence:click:gmail`
- train: `semantic-sequence:click:mission-atlas>click:mission-orion`
- train: `semantic-sequence:click:teaching-confirm`
- train: `semantic-sequence:typeText:message-composer>submit:message-composer`
- validation: `semantic-sequence:typeText:topic-search>submit:topic-search`
- test: `semantic-sequence:typeText:t-m-ki-m>submit:t-m-ki-m`

Important interpretation: `baselineReady:true` means data and leakage boundaries are valid for fitting. It does **not** establish broad Strategy generalization; only four records are in TRAIN and the semantic action space remains small.

## First real offline Strategy baseline v0.2.0 — genuine FAIL

User ran the train-only fitter on the six-group dataset at HEAD `f0507cc`.

Fit policy was correct:

- trainRecords: 4
- validationRecords: 1
- testRecords: 1
- validation/test were not used for fit

Observed result:

- overall: FAIL
- validation total=2, actionTypeAccuracy=1.0, exactSemanticAccuracy=0.0
- test total=2, actionTypeAccuracy=0.5, exactSemanticAccuracy=0.0

Failure details:

- Topic Search validation: correctly predicted `typeText -> submit`, but selected `e3` instead of expected `e1`.
- Google Search test: first step predicted `click` instead of `typeText`; submit type was correct; targets were wrong.

This was not a collector or split failure. It exposed weak action transfer and lexical target grounding.

## Strategy baseline v0.3.0 — action transfer fixed, target grounding still FAIL

Commits that introduced v0.3.0:

- `42fa9d70b2449fdbadbca0a7eb8493bb24c07e1d` — semantic target traits at runtime
- `bfb274d199568d605af47c05a5702e3f8c1ef18f` — fit semantic target-aware baseline
- `478d57511fa82a5992fe62721494c2a2c37481bd` — unseen editable transfer contract
- `07cb9f362f78d1b5a6683c6bf2ef3c0b0cbe18fa` — history baseline alignment

CI for v0.3.0:

- strategy-offline-baseline run `33073634874`: success
- runtime-syntax run `33073634892`: success

User reran the real six-group regression on HEAD `6a640f8`.

Observed v0.3.0 result:

- overall: FAIL
- modelVersion: `0.3.0`
- validation: actionTypeAccuracy=1.0, targetRefAccuracy=0.0, exactSemanticAccuracy=0.0
- test: actionTypeAccuracy=1.0, targetRefAccuracy=0.0, exactSemanticAccuracy=0.0
- evaluationHistoryUsesModelPredictions: true

Exact regression details:

- Topic Search step 0: expected `typeText@e1`, predicted `typeText@e3`
- Topic Search step 1: expected `submit@e1`, predicted `submit@e3`
- Google Search step 0: expected `typeText@e1`, predicted `typeText@e15`
- Google Search step 1: expected `submit@e1`, predicted `submit@e15`

Interpretation:

- Strategy action sequencing matured successfully from v0.2.0 to v0.3.0.
- The remaining failure is target grounding only.
- The first wrong `typeText` target propagates through learned submit target continuity.
- v0.3.0 treated editable/role/tag evidence as weighted evidence, allowing a non-editable high-label-overlap distractor to beat the editable field.

Do not weaken exact target evaluation to force PASS.

## Strategy baseline v0.3.1 — generic editable-affordance grounding, CI PASS

Important commits:

- `fe4dc1b0462108681710cb3fe5847e271e1e6967` — initial editable-affordance implementation; immediately superseded by validation correction
- `539e1cfb6b76fd5da64e7322a531e5d7b7cf7646` — corrected generic editable-affordance provider
- `04359b288833e1cc046fd371b2ba083402086872` — model version `0.3.1`
- `1b213f60da3537b55b6a95593345b32ace9f307e` — adversarial target-grounding contract
- `bda0010d42fca64a386b37fdec1782546394089b` — history contract alignment

Generic rule:

- `typeText`, `replaceText`, and `clear` require an editable semantic target.
- Editable evidence is generic: `editable=true`, role `textbox/searchbox/combobox`, or tag `input/textarea`.
- Non-editable button/link elements cannot win a text-target decision merely because their labels overlap the task strongly.
- Submit continuity remains learned from TRAIN and is unchanged; once the correct text field is grounded, later submit can reuse it when TRAIN continuity supports that.
- No e1/e3/e15, Google, Topic Search, Message Composer, site URL, selector, coordinates, tabId, or raw CDP is hardcoded.
- If no semantic editable candidate exists, the target chooser returns no target rather than selecting a non-editable distractor.

Adversarial contract proves:

- train on one editable form family
- evaluate a different field family
- a non-editable button whose label is the entire task sentence still cannot beat the editable field for `typeText`
- a button-only observation returns no `typeText` target
- sequential `typeText -> submit` target continuity still works
- model serialization still contains no heldout target refs/selectors/raw CDP/tabId

CI on HEAD `bda0010d42fca64a386b37fdec1782546394089b`:

- strategy-offline-baseline run `33074632606`: completed success
  - offline Strategy baseline contract: success
  - history-aware Strategy baseline contract: success
  - provider/runtime Strategy contracts: success
- runtime-syntax run `33074632620`: completed success

## Evaluation methodology

Topic Search validation and Google Search test were originally held out correctly and revealed real weaknesses. Their failures have since influenced generic redesigns.

Therefore:

- rerunning these same records with v0.3.1 is a required regression check
- a PASS is not pristine unseen generalization proof
- after regression PASS, use a fresh unseen controlled/native mission or fresh evaluation family before claiming broader Strategy generalization
- do not recollect or relabel the existing six merely to create an artificial new heldout claim

## Immediate next step — v0.3.1 six-group regression

Do not rerun collector, resolver, approval, or dataset builder.

Windows CMD:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD

set SIX=%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827

node training-collector\tools\fit_strategy_offline_baseline.js "%SIX%\strategy-approved-dataset-v03\dataset" --output "%SIX%\strategy-approved-dataset-v03\baseline-v031"

type "%SIX%\strategy-approved-dataset-v03\baseline-v031\evaluation.json"
```

Desired regression target, without forcing it:

- modelVersion: `0.3.1`
- result: PASS
- validation total=2, actionTypeAccuracy=1, targetRefAccuracy=1, exactSemanticAccuracy=1
- test total=2, actionTypeAccuracy=1, targetRefAccuracy=1, exactSemanticAccuracy=1

If v0.3.1 still fails target grounding, inspect the actual target result and improve the generic semantic grounding model; do not change split policy or recollect the six tasks.

If v0.3.1 regression passes, the next gate is a fresh unseen proof before claiming broader generalization, followed by learned Strategy + learned Behavior runtime integration, native long mission, multi-subgoal, replan, recovery, and semantic memory validation.

Never promote to `main` without explicit user approval after verified PASS.
