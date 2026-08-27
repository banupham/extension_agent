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

## Pending-transition fix during second teaching round

The user successfully exported task 1 (`Atlas` in `Topic Search`) and task 3 (`Teaching Confirm`), but task 2 hit `episode_success_has_pending_transition` immediately after the Enter action when Mark Success was pressed.

This was treated as a collector timing problem, not as failed teaching data. The collector now waits for a short bounded settlement window before sending a successful episode stop, so a just-finished keyboard/Enter transition can complete before the success gate is evaluated. A truly stuck pending transition still remains blocked after the timeout.

Fix commits:

- `4d44a8ede30574e02dd28a73751d51fa518302fa` — add bounded episode-stop settlement helper.
- `0b7a9f6c11376b0d8e2d05779ef7fa6ac692c85d` — load helper in the collector popup.
- `9017873b258bc537abb5550c5bb4c77eead8899b` — wait for pending transitions before Mark Success stops the episode.
- `9748994daa1cc337aae001f90b2d7722b1e65aa0` — add settlement contract test.
- `91424442c414f9b34fe0710091da3b908019ea94` — CI gate for the fix.

GitHub Actions run `33066420836` completed successfully.

The already exported task 1 and task 3 review files do not need to be repeated. Only task 2 should be recorded again after reloading the updated Training Collector extension.

## Immediate next action

On the user's machine:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD
node training-collector\tests\episode_stop_settlement_contract.js
```

Then open `chrome://extensions/`, reload the Training Collector extension, keep the teaching lab on `http://127.0.0.1:8092/`, and record only:

`Trên http://127.0.0.1:8092/, nhập Orion vào ô Message Composer rồi gửi bằng Enter.`

After pressing Enter, Mark Success can be pressed normally; the popup now waits for the transition to settle. Export that task episode for review and send the single new review file.

Once task 2 is received, combine the existing task 1 + task 3 exports with this replacement task 2 and continue the six-group Strategy teaching pipeline. Target before fitting Strategy remains `datasetBuilt:true`, `baselineReady:true`, with train covering `click`, `typeText`, and `submit`, while validation/test remain held out. Do not promote `main`.
