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

## New provenance-learning milestone

The feature branch now records future episode-linked semantic action anchors so new demonstrations can be connected back to the correct episode even when old page identity linkage is unreliable.

Commits:

- `17b05e2da5ab39b4c2e5eb80966299a6371d1899` — add `training-collector/capture/episode_provenance_capture.js`.
- `da1044933e7bd12dcfe7a447e230a77faac538d4` — load the provenance capture module in the Training Collector manifest.
- `38dc0db38444df032a211a389a04c5a9511c358e` — add `backfill_strategy_episode_provenance.js` for episode-scoped semantic target recovery.
- `f252d8769065b2dfef6c97239484ebbbc2a73dc1` — add Strategy episode provenance contract.
- `af721095ae21bfcd7cd1d42834567ae11e13b60f` — CI gate for the new learning path.

GitHub Actions run `33061242955` completed successfully. The new `Strategy episode provenance contract` passed together with all existing semantic mission, behavior, ambiguity, target-backfill, and approval pipeline gates.

## Immediate next action

The code path is ready. The next step is to collect a **small new teaching batch** after reloading the updated Training Collector extension.

Goal of the batch: create at least 3 genuinely different semantic task families, not three paraphrases of the same task.

Recommended first batch:

1. media control task;
2. navigation / open-choice task;
3. form / interface-control task.

After the user records and exports the new episodes, run the normal review-pack/triage path, then run:

```bat
node training-collector\tools\backfill_strategy_episode_provenance.js --pack <new-review-pack.json> --raw training-collector\socket-data --out <new-target-evidence.json>
```

Success criterion for the new capture path: `provenanceAnchorCount > 0` and at least some previously ambiguous clicks produce `recoveredSemanticTargetCount > 0`.

If the new batch proves this, continue through ambiguity resolution -> human approval -> Strategy dataset build. Once there are at least 3 distinct semantic split groups, fit the Strategy model using TRAIN only and keep validation/test held out.
