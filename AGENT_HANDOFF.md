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
- Human demonstrations never auto-promote; explicit human digest confirmation remains required.

## Agent maturity

- Behavior/HOW: learned from real human demonstrations and runtime-loadable.
- Strategy/WHAT: still supervised.
- Agent is maturing but not fully autonomous.
- Recovery/replan/semantic memory already exist.
- Current bottleneck is Strategy teaching coverage for semantic text-entry + submit sequences.

## First approved Strategy batch

Human-approved semantic groups:

1. `semantic-sequence:click:gmail`
2. `semantic-sequence:typeText:t-m-ki-m>submit:t-m-ki-m`
3. `semantic-sequence:click:mission-atlas>click:mission-orion`

Dataset state:

- adaptedEpisodeCount: 3
- distinctSplitGroupCount: 3
- datasetBuilt: true
- train=1, validation=1, test=1
- baselineReady: false
- readiness error: `test_action_types_unseen_in_train:submit,typeText`

Do not move heldout data into train to force readiness.

## Collector bug is closed

The prior `episode_success_has_pending_transition` bug was fixed by serialized episode-state mutation queue.

Message Composer proof already exists:

- export: `training-collector-ep-1787831377719.task-episode-review.json`
- final outcome: success
- strategyReady: true
- no pending transition
- Enter is a completed transition

Do **not** recollect Message Composer or the six-task set.

## Current six-demonstration teaching set

Local folder:

`%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827`

Episodes:

1. `ep-1787826569158` — Google -> Gmail click
2. `ep-1787826618214` — Google -> type OpenAI -> submit search
3. `ep-1787826766003` — Mission Atlas -> Mission Orion
4. `ep-1787828642619` — Topic Search -> type Atlas -> Enter
5. `ep-1787831377719` — Message Composer -> type Orion -> Enter
6. `ep-1787828809498` — Teaching Confirm click

Previous real-data approval attempt on resolver 0.2.0:

- candidateEpisodeCount: 4
- blockedEpisodeCount: 2
- blocked: `ep-1787828642619`, `ep-1787831377719`
- digest: `7926cdedd75156338847b25707214b68f98ad2ef2c9bfbca7b29bf3753eabef2`

Do **not** approve digest `7926cd...`.

## Privacy-safe diagnostic findings from real data

Diagnostic tool/contract commits:

- `e715630c9f5dd7400d06fcf50be1fa293de9713f` — privacy-safe diagnostic
- `bf1319e94c7983ed7b1489ae534605cff1f5695a` — diagnostic privacy contract
- `1ac35e65894f84d245e8d128e588d146cbd1dcdd` — diagnostic CI gate

Diagnostic does not expose typed values, raw key characters, selectors, coordinates, tab IDs, or raw CDP.

Real Topic Search shape:

- finalOutcomeSuccess: true
- declaredTextPresent: true
- taskSubmitIntent: true
- typeCharCount: 5
- one semantic editable target
- Enter on same target
- sequence detector already recognized the core sequence
- one leading ambiguous `text-key/other-key` on same editable target caused approval blocking

Real Message Composer shape:

- finalOutcomeSuccess: true
- declaredTextPresent: true
- taskSubmitIntent: true
- typeCharCount: 8
- one semantic editable target throughout
- several `text-key/other-key` and `backspace` operations interleaved with text entry
- Enter on same editable target
- one later no-observable-change submit-surface click
- previous resolver rejected the sequence because editing mechanics were not accepted as HOW noise and the later submit click competed with Enter

## Generic resolver fix v0.3.0 — implemented and CI PASS

Important commits:

- `673e3fbb5671dc24b993f342dd0a2f920b0434d9` — `fix(strategy): resolve real editable text mechanics generically`
- `91605b632f7ac8cb7634ce6d53e04754ead7eabd` — `test(strategy): cover real text editing and competing submit shapes`

Resolver version: `0.3.0`.

Implemented generic semantics:

- focus/click acquisition on editable target => HOW/capture noise
- `type-char` transitions on one semantic editable target => collapse into one Strategy `typeText`
- `other-key`, `backspace`, `delete`, and text-change during the same text-entry sequence => HOW/capture noise
- no raw typed characters are used or persisted
- Enter on same target may become Strategy `submit` only with task submit intent + successful final outcome
- if a competing submit action exists after Enter, Enter is accepted only when:
  - task explicitly requests Enter, or
  - Enter itself has observable semantic state change
- when task explicitly requests Enter, a later no-observable-change semantic submit-surface click can be excluded as redundant HOW noise
- if task does not explicitly request Enter and a competing submit click exists with no Enter outcome evidence, the episode remains blocked
- no site/task names are hard-coded
- `autoTrainEligible:false` remains unchanged

Updated contract now covers:

1. ordinary search-like `typeText -> submit`
2. Topic-like leading `other-key` + per-character capture + Enter
3. Composer-like `other-key`/`backspace` interleaving + Enter + redundant post-Enter submit click
4. semantic progress `0.5 -> 1`
5. competing submit negative case remains blocked when task does not explicitly request Enter
6. Enter on different editable target remains blocked
7. failed final outcome remains blocked
8. source guard against site-specific hard-coding and privacy violations

CI PASS:

- strategy teaching resolver workflow run `33071121431`: success
- runtime syntax workflow run `33071121512`: success

## Immediate next step

Do not recollect anything and do not rerun diagnostics already completed.

User should pull latest HEAD and rerun only:

1. updated resolver contract
2. resolver on existing six-group pack
3. approval candidate generation
4. print approval candidate markdown

Windows CMD:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD

set SIX=%USERPROFILE%\Downloads\extension_agent-local-data\teaching-six-20260827

node training-collector\tests\strategy_text_form_sequence_resolver_contract.js

node training-collector\tools\resolve_strategy_teaching_batch.js --pack "%SIX%\review-pack-v01\review-pack.json" --triage "%SIX%\review-pack-v01\triage.v01.json" --out "%SIX%\teaching-resolution-v03"

node training-collector\tools\prepare_strategy_approval_candidates.js --digest "%SIX%\review-drafts-v01\approval-digest.json" --resolution "%SIX%\teaching-resolution-v03\ambiguity-resolution.json" --out "%SIX%\approval-candidates-v03"

type "%SIX%\approval-candidates-v03\approval-candidates.md"
```

Target before any approval:

- contract PASS
- resolver version `0.3.0`
- candidateEpisodeCount = 6
- blockedEpisodeCount = 0
- six genuinely distinct semantic split groups
- Topic Search = `typeText -> submit`
- Message Composer = `typeText -> submit`
- progress `0.5 -> 1`
- autoTrainEligible = false

If target is met, show the new digest to the user and wait for explicit human confirmation. Do not auto-approve.

Only after explicit confirmation:

1. apply approvals
2. build Strategy dataset
3. require `distinctSplitGroupCount >= 6`
4. require `datasetBuilt:true`
5. require `baselineReady:true`
6. require TRAIN contains click + typeText + submit
7. keep validation/test held out

Only when baselineReady=true:

- fit Strategy from TRAIN only
- heldout evaluation
- load learned Strategy beside learned Behavior at runtime
- native long-mission test
- multi-subgoal
- replan
- recovery
- semantic memory

Never promote to `main` without explicit user approval after verified PASS.
