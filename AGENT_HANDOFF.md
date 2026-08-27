# Agent development handoff

This file is the durable continuation point for future ChatGPT sessions. Read this file before changing the repository.

## Working rules

- Active development branch: `feat/agent-tab-context`.
- Do **not** promote or merge to `main` without explicit user approval after a verified PASS.
- Every meaningful development/diagnostic action must be committed to GitHub, and this handoff must be updated whenever current state or next step changes.
- Preserve boundaries: Strategy chooses WHAT, Behavior chooses HOW, executor does not choose strategy, Goal Checker does not choose the next action.
- Do not persist selectors, coordinates, tab IDs, raw CDP methods, credentials, secrets, or private reasoning in Strategy/recovery/training memory.
- Human demonstrations never auto-promote to Strategy training; explicit human review remains required.
- User wants concise progress framing: say whether the agent is maturing / being taught, then give the next action. Avoid long technical explanations.

## Agent maturity status

- Behavior/HOW: learned from real human demonstrations and runtime-loadable.
- Strategy/WHAT: still supervised, but now has its first explicit human-approved 3-family dataset.
- Overall: agent is clearly maturing, but it is still being taught.

## Historical blocked data

- 68 historical raw files.
- 25 historical ambiguous click transitions.
- 0/25 historical semantic targets recovered.
- Historical blocker remains `element_refs_exist_but_page_identity_does_not_link`.
- Never guess or auto-approve those historical 25 transitions.

## First approved Strategy teaching batch

Three successful demonstrations were explicitly confirmed by the user using digest:

`758b466357580ca3e9d5914c8f91712b10fcf543b2ac0979f4f21bf1a2a6c740`

Approval result:

- approvedEpisodeCount: 3
- approvedTransitionCount: 17
- approvedStrategyStepCount: 5
- excludedCaptureNoiseCount: 12
- blockedEpisodeCount: 0
- explicitHumanConfirmationVerified: true

The approved semantic groups are:

1. `semantic-sequence:click:gmail`
2. `semantic-sequence:typeText:t-m-ki-m>submit:t-m-ki-m`
3. `semantic-sequence:click:mission-atlas>click:mission-orion`

Dataset build result:

- adaptedEpisodeCount: 3
- distinctSplitGroupCount: 3
- datasetBuilt: true
- splitCounts: train=1, validation=1, test=1
- baselineReady: false
- readiness error: `test_action_types_unseen_in_train:submit,typeText`

This is an expected data-coverage limit, not a pipeline failure. Do not move held-out examples into train and do not change split policy to force a PASS.

## Second teaching-round coverage plan

A six-group coverage contract was added to prove the next round can provide train coverage while preserving validation/test isolation.

New commits:

- `8f0107ba40a69b680cb5a7bb9c5a093873c7065f` — controlled Strategy teaching lab on `http://127.0.0.1:8092/`.
- `ebffd7a15649bf1d4f84987b2c4672df52b7b942` — six-group Strategy teaching coverage contract.
- `330f26a8eab85433cab5045b03f3634e535c230e` — dedicated CI gate.

GitHub Actions run `33065356220` completed successfully.

The controlled lab exposes three stable semantic targets:

- `Topic Search` — text entry + submit via Enter.
- `Message Composer` — text entry + submit via Enter.
- `Teaching Confirm` — independent click.

Together with the first 3 groups, these make 6 semantic groups: 3 carrying click and 3 carrying typeText+submit. With the current split policy this leaves 4 train groups plus 1 validation and 1 test group, and the coverage contract proves held-out action types are represented in train across 100 deterministic seeds.

## Immediate next action

1. User pulls the latest feature branch and starts the teaching lab:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD
node training-collector\tests\strategy_teaching_coverage_contract.js
node control-center\script\page_strategy_teaching_lab.js
```

2. In a separate browser/collector session, record and export exactly these three new tasks as separate successful episodes:

- `Trên http://127.0.0.1:8092/, nhập Atlas vào ô Topic Search rồi bấm Enter.`
- `Trên http://127.0.0.1:8092/, nhập Orion vào ô Message Composer rồi gửi bằng Enter.`
- `Trên http://127.0.0.1:8092/, bấm Teaching Confirm.`

3. After the user supplies the three new review exports, create a fresh combined local review folder containing the original 3 + new 3 episodes, then rerun human-learning batch -> review pack -> triage -> teaching resolver -> approval candidates -> explicit human confirmation -> dataset build.

Target before fitting Strategy: `datasetBuilt:true`, `baselineReady:true`, train contains `click`, `typeText`, and `submit`, validation/test remain held out. Only then run readiness check and TRAIN-only Strategy fit. Do not promote `main`.
