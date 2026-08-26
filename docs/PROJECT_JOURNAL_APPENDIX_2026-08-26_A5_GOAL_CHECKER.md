# A5.1 Goal Checker Contract — 2026-08-26

## Purpose

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

## Outcome semantics

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

## Success criteria v0.1.0

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

## Evidence rule

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

## No-criteria rule

If `successCriteria=[]`:

```text
actionSucceeded = execution status
taskSucceeded   = false
progress        = 0
progressDelta   = 0
errorCode       = null (unless execution failed)
```

Goal Checker must not invent completion from `execution.ok` alone.

## Invalid-criteria rule

Malformed or unsupported criteria do not silently pass. Outcome remains non-successful and returns:

```text
errorCode = goal_criteria_invalid
```

with compact diagnostic evidence only.

## A5.1 native gate

Use an existing one-action flow on the fixed local surface `http://127.0.0.1:8091`.

Positive gate example:

```text
submit Submit Target
→ page title becomes SUBMIT PASS
→ criterion: page.title includes SUBMIT PASS
→ actionSucceeded=true
→ taskSucceeded=true
→ progress=1
```

Negative-control example:

```text
moveTo Submit Target
→ execution succeeds but title does not become SUBMIT PASS
→ actionSucceeded=true
→ taskSucceeded=false
→ progress=0
```

A5.1 closes only after contract/CI plus native positive and negative-control evidence.
