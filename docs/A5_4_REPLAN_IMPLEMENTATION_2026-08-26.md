# A5.4 Explicit One-Step Replan — implementation checkpoint — 2026-08-26

## Status

```text
implementation              COMPLETE on feat/agent-tab-context
focused contract coverage   ADDED
local orchestration smoke   PASS
native Chrome/GPM gate      PENDING
promotion to main           PENDING native PASS
```

This checkpoint does **not** claim autonomous multi-step execution.

## Added implementation

```text
control-center/ONE_STEP_REPLAN_CONTRACT.json
control-center/manager/agent/one_step_replan.js
control-center/script/checks/one_step_replan.js
control-center/script/one_step_replan_gate.js
```

A focused branch CI definition also exists at:

```text
.github/workflows/a5-replan-gate.yml
```

Connector-created commits do not trigger GitHub Actions automatically in the current development session, so absence of a run is not treated as PASS.

## Orchestration boundary

```text
completed one-action step
→ A5.1 evaluateGoal()
→ A5.2 reduceOutcomeToControl()
→ A5.3 evaluateEpisodeBudget()
→ only if terminal=false && shouldReplan=true
→ resolve semantic observation
→ call Strategy.decide() exactly once
→ return Decision
```

A5.4 does not execute the returned next action.

## Locked invariants

```text
max Strategy calls per A5.4 invocation = 1
next action executed by A5.4            = false
Goal Checker chooses next action        = false
Episode Budget calls Strategy           = false
unbounded autonomous loop               = false
```

If the previous action has a settled page AFTER observation, that semantic observation is passed to Strategy. If the previous action only produced browser-context evidence (for example tab lifecycle), A5.4 requires one fresh semantic OBSERVE before Strategy is called.

## Focused contract cases

The focused contract covers:

```text
done                    → 0 Strategy calls
blocked                 → 0 Strategy calls
budget exhausted        → 0 Strategy calls
ordinary continue       → exactly 1 Strategy call
browser-context step    → fresh OBSERVE → exactly 1 Strategy call
Strategy provider error → no retry; call count remains 1
```

A local reconstructed orchestration smoke using the current A5 API shape reported:

```text
A5.4 explicit bounded one-step replan contract: PASS
```

This is implementation evidence only; official A5.4 completion still requires the native gate below.

## Native gate

Controlled surface remains the fixed project lab:

```text
http://127.0.0.1:8091
```

Start/reuse the existing page lab, open the page in a Chrome/GPM instance connected to Agent Runtime, then run:

```bat
node control-center\script\one_step_replan_gate.js --url-includes 127.0.0.1:8091
```

Expected native sequence:

```text
OBSERVE
→ first action = moveTo Submit Target
→ execution succeeds but title remains PAGE_CDP Batch Lab
→ A5.1 taskSucceeded=false
→ A5.2 continue / shouldReplan=true
→ A5.3 non-terminal / replan permitted
→ A5.4 calls Strategy exactly once
→ Strategy returns semantic submit action for fresh observation-bound Submit Target
→ A5.4 does NOT execute submit
```

Native PASS requires:

```text
first execution ok=true
outcome.taskSucceeded=false
control.status=continue
budget.terminal=false
budget.shouldReplan=true
replan.permitted=true
replan.strategyCallCount=1
returned decision.status=act
returned decision.action.type=submit
invariant.nextActionExecuted=false
invariant.boundedStrategyCalls=true
```

## Promotion rule

Do not merge the experimental branch wholesale. After native PASS, selectively promote only the A5.4-proven files plus main CI/docs updates, then update `STATUS.md` from:

```text
A5.4 Explicit one-step replan  NEXT / NOT STARTED
```

to an evidence-backed completed state.

Autonomous multi-step remains a later milestone after bounded replan evidence and episode/outcome dataset validation.
