# Observation / UI batch native PASS — 2026-08-26

## Scope

Batch native validation on the fixed PAGE_CDP lab at `http://127.0.0.1:8091`.

Actions:

```text
dismiss
hoverAndObserve
waitAndObserve
```

## Baseline discovery

Initial native batch result:

```text
dismiss           PASS
hoverAndObserve   PASS
waitAndObserve    FAIL → cdp_plan_unsupported:waitAndObserve
```

`dismiss` and `hoverAndObserve` required no capability change.

## waitAndObserve implementation

`waitAndObserve` is an observation-only semantic action. It must not synthesize pointer or keyboard input merely to create an execution step.

The promoted path uses:

```text
Agent Action: waitAndObserve
→ observation-only CDP plan 0.1.3
→ steps = []
→ Runtime accepts the zero-step plan only for waitAndObserve
→ bridge performs bounded semantic polling
```

`waitAndObserve` has a dedicated settle budget separate from ordinary post-action settling:

```text
pollMs       = 80
minWindowMs  = 400
maxWindowMs  = 6000
stableSamples = 2
requireSemanticChange = true
```

Ordinary action settling remains bounded at 800ms.

## Five-second stress gate

A first native retest exposed that reusing the ordinary 800ms settle deadline was incorrect: the result returned while the page was still `WAITANDOBSERVE ARMED`, with `semanticChanged=false` and `deadlineReached=true`.

The test was then deliberately stressed with the page semantic change delayed to about 5 seconds. After assigning the dedicated 6000ms wait budget, native retest captured the delayed change and returned `WAITANDOBSERVE PASS` rather than timing out early.

Regression coverage also delays the synthetic semantic change until about 5.04 seconds and requires the bridge to capture it before the 6000ms deadline.

## Native result

```text
dismiss           PASS
hoverAndObserve   PASS
waitAndObserve    PASS

Observation / UI batch = 3/3 NATIVE PASS
```

For `waitAndObserve`:

```text
cdpPlan.steps = []
execution.ok = true
execution.stepCount = 0
semanticChanged = true
deadlineReached = false
after.title = WAITANDOBSERVE PASS
```

Agent Cursor remaining stationary is correct for this observation-only action.

## Promotion

Selective promotion to `main`:

```text
236a2b05828a2c92f90209633ff3d5db3cdb4ee8
feat(agent): promote native-passed waitAndObserve
```

Main runtime-syntax run `32964722489` completed successfully, including the dispatcher and one-action bridge regression contracts.

## Classification

```text
Observation / UI functional semantics  NATIVE PASS
waitAndObserve delayed semantic wait    PASS
zero-input observation action           PASS
naturalness                              separate Behavior-learning concern
```
