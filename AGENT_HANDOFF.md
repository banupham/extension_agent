# Agent development handoff

This file is the durable continuation point for future ChatGPT sessions. Read this file before changing the repository.

## Working rules

- Active development branch: `feat/agent-tab-context`.
- Do **not** promote or merge to `main` without explicit user approval after a verified PASS.
- Every meaningful development/diagnostic action must be committed to GitHub, and this handoff must be updated when the current state or next step changes.
- Preserve architecture boundaries: Strategy chooses WHAT, Behavior chooses HOW, executor does not choose strategy, Goal Checker does not choose the next action.
- Do not persist selectors, coordinates, tab IDs, raw CDP methods, credentials, secrets, or private reasoning in Strategy/recovery/training memory.
- Human demonstration data is never auto-promoted to Strategy training. Human review/verification remains required.
- User prefers concise progress framing: state whether the agent is maturing / being taught and give the next action, without lengthy implementation explanations.

## Agent maturity status

- Behavior/HOW: learned from real human demonstrations and runtime-loadable.
- Strategy/WHAT: still in supervised teaching, but now has a valid three-task approval-candidate batch spanning three distinct semantic task families.
- Overall: agent is maturing, but it is still being taught.

## Historical blocked data

- 68 historical raw files.
- 25 historical ambiguous click transitions.
- 0/25 historical semantic targets recovered.
- Historical blocker remains `element_refs_exist_but_page_identity_does_not_link`.
- Do not guess or auto-approve those historical 25 transitions.

## Current replacement teaching batch

Three distinct successful episodes:

1. `ep-1787826569158` — Google -> Gmail — 5 captured transitions.
2. `ep-1787826618214` — Google -> type `OpenAI` into Search -> submit — 10 captured transitions.
3. `ep-1787826766003` — mission Atlas -> mission Orion — 2 captured transitions.

Batch review results reported by the user:

- episodeCount: 3
- transitionCount: 17
- fastLabelReviewCount: 7
- ambiguousLabelReviewCount: 10
- teaching resolver: PASS
- resolvedSemanticActionCount: 2
- captureNoiseCount: 12
- unresolvedHumanReviewCount: 0
- fullyResolvedEpisodeCount: 3
- approval candidates: 3
- blocked episodes: 0
- ambiguity-aid candidate episodes: 2
- exact candidate digest hash: `758b466357580ca3e9d5914c8f91712b10fcf543b2ac0979f4f21bf1a2a6c740`
- autoTrainEligible remains false pending explicit human confirmation.

The three semantic split groups are:

- `semantic-sequence:click:gmail`
- `semantic-sequence:typeText:t-m-ki-m>submit:t-m-ki-m`
- `semantic-sequence:click:mission-atlas>click:mission-orion`

The approval digest proposes:

- Gmail task: 1 Strategy click, 4 capture-noise steps excluded.
- Search task: 2 Strategy actions (`typeText`, `submit`), 8 capture-noise steps excluded.
- Mission task: 2 Strategy clicks (`Mission Atlas`, `Mission Orion`), 0 excluded.

The user displayed the full approval-candidates markdown. Displaying it is not itself approval. The next command uses the exact digest hash and explicit confirmation phrase; running that command is the human confirmation boundary.

## Teaching-batch semantic resolver milestone

Commits:

- `e80dea1b4cbc5bad80d285497bb347df7ca1b5ad` — add `training-collector/tools/resolve_strategy_teaching_batch.js`.
- `0027e74519e9eb0bdeeadf900b5138f91a186410` — add `training-collector/tests/strategy_teaching_batch_resolver_contract.js`.
- `067ba25f0976fb260e1f8211dd7b2c9cef3d138b` — add dedicated CI workflow `strategy-teaching-batch-resolver.yml`.

GitHub Actions run `33064693398` completed successfully. `Strategy teaching batch resolver contract: PASS`.

## Immediate next action

If the human reviewer agrees the displayed digest matches the three demonstrations, run:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD
set TEACH=%USERPROFILE%\Downloads\extension_agent-local-data\teaching-batch-20260827

node training-collector\tools\apply_strategy_approval_candidates.js --candidates "%TEACH%\approval-candidates-v01\approval-candidates.json" --confirm-digest 758b466357580ca3e9d5914c8f91712b10fcf543b2ac0979f4f21bf1a2a6c740 --confirm YES-I-REVIEWED-STRATEGY-APPROVAL-DIGEST --out "%TEACH%\strategy-approved-v01"

node training-collector\tools\build_strategy_dataset_from_approvals.js --pack "%TEACH%\review-pack-v01\review-pack.json" --annotations "%TEACH%\strategy-approved-v01" --out "%TEACH%\strategy-human-dataset-v01"
```

Expected target: explicit approval PASS, then dataset build sees 3 distinct semantic split groups. Only if the dataset reports both `datasetBuilt:true` and `baselineReady:true` should the next step run readiness check and fit Strategy TRAIN-only; validation/test remain held out. Do not promote `main`.
