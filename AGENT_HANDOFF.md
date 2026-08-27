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

Task 2 (`Orion` / Message Composer / Enter) repeatedly produces `episode_success_has_pending_transition` even after the bounded-settlement and START-before-END ordering fixes were installed and the extension was reloaded.

Important evidence:

- Task 1 also used Enter, and its Enter transition was exported as `status: complete`. Therefore Enter itself is not generally broken.
- Task 3 is a simple click and succeeds.
- Task 2 uniquely reproduces a persistent pending transition in the current teaching round.
- Therefore do not blame the user and do not keep asking for blind retries. The remaining bug is specific to the capture sequence around the Message Composer task or another transition created during that sequence.

Previous mitigation commits:

- `4d44a8ede30574e02dd28a73751d51fa518302fa` — bounded stop settlement helper.
- `9017873b258bc537abb5550c5bb4c77eead8899b` — popup waits before Mark Success.
- `dad2d40416f628b7622a81aeea7f0a45c5a4037b` — transition ordering helper.
- `566e60825450da1d848c708cdf69d75934e54e98` — load transition ordering helper.
- `7241acfb8075be1fdea07f55aaf9072b9d290c77` — START acknowledgement before END send.
- `9470d70c811cdc89573afa4c48146275ef62c56e` — transition ordering contract.
- `352fe10ddf5f23c16c788deb3674a412a0646ad9` — CI gate; contracts passed but native task 2 still reproduced the bug.

## Immediate next action

Do not ask the user to retry task 2 again yet.

Next development step is to add a native pending-transition diagnostic that reports only safe aggregate/semantic fields for the currently pending transition(s): transition id suffix, raw action kind/operation, semantic target label/role/tag, and age. No selector, coordinates, tab id, secrets, or private reasoning.

Then reproduce task 2 once and use that diagnostic to identify exactly which transition remains pending. After the exact pending transition is known, fix the collector at the source and add a contract for that specific failure mode.

Target before Strategy fit remains `datasetBuilt:true` and `baselineReady:true`; fit TRAIN only and keep validation/test held out. Do not promote `main`.
