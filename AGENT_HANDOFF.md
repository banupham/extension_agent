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

Task 2 (`Orion` / Message Composer / Enter) repeatedly produced `episode_success_has_pending_transition` even after bounded settlement and START-before-END ordering were installed.

Important evidence:

- Task 1 also used Enter, and its Enter transition was exported as complete. Enter itself is not generally broken.
- Task 3 is a simple click and succeeds.
- The remaining failure is a collector state-consistency issue exposed by the Message Composer sequence, not user error.

## Pending-transition root fix v3

The background worker previously handled each episode transition with independent `load state -> mutate -> save state` calls. Rapid START/END messages from typing could overlap and overwrite each other's persisted episode snapshots. That can resurrect an already-finished transition as `pending` even when the matching END message was delivered correctly.

The collector now serializes all episode-state mutations through one queue and reads consistent state only after that queue drains. START, END, STOP, and START-EPISODE state mutations no longer race each other.

New commits:

- `89fce567c76a5793f656722cde8d23a7ba912a60` — add serialized episode-state queue.
- `f49399b044fd2824836d0325b8f1a624421e23da` — wire START/END/STOP/episode state mutations through the queue and add safe episode diagnostic endpoint.
- `857369f37c2f2bade414f462e57b2500e78bc81c` — contract for queue ordering and recovery after errors.
- `c1d8148735d2db9b477be4a9a97b7c48ee030257` — popup shows the exact safe pending action/target if a pending transition still survives.
- `fd273ef91ba1cdefa2c1a09cbe411202c98c6829` — CI gate for serialized episode-state mutations.

GitHub Actions run `33068893125` completed successfully. Stop-settlement, transition-order, episode-state-queue, and Strategy teaching coverage contracts all pass.

The diagnostic remains privacy-safe: no selectors, coordinates, tab IDs, raw text values, secrets, or private reasoning.

## Immediate next action

The user should pull the feature branch, reload Training Collector, refresh the teaching lab, and retry **task 2 only once**:

```bat
cd /d C:\Users\duong\Downloads\extension_agent
git pull
git rev-parse --short HEAD
node training-collector\tests\episode_state_queue_contract.js
start chrome://extensions/
```

Then Reload Training Collector, refresh `http://127.0.0.1:8092/`, and record only:

`Trên http://127.0.0.1:8092/, nhập Orion vào ô Message Composer rồi gửi bằng Enter.`

If Mark Success now succeeds, export the single task-2 review file and continue the six-group Strategy teaching pipeline using original task 1 + replacement task 2 + original task 3.

If Mark Success still fails, the popup now prints the exact pending semantic action and target. Ask the user to send that popup text/screenshot; do not ask for another blind retry.

Target before Strategy fit remains `datasetBuilt:true` and `baselineReady:true`; fit TRAIN only and keep validation/test held out. Do not promote `main`.
