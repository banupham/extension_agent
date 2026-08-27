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
- Do not recollect the six teaching tasks to make regression pass.

## Agent maturity

- Behavior/HOW: learned from real human demonstrations and runtime-loadable.
- Strategy/WHAT: supervised and has its first human-approved, leakage-safe six-group dataset.
- Recovery/replan/semantic memory already exist.
- Dataset gate is `baselineReady:true`.
- Agent is maturing but not fully autonomous.
- Baseline v0.2.0 exposed action-sequence + target-grounding weaknesses.
- Baseline v0.3.0 fixed action-sequence transfer: validation and test both reached `actionTypeAccuracy=1`.
- Baseline v0.3.1 added generic editable-affordance gating but still failed exact target grounding.
- Privacy-safe diagnostic then identified the remaining causes instead of guessing weights.
- Baseline v0.3.2 is now implemented from those diagnostic findings and repository CI is green.
- Immediate next gate: rerun the same six-group regression with v0.3.2. This is a regression check, not pristine unseen proof.

## Collector state — CLOSED

The prior `episode_success_has_pending_transition` bug was fixed by serialized episode-state mutation queue.

Message Composer proof exists:

- `training-collector-ep-1787831377719.task-episode-review.json`
- final outcome success
- `strategyReady:true`
- no pending transition
- Enter completed

Do not recollect Message Composer or the six-task set.

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

Real resolver result:

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

`baselineReady:true` means data/split is valid for fitting. It does not establish broad Strategy generalization.

## Baseline v0.2.0 — genuine FAIL

User ran train-only fitting on HEAD `f0507cc`.

- validation actionTypeAccuracy=1, exactSemanticAccuracy=0
- test actionTypeAccuracy=0.5, exactSemanticAccuracy=0
- Topic Search: correct `typeText -> submit`, wrong target e3 instead of e1
- Google Search: first action click instead of typeText; target wrong

This was a genuine model weakness, not collector/split failure.

## Baseline v0.3.0 — action sequence fixed, target grounding FAIL

Important commits:

- `42fa9d70b2449fdbadbca0a7eb8493bb24c07e1d`
- `bfb274d199568d605af47c05a5702e3f8c1ef18f`
- `478d57511fa82a5992fe62721494c2a2c37481bd`
- `07cb9f362f78d1b5a6683c6bf2ef3c0b0cbe18fa`

Real six-group v0.3.0 regression:

- validation actionTypeAccuracy=1, targetRefAccuracy=0, exactSemanticAccuracy=0
- test actionTypeAccuracy=1, targetRefAccuracy=0, exactSemanticAccuracy=0
- Topic Search: `typeText@e3 -> submit@e3`, expected e1
- Google Search: `typeText@e15 -> submit@e15`, expected e1

Action sequencing matured; wrong first target propagated through correct learned target continuity.

## Baseline v0.3.1 — editable gate, real regression still FAIL

Important commits:

- `539e1cfb6b76fd5da64e7322a531e5d7b7cf7646`
- `04359b288833e1cc046fd371b2ba083402086872`
- `1b213f60da3537b55b6a95593345b32ace9f307e`
- `bda0010d42fca64a386b37fdec1782546394089b`

Real v0.3.1 result on HEAD `105efb4`:

- modelVersion `0.3.1`
- validation actionTypeAccuracy=1, targetRefAccuracy=0, exactSemanticAccuracy=0
- test actionTypeAccuracy=1, targetRefAccuracy=0, exactSemanticAccuracy=0
- selected refs remained e3/e15

This proved e3/e15 were passing the editable gate; blind weight changes were stopped.

## Target-grounding diagnostic — REAL OUTPUT RECEIVED

Tool:

`training-collector/tools/diagnose_strategy_target_grounding.js`

Diagnostic version `0.1.0`.

Privacy guarantees remained true:

- rawLabelsIncluded false
- typedValuesIncluded false
- selectorsIncluded false
- coordinatesIncluded false
- tabIdsIncluded false
- rawCdpIncluded false

### Validation / Topic Search

Expected typeText target e1 versus predicted e3:

- `focusedElementRefPresent:false`; focus is not a useful signal here
- both e1 and e3: tag=input, role=null, editable=true, enabled/visible/rendered/inViewport/interactable=true
- both affordanceEligible=true
- e1: taskLabelSimilarity `0.222222...`, prototypeLabelSimilarity `0`, traitScore `1`, compatibility `0.45`
- e3: taskLabelSimilarity `0`, prototypeLabelSimilarity `1`, traitScore `1`, compatibility `0.55`

Interpretation: e3 won solely because its label matched TRAIN prototype memory, while the current task named e1. TRAIN-local target label was too dominant for cross-family grounding.

### Test / Google Search

Expected typeText target e1 versus predicted e15:

- `focusedElementRefPresent:false`
- e1: textarea, role=combobox, editable=true, taskLabelSimilarity `0.181818...`, prototypeLabelSimilarity `0`, traitScore `0.5`, compatibility `0.256818...`
- e15: input, role=button, **editable=true**, taskLabelSimilarity `0.272727...`, traitScore `1`, compatibility `0.472727...`
- another e151 had the same stale input/role=button/editable=true shape
- other generic input candidates had taskLabelSimilarity `0.0625`, traitScore `1`

Interpretation identified two generic issues:

1. collector semantic observer classified every input/select as editable; input controls with button semantics could therefore become text targets
2. exact TRAIN tag/role shape and TRAIN target-label memory were stronger than direct current-task target evidence

Focus was explicitly ruled out as the fix.

## Baseline v0.3.2 — diagnostic-driven generic grounding, CI PASS

Important commits:

- `310321606a2c87e65e2b8c444e349f3028de3d59` — collector text-editable semantic classification fix
- `c1d2b1b75b5f6952004e23b13d0c3f8c375c8776` — current-task-dominant text target grounding + stale semantic-role veto
- `0a85e5f1bdb653da9b52f2adce0d5a9da0b67192` — baseline model version `0.3.2`
- `0271f8aff1bd59367f66127625a4253c81b4df52` — diagnostic-derived generic transfer contract
- `b80e8f41fef9f43f4d3598a8456c9456e1b42674` — history contract alignment

### Collector semantic fix

`training-collector/observer/semantic_observer.js` schema is now `0.5.1`.

- textarea and contenteditable remain text-editable
- normal text-like input types remain text-editable
- select is not a text-entry target
- input types button/checkbox/color/file/hidden/image/radio/range/reset/submit are not text-entry targets
- inputType is emitted as semantic observation metadata for future captures

### Strategy grounding fix

For `typeText`, `replaceText`, `clear`:

- explicit non-text roles such as button/link/checkbox/radio/switch/slider/etc. veto stale `editable:true`
- non-text input types veto text target eligibility when inputType is available
- old snapshots remain compatible: input/textarea can still be recognized when inputType was not recorded
- among eligible text targets, current-task label semantics dominate ranking
- learned tag/role traits and TRAIN target labels are supporting evidence only
- text-target compatibility weights: current task 0.80, learned traits 0.10, learned target label 0.10
- non-text action target scoring remains unchanged
- learned submit target continuity remains unchanged
- no e1/e3/e15, site name, URL, selector, coordinate, tabId, or raw CDP hardcode
- focus was not added as a rule because real diagnostic showed it absent

Model v0.3.2 records:

`targetGroundingPolicy: current-task-dominant-with-action-affordance`

### Generic contract coverage

Synthetic contract proves:

- input text/search and textarea/contenteditable are text-editable
- select, input button/submit/checkbox are not text-editable
- stale `editable:true` on `input role=button` cannot win typeText
- a target named by the current task beats a different editable target whose label exactly matches TRAIN
- textarea/combobox named by current task can beat a generic input whose structural traits match TRAIN better
- sequential typeText -> submit continuity still works
- privacy/model serialization invariants remain intact

CI on HEAD `b80e8f41fef9f43f4d3598a8456c9456e1b42674`:

- strategy-offline-baseline run `33076663823`: completed success
- runtime-syntax run `33076663685`: completed success

## Evaluation methodology

Topic Search and Google Search were originally valid heldout records. Their failures have now influenced generic model redesigns, so repeated runs are regression checks rather than pristine unseen proofs.

If v0.3.2 regression passes, use a fresh unseen family/native mission before claiming broader generalization.

Do not recollect/relabel the existing six to manufacture a new heldout claim.

## Immediate next step — v0.3.2 six-group regression

Do not rerun collector, resolver, approval, or dataset builder.

Windows CMD:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD

set SIX=%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827

node training-collector\tools\fit_strategy_offline_baseline.js "%SIX%\strategy-approved-dataset-v03\dataset" --output "%SIX%\strategy-approved-dataset-v03\baseline-v032"

type "%SIX%\strategy-approved-dataset-v03\baseline-v032\evaluation.json"
```

Desired regression target, without forcing it:

- modelVersion `0.3.2`
- result PASS
- validation actionTypeAccuracy=1, targetRefAccuracy=1, exactSemanticAccuracy=1
- test actionTypeAccuracy=1, targetRefAccuracy=1, exactSemanticAccuracy=1

If v0.3.2 still fails, inspect the actual remaining candidate pattern; do not change split policy or recollect the six.

If v0.3.2 passes, next gate is fresh unseen proof, then learned Strategy + learned Behavior runtime integration, native long mission, multi-subgoal, replan, recovery, and semantic memory validation.

Never promote to `main` without explicit user approval after verified PASS.
