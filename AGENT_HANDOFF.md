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
- Strategy/WHAT: still supervised, with the first explicit human-approved 3-family dataset already built.
- Overall: agent is maturing, but still being taught.

## First approved Strategy teaching batch

- approvedEpisodeCount: 3
- approvedStrategyStepCount: 5
- distinctSplitGroupCount: 3
- datasetBuilt: true
- splitCounts: train=1, validation=1, test=1
- baselineReady: false
- readiness error: `test_action_types_unseen_in_train:submit,typeText`

Do not move held-out examples into train and do not alter split policy to force readiness.

## Second teaching round

The controlled lab is `http://127.0.0.1:8092/` and adds three new semantic groups:

1. Topic Search: type text + submit.
2. Message Composer: type text + submit.
3. Teaching Confirm: click.

The user has already exported task 1 (`Atlas` / Topic Search) and task 3 (`Teaching Confirm`). Those do not need to be repeated.

Task 2 (`Orion` / Message Composer / Enter) repeatedly produced `episode_success_has_pending_transition`.

The first bounded wait fix was insufficient. The deeper race was that `TRANSITION_END` could be delivered before `TRANSITION_START` had been acknowledged/persisted, leaving a permanent pending transition. The content capture now explicitly orders each end message after the corresponding start acknowledgement.

Root-fix commits:

- `dad2d40416f628b7622a81aeea7f0a45c5a4037b` — add transition ordering helper.
- `566e60825450da1d848c708cdf69d75934e54e98` — load the helper before `content.js`.
- `7241acfb8075be1fdea07f55aaf9072b9d290c77` — enforce START acknowledgement before END send.
- `9470d70c811cdc89573afa4c48146275ef62c56e` — add transition ordering contract.
- `352fe10ddf5f23c16c788deb3674a412a0646ad9` — CI gate.

GitHub Actions run `33067305408` completed successfully. The stop-settlement contract, transition-order contract, and Strategy teaching coverage contract all passed.

## Immediate next action

On the user's machine:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD
node training-collector\tests\episode_transition_order_contract.js
start chrome://extensions/
```

Reload Training Collector, refresh `http://127.0.0.1:8092/`, then record only:

`Trên http://127.0.0.1:8092/, nhập Orion vào ô Message Composer rồi gửi bằng Enter.`

After Enter, Mark Success, then export the task episode. If this succeeds, combine original task 1 + replacement task 2 + original task 3 and continue the six-group Strategy teaching pipeline.

Target before Strategy fit remains `datasetBuilt:true` and `baselineReady:true`; fit TRAIN only and keep validation/test held out. Do not promote `main`.
