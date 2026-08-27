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
- Current Strategy text-entry + submit teaching bottleneck is now resolved for the six-group batch; next gate is explicit human approval of the new digest.

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

Previous failed real-data approval attempt on resolver 0.2.0:

- candidateEpisodeCount: 4
- blockedEpisodeCount: 2
- blocked: `ep-1787828642619`, `ep-1787831377719`
- digest: `7926cdedd75156338847b25707214b68f98ad2ef2c9bfbca7b29bf3753eabef2`

Do **not** approve digest `7926cd...`.

## Privacy-safe diagnostic findings from real data

Diagnostic commits:

- `e715630c9f5dd7400d06fcf50be1fa293de9713f` — privacy-safe diagnostic
- `bf1319e94c7983ed7b1489ae534605cff1f5695a` — diagnostic privacy contract
- `1ac35e65894f84d245e8d128e588d146cbd1dcdd` — diagnostic CI gate

Real Topic Search shape had one leading `text-key/other-key` plus same-target type chars + Enter.

Real Message Composer shape had interleaved `other-key`/`backspace`, same-target type chars + Enter, then a later no-effect semantic send click.

No typed values, raw key characters, selectors, coordinates, tab IDs, or raw CDP were exposed by the diagnostic.

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
- if a competing submit action exists after Enter, Enter is accepted only when task explicitly requests Enter or Enter itself has observable semantic state change
- when task explicitly requests Enter, a later no-observable-change semantic submit-surface click can be excluded as redundant HOW noise
- if task does not explicitly request Enter and a competing submit click exists with no Enter outcome evidence, the episode remains blocked
- no site/task names are hard-coded
- `autoTrainEligible:false` remains unchanged until explicit human confirmation

CI PASS:

- strategy teaching resolver workflow run `33071121431`: success
- runtime syntax workflow run `33071121512`: success

## Real six-group validation on resolver 0.3.0 — PASS, awaiting human digest confirmation

User pulled HEAD `c6c530d` and ran the local resolver pipeline on the existing six-group folder.

Contract:

- `training-collector/tests/strategy_text_form_sequence_resolver_contract.js` => PASS

Resolver output:

- version: `0.3.0`
- episodeCount: 6
- ambiguousTransitionCount: 36
- resolvedSemanticActionCount: 6
- captureNoiseCount: 41
- unresolvedHumanReviewCount: 0
- fullyResolvedEpisodeCount: 6
- autoTrainEligible: false

Approval-candidate output:

- candidateEpisodeCount: 6
- blockedEpisodeCount: 0
- ambiguityAidCandidateEpisodeCount: 5
- ambiguityResolutionLoaded: true
- digestHash: `8f18d4e5b053d9dae57107b4aa021dfbf46128df3c75b9c50dbad996346b8241`
- autoTrainEligible: false

Six distinct semantic split groups are present:

1. `semantic-sequence:click:gmail`
2. `semantic-sequence:typeText:t-m-ki-m>submit:t-m-ki-m`
3. `semantic-sequence:click:mission-atlas>click:mission-orion`
4. `semantic-sequence:typeText:topic-search>submit:topic-search`
5. `semantic-sequence:click:teaching-confirm`
6. `semantic-sequence:typeText:message-composer>submit:message-composer`

Required new text-entry semantics are correct:

- Topic Search: `typeText -> submit`, progress `0.5 -> 1`
- Message Composer: `typeText -> submit`, progress `0.5 -> 1`
- edit/focus/click mechanics remain excluded as HOW/capture noise with provenance
- the later Message Send click is excluded as `redundant_post_enter_submit_surface_click_how_not_strategy`

This milestone is PASS. Do not run collection or resolver again unless a later regression requires it.

## Immediate next step — wait for explicit human approval of exact digest

Do **not** auto-approve.

Exact digest awaiting human confirmation:

`8f18d4e5b053d9dae57107b4aa021dfbf46128df3c75b9c50dbad996346b8241`

Required confirmation phrase from the approval candidate pack:

`YES-I-REVIEWED-STRATEGY-APPROVAL-DIGEST`

Only after the user explicitly confirms this exact digest:

1. inspect/apply the repository's approval tooling using this exact confirmed digest
2. build the Strategy dataset
3. require `distinctSplitGroupCount >= 6`
4. require `datasetBuilt:true`
5. require `baselineReady:true`
6. require TRAIN contains `click`, `typeText`, `submit`
7. keep validation/test held out; do not move heldout into train to force readiness

Only when `baselineReady=true`:

- fit Strategy from TRAIN only
- heldout evaluation
- load learned Strategy beside learned Behavior at runtime
- native long-mission test
- multi-subgoal
- replan
- recovery
- semantic memory

Never promote to `main` without explicit user approval after verified PASS.
