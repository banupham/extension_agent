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

Action correctness and task success stay separate. A successful click can have `actionSucceeded=true` while `taskSucceeded=false` and `progressDelta=0`.

A5.1 also records:

```text
progressBefore
progressDelta = progressAfter - progressBefore
```

This is required for later Replan to distinguish action success from actual task progress.

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

Observation-bound `targetRef` is intentionally not a task success identity because a fresh OBSERVE may issue new refs. Goal criteria prefer semantic descriptors.

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

### No-criteria rule

If `successCriteria=[]`:

```text
actionSucceeded = execution status
taskSucceeded   = false
progress        = 0
progressDelta   = 0
errorCode       = null (unless execution failed)
```

Goal Checker must not invent completion from `execution.ok` alone.

### Invalid-criteria rule

Malformed or unsupported criteria do not silently pass. Outcome remains non-successful and returns:

```text
errorCode = goal_criteria_invalid
```

with compact diagnostic evidence only.

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

The controller is below Goal Checker and above future Replan orchestration. It does not inspect selectors, coordinates, CDP plans, Behavior, or target geometry.

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
  task not complete and the step/outcome has an execution or goal-check error
  terminal=false at A5.2
  shouldReplan=true
  A5.3 budgets decide when repeated failures become terminal

blocked
  explicit blocker evidence exists (for example human_verification_required)
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

A completed goal wins even if the attempted action later reports an error, because no further action is needed.

A5.2 must not classify `progressDelta=0` as terminal failure by itself. Stalled-step limits belong to A5.3 budgets/history.

### A5.2 native gates

Reuse existing one-action execution and A5.1 Goal Checker on the fixed local surface.

```text
moveTo Submit Target
→ execution succeeds
→ goal remains unmatched
→ control.status=continue

submit Submit Target
→ execution succeeds
→ goal becomes matched
→ control.status=done
```

`failed` and `blocked` are contract-tested with synthetic validated Outcome/blocker objects. Do not create new browser failure capability or human-verification fixtures merely to exercise those states.

Native gate output should be compact and show only action/result/evidence/control fields needed for inspection.
