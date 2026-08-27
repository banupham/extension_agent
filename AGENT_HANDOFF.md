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
- Six-group semantic text-entry + submit teaching coverage has passed review and has now received explicit human digest confirmation.
- Next gate: apply approved annotations locally, build the six-group Strategy dataset, and require `baselineReady:true` before fitting any Strategy model.

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

The approval applicator already enforces:

- candidate digest integrity verification
- exact digest hash match
- exact confirmation phrase match
- no blocked episodes approved
- excluded capture noise never becomes Strategy steps
- annotations remain unassigned until dataset split

Do not ask the user to reconfirm this digest.

## Deterministic six-group split expectation

Existing split policy remains unchanged:

- seed: `strategy-episode-v0`
- ratios: train 0.8 / validation 0.1 / test 0.1
- assignment boundary: `splitGroup`
- six distinct groups => train=4, validation=1, test=1

With the current six group names and existing seed, deterministic assignment is expected to be:

- test: `semantic-sequence:typeText:t-m-ki-m>submit:t-m-ki-m`
- validation: `semantic-sequence:typeText:topic-search>submit:topic-search`
- train: `semantic-sequence:click:mission-atlas>click:mission-orion`
- train: `semantic-sequence:click:teaching-confirm`
- train: `semantic-sequence:click:gmail`
- train: `semantic-sequence:typeText:message-composer>submit:message-composer`

Therefore TRAIN is expected to contain `click`, `typeText`, and `submit`, while validation/test remain held out. Do not alter seed, ratios, split policy, or move heldout data to force readiness.

## Immediate next step — apply approval and build dataset locally

Run in Windows CMD after pulling latest HEAD:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD

set SIX=%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827
set DIGEST=8f18d4e5b053d9dae57107b4aa021dfbf46128df3c75b9c50dbad996346b8241

node training-collector\tools\apply_strategy_approval_candidates.js --candidates "%SIX%\approval-candidates-v03\approval-candidates.json" --confirm-digest "%DIGEST%" --confirm "YES-I-REVIEWED-STRATEGY-APPROVAL-DIGEST" --out "%SIX%\approved-annotations-v03"

node training-collector\tools\build_strategy_dataset_from_approvals.js --pack "%SIX%\review-pack-v01\review-pack.json" --annotations "%SIX%\approved-annotations-v03" --out "%SIX%\strategy-approved-dataset-v03" --seed "strategy-episode-v0"

node training-collector\tools\check_strategy_baseline_readiness.js "%SIX%\strategy-approved-dataset-v03\dataset"

type "%SIX%\approved-annotations-v03\approval-receipt.json"
type "%SIX%\strategy-approved-dataset-v03\manifest.json"
```

Target:

- approvedEpisodeCount = 6
- blockedEpisodeCount = 0
- explicitHumanConfirmationVerified = true
- approvedStrategyStepCount = 10
- excludedCaptureNoiseCount = 41
- adaptedEpisodeCount = 6
- distinctSplitGroupCount = 6
- datasetBuilt = true
- splitCounts = train 4, validation 1, test 1
- baselineReady = true
- baselineReadinessErrors = []
- TRAIN action coverage contains `click`, `typeText`, `submit`

If actual output differs, diagnose from output and repository code; do not recollect and do not change split policy just to force PASS.

Only when `baselineReady=true`:

1. fit Strategy from TRAIN only
2. evaluate validation/test heldout
3. load learned Strategy beside learned Behavior at runtime
4. native long-mission test
5. multi-subgoal
6. replan
7. recovery
8. semantic memory

Never promote to `main` without explicit user approval after verified PASS.
