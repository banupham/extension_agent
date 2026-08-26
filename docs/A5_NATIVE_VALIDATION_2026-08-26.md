# A5 Goal Checker / Control / Budget Validation — 2026-08-26

## Scope

This evidence closes A5.1, A5.2 and A5.3 only. It does not enable autonomous multi-step execution.

```text
A5.1 semantic Goal Checker
→ A5.2 Outcome Controller
→ A5.3 compact Step History + Episode Budget Guard
→ NEXT: A5.4 explicit one-step replan orchestration
```

## A5.1 Goal Checker — PASS

Controlled surface: `http://127.0.0.1:8091`.

Negative control:

```text
moveTo Submit Target
execution.ok=true
page title unchanged
actionSucceeded=true
taskSucceeded=false
progress=0
progressDelta=0
result=PASS
```

Positive goal:

```text
submit Submit Target
execution.ok=true
page title: PAGE_CDP Batch Lab → SUBMIT PASS
actionSucceeded=true
taskSucceeded=true
progress=1
progressDelta=1
result=PASS
```

Decision: execution success is not treated as task success unless explicit semantic success criteria match AFTER evidence.

## A5.2 Outcome Controller — PASS

Native negative/continue gate:

```text
moveTo Submit Target
beforeMatched=false
afterMatched=false
control.status=continue
control.terminal=false
control.shouldReplan=true
reasonCode=goal_not_yet_satisfied
result=PASS
```

Native positive/done gate:

```text
submit Submit Target
beforeMatched=false
afterMatched=true
control.status=done
control.terminal=true
control.shouldReplan=false
reasonCode=goal_satisfied
result=PASS
```

The positive gate requires a real semantic transition `false → true`, preventing an already-satisfied page from false-PASSing.

`failed` and `blocked` remain contract-tested states; no artificial browser failure or human-verification fixture is introduced merely for testing.

## A5.3 Step History + Episode Budgets — PASS

A5.3 is a pure control/history contract and therefore does not require a browser pointer gate. The local contract gate was reported PASS after implementation.

Covered budget families:

```text
maxSteps
maxDurationMs
maxConsecutiveFailures
maxReplans
maxStalledSteps
```

Covered semantics include:

```text
ordinary continue permits one future replan
terminal done wins over budget exhaustion
blocked terminates immediately
maxSteps exhaustion
maxDurationMs exhaustion
consecutive failure exhaustion
stalled-progress exhaustion
stalled counter reset after positive progress
maxReplans exhaustion
failure counter reset after successful progress
```

Compact history intentionally stores only:

```text
stepIndex
recordedAtMs
actionType
controlStatus
actionSucceeded
taskSucceeded
progress
progressDelta
reasonCode
errorCode
shouldReplan
```

It does not store selectors, coordinates, CDP plans, browser packets, full observations, credentials, printable human key content, or private reasoning.

## Decision

```text
A5.1 Goal Checker                 COMPLETE / PASS
A5.2 Outcome → control status     COMPLETE / PASS
A5.3 Step history + budgets       COMPLETE / PASS
A5.4 explicit one-step replan     NEXT / NOT STARTED
Autonomous multi-step             NOT STARTED
```

A5.4 may call Strategy for at most one next decision after A5.3 grants `shouldReplan=true`. It must preserve one semantic action per loop and explicit budgets before any broader autonomous execution is considered.
