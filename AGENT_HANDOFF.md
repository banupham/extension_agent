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
- Strategy/WHAT: still in supervised teaching, now with a valid diverse three-task batch ready for semantic review-aid processing.
- Overall: agent is maturing, but it is still being taught.

## Historical blocked data

- 68 historical raw files.
- 25 historical ambiguous click transitions.
- 0/25 historical semantic targets recovered.
- Historical blocker remains `element_refs_exist_but_page_identity_does_not_link`.
- Do not guess or auto-approve those historical 25 transitions.

## Current replacement teaching batch

Three distinct successful episodes are accepted:

1. `ep-1787826569158` — Google -> Gmail — 5 captured transitions.
2. `ep-1787826618214` — Google -> type `OpenAI` into Search -> submit — 10 captured transitions.
3. `ep-1787826766003` — mission Atlas -> mission Orion — 2 captured transitions.

Local batch processing result reported by the user:

- review files: 3
- ready for human review: 3
- total transitions: 17
- fast-label review: 7
- ambiguous-label review: 10
- fast-label coverage: `0.4117647058823529`
- episode fast-label candidates: 1
- provenance source raw files: 68
- provenance anchors found: 0
- provenance target recovery requested: 1
- recovered semantic targets: 0
- unresolved provenance targets: 1

The `provenanceAnchorCount=0` means the new raw provenance channel did not contribute evidence for this batch. Do not block the whole batch on that: the review exports themselves contain enough semantic observation evidence to process the teaching examples conservatively, while the one targetless click remains review-aid-only.

## Teaching-batch semantic resolver

Commits:

- `e80dea1b4cbc5bad80d285497bb347df7ca1b5ad` — add `training-collector/tools/resolve_strategy_teaching_batch.js`.
- `0027e74519e9eb0bdeeadf900b5138f91a186410` — add `training-collector/tests/strategy_teaching_batch_resolver_contract.js`.
- `067ba25f0976fb260e1f8211dd7b2c9cef3d138b` — add dedicated CI workflow `strategy-teaching-batch-resolver.yml`.

The resolver is a review aid only. It conservatively:

- excludes focus acquisition from Strategy;
- excludes editable-field clicks used only to acquire typing focus;
- collapses per-character `text-key` capture into one semantic `typeText` proposal using text explicitly present in the task instruction, never raw key characters;
- maps Enter to semantic submit when the task explicitly indicates search/submit intent;
- may propose a targetless no-effect click as capture noise only when a later successful task-aligned semantic action exists;
- rejects task-declared text extraction when the instruction looks credential/secret-sensitive;
- always requires explicit human confirmation and remains `autoTrainEligible:false`.

GitHub Actions run `33064693398` completed successfully. `Strategy teaching batch resolver contract: PASS`.

## Immediate next action

On the user's local machine, with `%TEACH%` still set to the teaching-batch directory:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD

node training-collector\tests\strategy_teaching_batch_resolver_contract.js

node training-collector\tools\resolve_strategy_teaching_batch.js --pack "%TEACH%\review-pack-v01\review-pack.json" --triage "%TEACH%\review-pack-v01\triage.v01.json" --out "%TEACH%\teaching-resolution-v01"

node training-collector\tools\prepare_strategy_review_drafts.js --pack "%TEACH%\review-pack-v01\review-pack.json" --triage "%TEACH%\review-pack-v01\triage.v01.json" --out "%TEACH%\review-drafts-v01"

node training-collector\tools\prepare_strategy_approval_candidates.js --digest "%TEACH%\review-drafts-v01\approval-digest.json" --resolution "%TEACH%\teaching-resolution-v01\ambiguity-resolution.json" --out "%TEACH%\approval-candidates-v01"

type "%TEACH%\approval-candidates-v01\approval-candidates.md"
```

Expected goal: 3 approval-candidate episodes, 0 blocked, with three distinct semantic split groups:

- Gmail: one task-relevant click;
- Search: `typeText -> submit`;
- Mission: `click Mission Atlas -> click Mission Orion`.

Do not apply approval until the user has read the generated approval-candidates digest and explicitly confirms its exact digest hash. After approval, build the Strategy dataset; only fit if at least 3 distinct semantic split groups remain and readiness passes. Fit TRAIN only; validation/test stay held out.
