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

## Agent maturity

- Behavior/HOW: learned from real human demonstrations and runtime-loadable.
- Strategy/WHAT: still supervised.
- Agent is maturing but not fully autonomous.
- Recovery/replan/semantic memory already exist.
- Six-group Strategy teaching batch is now human-approved, dataset-built, leakage-safe, and `baselineReady:true`.
- Next gate: fit the first offline Strategy baseline from TRAIN only and evaluate validation/test heldout.

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

A split group is a leakage boundary for one semantic family of examples. All records from one family must remain in one assigned split; train/validation/test must not contain the same split group. This prevents memorized family-specific evidence from appearing in heldout evaluation.

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

User ran the approval applicator on HEAD `cac7dcb`.

Approval receipt:

- result: PASS
- approvalApplicatorVersion: `0.2.0`
- approvedEpisodeCount: 6
- approvedTransitionCount: 51
- approvedStrategyStepCount: 10
- excludedCaptureNoiseCount: 41
- blockedEpisodeCount: 0
- explicitHumanConfirmationVerified: true

Dataset builder:

- result: PASS
- approvedDatasetBuilderVersion: `0.1.0`
- adaptedEpisodeCount: 6
- distinctSplitGroupCount: 6
- datasetBuilt: true
- splitCounts: train=4, validation=1, test=1
- baselineReady: true
- baselineReadinessErrors: []

Readiness gate:

- result: PASS
- ready: true
- trainRecords: 4
- validationRecords: 1
- testRecords: 1
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

Do not alter seed, ratios, split policy, or move heldout groups into TRAIN to force future evaluation PASS.

Important interpretation: `baselineReady:true` means the dataset and leakage boundaries are technically valid for fitting the first offline Strategy baseline. It does **not** mean the agent is broadly generalizable yet; only four records are in TRAIN and the current semantic action space is still very small.

## Immediate next step — offline Strategy fit + heldout eval

Use existing tool:

`training-collector/tools/fit_strategy_offline_baseline.js`

It enforces:

- readiness must already PASS
- fit source = TRAIN only
- validation/test are not used for fit
- heldout validation/test evaluation occurs after fit

Windows CMD after pulling latest handoff commit:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD

set SIX=%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827

node training-collector\tools\fit_strategy_offline_baseline.js "%SIX%\strategy-approved-dataset-v03\dataset" --output "%SIX%\strategy-approved-dataset-v03\baseline-v01"

type "%SIX%\strategy-approved-dataset-v03\baseline-v01\evaluation.json"
```

Do not proceed to runtime integration unless heldout evaluation passes.

If offline fit + heldout evaluation PASS, next steps are:

1. load learned Strategy beside learned Behavior at runtime
2. native long-mission test
3. multi-subgoal
4. replan
5. recovery
6. semantic memory

Never promote to `main` without explicit user approval after verified PASS.
