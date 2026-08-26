# A5 Goal Checker + Replan — 2026-08-26

## A5.1 Goal Checker Contract

### Purpose

A5.1 adds semantic post-action evaluation only. It does **not** choose the next action and does **not** enable autonomous multi-step execution.

```text
Task.successCriteria
+ BEFORE semantic evidence
+ execution result
+ AFTER semantic evidence
→ Goal Checker
→ Outcome
```

Existing boundary remains:

```text
Strategy = WHAT
Behavior = HOW
Planner = exact execution plan
Executor = dispatch
Goal Checker = evaluate outcome only
```

Goal Checker must never emit selectors, coordinates, CDP packets, browser API packets, or a next Agent Action.

### Outcome semantics

A5.1 reuses `validateOutcome()` from `manager/strategy/contracts.js`:

```text
actionSucceeded
  = whether the requested execution completed successfully

taskSucceeded
  = whether all explicit task success criteria match AFTER evidence

progress
  = matched AFTER criteria / total criteria

evidence
  = compact machine-readable criterion results

errorCode
  = execution/config error only; not private reasoning
```

Action correctness and task success stay separate. A successful action can have `actionSucceeded=true` while `taskSucceeded=false` and `progressDelta=0`.

A5.1 also records:

```text
progressBefore
progressDelta = progressAfter - progressBefore
```

This is required for later Replan to distinguish execution success from actual task progress.

### Success criteria v0.1.0

Aggregation is `all` only for A5.1.

Supported semantic criterion families:

```text
page
  field: url | title
  operator: equals | includes

pageSignal
  key: semantic Observer pageSignals key
  operator: equals

element
  match: label / labelIncludes / role / tag
  expect: exists / visible / enabled / editable / checked / selectedValue / selectedIndex / focused

browserTab
  match: title/titleIncludes/url/urlIncludes
  expect: exists / active
```

No selector, coordinate, target geometry, frame path, tabId, raw CDP, raw browser packet, text/password value, cookie/token, clipboard, or credential content belongs in success criteria or Goal Checker evidence.

Observation-bound `targetRef` is intentionally not a task-success identity because a fresh OBSERVE may issue new refs. Goal criteria prefer semantic descriptors.

### Evidence rule

Per-criterion evidence is intentionally compact:

```text
criterionIndex
criterionType
source
beforeMatched
afterMatched
changed
code
```

Do not serialize full matched DOM objects into Outcome evidence.

### No-criteria / invalid-criteria rules

If `successCriteria=[]`, Goal Checker must not invent completion from `execution.ok` alone.

Malformed or unsupported criteria remain non-successful and return:

```text
errorCode = goal_criteria_invalid
```

### A5.1 native evidence — PASS

Fixed local surface: `http://127.0.0.1:8091`.

Negative control:

```text
moveTo Submit Target
execution.ok=true
title: PAGE_CDP Batch Lab → PAGE_CDP Batch Lab
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
title: PAGE_CDP Batch Lab → SUBMIT PASS
actionSucceeded=true
taskSucceeded=true
progress=1
progressDelta=1
result=PASS
```

Decision: A5.1 semantic Goal Checker native gate is closed.

---

## A5.2 Outcome → Control Status

### Purpose

A5.2 converts one validated `Outcome` into a compact control state. It still does **not** choose the next semantic Agent Action and does **not** run another step.

```text
Outcome
+ optional explicit blocker evidence
→ Outcome Controller
→ done | continue | failed | blocked
```

The controller does not inspect selectors, coordinates, CDP plans, Behavior, or target geometry.

### Control semantics v0.1.0

```text
done
  taskSucceeded=true
  terminal=true
  shouldReplan=false

continue
  actionSucceeded=true
  taskSucceeded=false
  errorCode=null
  terminal=false
  shouldReplan=true

failed
  task incomplete and the step/outcome has an execution or goal-check error
  terminal=false at A5.2
  shouldReplan=true
  A5.3 budgets decide when repeated failures become terminal

blocked
  explicit blocker evidence exists
  terminal=true
  shouldReplan=false
```

Precedence:

```text
1 task already succeeded → done
2 explicit blocker → blocked
3 action/outcome error → failed
4 otherwise → continue
```

A completed goal wins even if an attempted action later reports an error, because no further action is needed.

`progressDelta=0` alone is not a terminal failure; stalled-step limits belong to A5.3.

### A5.2 native evidence — PASS

```text
moveTo Submit Target
executionOk=true
beforeMatched=false
afterMatched=false
actionSucceeded=true
taskSucceeded=false
progress=0
progressDelta=0
control.status=continue
control.terminal=false
control.shouldReplan=true
reasonCode=goal_not_yet_satisfied
result=PASS
```

```text
submit Submit Target
executionOk=true
beforeMatched=false
afterMatched=true
actionSucceeded=true
taskSucceeded=true
progress=1
progressDelta=1
control.status=done
control.terminal=true
control.shouldReplan=false
reasonCode=goal_satisfied
result=PASS
```

The `done` gate requires a real semantic transition `beforeMatched=false → afterMatched=true`; an already-satisfied page cannot false-PASS the positive native gate.

Decision: A5.2 native gate is closed.

---

## A5.3 Step History + Budgets

### Purpose

A5.3 records compact step summaries and decides whether another replan is permitted. It does **not** choose the next action and does **not** execute another step.

```text
A5.2 control
+ compact prior step history
+ episode start/current time
+ explicit budgets
→ Episode Budget Guard
→ done | blocked | continue | failed-terminal
```

### Compact step history

Each recorded step contains only control/training-safe summary fields:

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

Do not store selectors, coordinates, CDP plans, browser packets, full observations, credentials, printable human key content, or private reasoning in A5.3 step history.

### Budget families v0.1.0

```text
maxSteps
maxDurationMs
maxConsecutiveFailures
maxReplans
maxStalledSteps
```

Default values:

```text
maxSteps                 = 8
maxDurationMs            = 120000
maxConsecutiveFailures   = 2
maxReplans               = 6
maxStalledSteps          = 3
```

A progress-positive `continue` resets the stalled-step counter. A `failed` step is handled by the failure counter rather than also counting as stalled.

### Precedence

```text
1 A5.2 done    → terminal success; budgets do not override success
2 A5.2 blocked → terminal blocked
3 budget exhausted → terminal failed
4 otherwise → continue and permit one replan
```

Budget exhaustion reason codes:

```text
budget_max_duration_reached
budget_max_steps_reached
budget_consecutive_failures_reached
budget_stalled_progress_reached
budget_max_replans_reached
```

### A5.3 contract evidence — PASS

A5.3 is a pure control/history contract; no browser input is required for this gate. The local contract gate was reported PASS and covers:

```text
ordinary continue
success at step limit
top-priority blocker
max steps
max duration
consecutive failures
stalled progress
stall reset after progress
max replans
failure reset after progress
```

Branch CI run `32990019645` also completed SUCCESS after the A5.3 contract was present on the experimental branch.

Decision: A5.3 contract gate is closed.

---

## NEXT — A5.4 explicit one-step replan orchestration

A5.4 may call Strategy only after A5.3 grants:

```text
terminal=false
shouldReplan=true
```

It must preserve:

```text
one semantic action per loop
explicit history/budgets
Goal Checker does not choose action
Episode Budget does not call Strategy
no unbounded autonomous loop
```

Autonomous multi-step remains a later milestone after bounded replan evidence and episode/outcome dataset validation.
