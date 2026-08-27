# Agent development handoff

This file is the durable continuation point for future ChatGPT sessions. Read this file before changing the repository.

## Working rules

- Active development branch: `feat/agent-tab-context`.
- Do **not** promote or merge to `main` without explicit user approval after a verified PASS.
- Every meaningful development/diagnostic action must be committed to GitHub, and this handoff must be updated when the current state or next step changes.
- Preserve architecture boundaries: Strategy chooses WHAT, Behavior chooses HOW, executor does not choose strategy, Goal Checker does not choose the next action.
- Do not persist selectors, coordinates, tab IDs, raw CDP methods, credentials, secrets, or private reasoning in Strategy/recovery/training memory.
- Human demonstration data is never auto-promoted to Strategy training. Human review/verification remains required.
- User prefers concise progress framing: describe whether the agent is maturing / being taught and give the next action, without lengthy implementation explanations.

## Current checkpoint

Historical real-data result remains:

- 68 raw files
- 25 ambiguous click transitions
- 0/25 historical semantic targets recovered
- likely blocker: `element_refs_exist_but_page_identity_does_not_link`
- therefore the historical 25 remain blocked and must not be guessed or auto-approved.

## Agent maturity status

- Behavior/HOW: already learned from real human demonstrations and is runtime-loadable.
- Strategy/WHAT: still in supervised teaching stage. Some verified semantic experience exists, but there is not yet enough diverse trusted Strategy data for a new general Strategy fit.
- Overall: agent is maturing, but it is still being taught.

## Provenance-learning milestone

The feature branch records future episode-linked semantic action anchors so new demonstrations can be connected back to the correct episode even when old page identity linkage is unreliable.

GitHub Actions run `33061242955` completed successfully. The `Strategy episode provenance contract` passed together with the existing semantic mission, behavior, ambiguity, target-backfill, and approval pipeline gates.

## Replacement three-task teaching batch accepted for processing

The user supplied three new review exports with three distinct episode IDs and successful final outcomes:

1. `ep-1787826569158` — `Trên Google, mở liên kết Gmail ở góc trên bên phải.` — 5 captured transitions — final status `success`.
2. `ep-1787826618214` — `Trên Google, nhập OpenAI vào ô Tìm kiếm rồi bấm Tìm trên Google.` — 10 captured transitions — final status `success`.
3. `ep-1787826766003` — `Trên http://127.0.0.1:8091/mission, bấm mission Atlas và mission orion.` — 2 captured transitions — final status `success`.

All three exports report `strategyReady: true` but remain human-review required and are not training eligible yet.

Important observations for the next processing stage:

- Episode 1 contains the intended Gmail click plus incidental focus/click noise around it.
- Episode 2 contains editable search interaction followed by printable `text-key` transitions and an Enter transition; the semantic typing value remains intentionally redacted and must not be reconstructed from raw printable characters.
- Episode 3 cleanly records two semantically labeled actions: `Mission Atlas` followed by `Mission Orion`, with page transitions to `/mission/atlas` then `/mission/orion`.
- Raw review exports are local teaching evidence and must not be committed to GitHub; only safe aggregate checkpoint metadata belongs in this handoff.

## Current code adjustment for this batch

Commit `ffb9752e490a27879c06ec6572270d99dad9053e` updates Strategy review-pack action hints so current collector action kinds `text-key`, `key`, `text-change`, and `change` enter the correct human-review ambiguity path rather than becoming missing-hint records. This does not auto-label typed text and does not auto-approve anything.

GitHub Actions run `33063977132` was started for this change; check its final result before treating the patch as proven.

## Immediate next action

On the user's machine, place only these three new review exports into a fresh local folder outside the Git repo, then run:

1. `prepare_human_learning_batch.js` with that review folder;
2. `prepare_strategy_review_pack.js` from the resulting manifest;
3. `score_strategy_review_pack.js`;
4. `backfill_strategy_episode_provenance.js` against the new review pack and current `training-collector/socket-data`.

The immediate success signal is `provenanceAnchorCount > 0`. If ambiguous click evidence exists in the new pack, check whether at least some of it now yields `recoveredSemanticTargetCount > 0`.

After that, continue through ambiguity resolution -> approval candidates -> explicit human confirmation -> Strategy dataset build. Do not fit Strategy until there are at least 3 distinct semantic split groups; fit TRAIN only and keep validation/test held out.
