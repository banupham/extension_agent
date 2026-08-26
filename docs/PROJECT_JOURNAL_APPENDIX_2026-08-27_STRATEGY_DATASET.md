# Strategy Dataset / Human Review Appendix — 2026-08-27

## Scope

This appendix records the post-A5.4 Strategy/Brain dataset work on `feat/agent-tab-context`.

`main` remains the stable branch. This work is not promoted to `main` yet.

## Locked data architecture

Raw Training Collector telemetry remains the source-of-truth capture layer:

```text
RAW schema 0.7.2
→ pointer / keyboard / wheel / scroll / DOM / hover / mutation
→ target correlation / frame identity / navigation / stream health / ordered timeline
```

Raw telemetry is not replaced by the Strategy dataset.

Two derived learning paths remain separate:

```text
RAW 0.7.2
├─ Action Windows → Behavior Features → Behavior Policy = HOW
└─ Human Task Episode → verified semantic review → Strategy Episode = WHAT
```

Strategy must not train on raw pointer trajectories as action labels.

## Dataset contract

Implemented on the experiment branch:

```text
control-center/EPISODE_OUTCOME_DATASET_CONTRACT.json
control-center/manager/training/episode_outcome_dataset.js
control-center/manager/training/episode_dataset_export.js
control-center/script/checks/episode_outcome_dataset.js
control-center/script/checks/episode_dataset_export.js
control-center/script/episode_outcome_dataset_gate.js
training-collector/tools/build_strategy_episode_dataset.js
```

The record boundary is:

```text
Task
+ Observation
+ Decision / semantic Agent Action
+ Outcome
+ Control
+ Episode Budget
+ Progress
+ terminalResult
```

Train/validation/test assignment is by `splitGroup`; one group must never cross splits.

`controlled-native`, `test-fixture`, and self-labeled `agent-runtime` records are not model-fit eligible by default.

## Native controlled evidence

User native gate PASS on the controlled `127.0.0.1:8091` surface:

```text
moveTo Submit Target
→ actionSucceeded=true
→ taskSucceeded=false
→ progress=0
→ continue / budget nonterminal

submit Submit Target
→ actionSucceeded=true
→ taskSucceeded=true
→ progress=1
→ done / budget terminal
```

Produced record summary:

```text
source.kind=controlled-native
stepCount=2
terminalResult.status=done
trainingEligibility.eligible=false
```

Architecture/privacy invariants PASS:

```text
deterministicHarnessOnly=true
autonomousMultiStepEnabled=false
controlledNativeRecordNotTrainingEligible=true
noSelectorStored=true
noCdpPlanStored=true
noTabIdStoredInTrainingRecord=true
```

## Human Task Episode capture boundary

Training Collector Task Episode schema was extended without replacing raw capture:

```text
schemaVersion=0.6.0
strategyObservationEncoding=full-per-transition-v1
```

Each transition can retain:

```text
strategyObservationBefore
raw human action evidence
strategyObservationAfter
```

The review export strips selector, tabId, and raw action coordinates and remains non-training-eligible until explicit review.

## Human Strategy review contract

Added:

```text
control-center/HUMAN_STRATEGY_REVIEW_CONTRACT.json
control-center/manager/training/human_strategy_episode_adapter.js
control-center/script/checks/human_strategy_episode_adapter.js
training-collector/tools/make_strategy_review_template.js
training-collector/tools/adapt_task_episode_review.js
training-collector/tests/human_strategy_review_cli_contract.js
```

Locked review rule:

```text
rawAction = evidence only
reviewer verifies semantic Agent Action
reviewer verifies Outcome / Progress
A5.2 derives Control
A5.3 derives Episode Budget
```

The reviewer cannot manually supply Control/Budget labels.

Required explicit confirmations:

```text
taskPrivacyReviewed=true
semanticLabelsVerified=true
outcomeVerified=true
credentialsExcluded=true
secretsExcluded=true
```

A verified Human Strategy record is initially `split=unassigned`, so it is still not training eligible until leakage-safe dataset split assignment.

## CI evidence

Focused `episode-dataset-gate` run `33002464093` PASS on head `1545f0ac`.

PASS coverage includes:

```text
syntax
JSON contracts
Episode/outcome dataset contract
split/export contract
human Strategy episode adapter contract
Strategy observation view contract
Task Episode architecture contract
Task Episode review export/checker contract
human Strategy review CLI contract
strategy dataset file builder contract
```

Full `runtime-syntax` run `33002433414` also PASS on the preceding human-review CLI test head.

## Next native gate

Native Human Task Episode review export is still pending.

Required flow:

```text
Training Collector 0.8.1 reload
→ Start Episode on controlled 8091 page
→ human performs Submit Target action
→ Mark Success
→ Export Task Episode for Review
→ check_task_episode_review.js PASS
→ make_strategy_review_template.js
→ explicit semantic/outcome review
→ adapt_task_episode_review.js
→ resulting human Strategy record validates
```

This native review record must remain `split=unassigned` and `trainingEligibility=false` until a representative multi-group dataset is assembled and split.

## Training gate

The first Strategy model fit is allowed only after:

```text
representative verified human Strategy records
→ privacy / label consistency PASS
→ at least 3 distinct splitGroups
→ deterministic train / validation / test assignment
→ dataset readiness PASS
→ export train.jsonl / validation.jsonl / test.jsonl
→ offline Strategy baseline fit on train.jsonl only
→ held-out validation/test evaluation PASS
```

Autonomous multi-step remains disabled until after held-out Strategy evaluation and later bounded runtime integration gates.
