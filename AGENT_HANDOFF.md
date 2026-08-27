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

Commits:

- `17b05e2da5ab39b4c2e5eb80966299a6371d1899` — add `training-collector/capture/episode_provenance_capture.js`.
- `da1044933e7bd12dcfe7a447e230a77faac538d4` — load the provenance capture module in the Training Collector manifest.
- `38dc0db38444df032a211a389a04c5a9511c358e` — add `backfill_strategy_episode_provenance.js` for episode-scoped semantic target recovery.
- `f252d8769065b2dfef6c97239484ebbbc2a73dc1` — add Strategy episode provenance contract.
- `af721095ae21bfcd7cd1d42834567ae11e13b60f` — CI gate for the new learning path.

GitHub Actions run `33061242955` completed successfully. The new `Strategy episode provenance contract` passed together with all existing semantic mission, behavior, ambiguity, target-backfill, and approval pipeline gates.

## Review of first new teaching attempt

User uploaded three review-export files after completing the requested three teaching tasks.

Observed result:

- only **2 unique episode IDs** are present;
- two uploaded files are duplicate exports of `ep-1787825498018`;
- the other unique episode is `ep-1787825857553`;
- both unique episodes carry the same task instruction: `Một nhiệm vụ khác hẳn hai bài trên`;
- therefore these exports are not suitable as three distinct Strategy teaching families because the intended task semantics are not explicitly recorded.

Do not infer the missing task intent from browsing actions alone and do not promote these episodes to Strategy training.

## Immediate next action

Collect a replacement small teaching batch using concrete task instructions exactly as written:

1. `Trên Google, mở liên kết Gmail ở góc trên bên phải.`
2. `Trên Google, nhập OpenAI vào ô Tìm kiếm rồi bấm Tìm trên Google.`
3. `Trên http://127.0.0.1:8091/, bấm Play rồi Mute.`

Export each episode separately immediately after completion. Before accepting the batch, verify that the three exported files contain three different `episodeId` values and that each `task.instruction` matches its concrete task.

After a valid three-episode batch is available, create a new review pack, triage it, then run the episode-provenance backfill against `training-collector/socket-data`. Success criterion: `provenanceAnchorCount > 0` and at least some ambiguous clicks recover semantic targets. Then continue through ambiguity resolution -> explicit human approval -> Strategy dataset build. Fit Strategy only after at least 3 distinct semantic split groups exist; TRAIN only for fitting, validation/test held out.
