# PROJECT JOURNAL APPENDIX — A5.4 explicit one-step replan

Date: 2026-08-27

## Scope

This appendix records closure evidence for A5.4 only.

```text
A5.1 Semantic Goal Checker
→ A5.2 Outcome Controller
→ A5.3 Episode Budget Guard
→ A5.4 at most ONE explicit Strategy replan decision
→ STOP
```

A5.4 does not execute the returned next action and does not enable an autonomous multi-step loop.

---

## Locked architecture boundary

```text
completed one-action step
→ settled semantic AFTER evidence
→ Goal Checker
→ Outcome Controller
→ Episode Budget
→ if terminal=false and shouldReplan=true
→ resolve semantic observation
→ Strategy.decide exactly once
→ validate returned act decision as semantic Agent Action
→ return Decision
→ STOP
```

Hard invariants:

```text
max Strategy calls per A5.4 invocation = 1
next action executed by A5.4            = false
returned act decision                   = semantic Agent Action only
Strategy selector/coordinate/raw CDP    = rejected
Goal Checker chooses next action        = false
Episode Budget calls Strategy           = false
unbounded autonomous loop               = false
```

If the settled step result has no semantic AFTER observation, A5.4 requires an explicit fresh observation callback before Strategy is called.

---

## Contract coverage

Contract/source:

```text
control-center/ONE_STEP_REPLAN_CONTRACT.json
control-center/manager/agent/one_step_replan.js
control-center/script/checks/one_step_replan.js
```

Covered cases:

```text
goal already done        → no Strategy call
explicit blocker         → no Strategy call
budget exhaustion        → no Strategy call
ordinary continue        → exactly one Strategy call
settled AFTER available  → use settled-after observation
browser-context step     → exactly one fresh observe when AFTER page observation is absent
selector-bearing action  → replan_decision_invalid
Strategy provider throws → replan_strategy_failed, no retry
returned act decision    → Agent Action Contract validation required
next action              → never executed by A5.4
```

Selector, raw coordinate, raw CDP and execution-surface/variant fields remain below Strategy and are rejected by the Agent Action Contract.

---

## Focused CI evidence

Experimental branch focused gate was hardened so changes to the A5.4 native gate and semantic action boundary trigger A5 regression coverage.

```text
workflow: a5-replan-gate
run:      32996076222
head:     35d36eda9f7d31f3b990836798ca7b227cc08fb9
result:   SUCCESS
```

Successful steps included:

```text
A5 JavaScript syntax
A5 contract JSON validation
A5.1 Goal Checker regression
A5.2 Outcome Controller regression
A5.3 Episode Budget regression
A5.4 explicit one-step replan contract
```

---

## Native Chrome/GPM evidence

Controlled surface:

```text
http://127.0.0.1:8091/
```

Native gate:

```bat
node control-center\script\one_step_replan_gate.js --url-includes 127.0.0.1:8091
```

Native result reported on the hardened A5.4 gate:

```text
ok=true
result=PASS

first action                    = moveTo Submit Target
first execution.ok              = true
before title                    = PAGE_CDP Batch Lab
after title                     = PAGE_CDP Batch Lab

outcome.actionSucceeded         = true
outcome.taskSucceeded           = false
outcome.progress                = 0

control.status                  = continue
control.terminal                = false
control.shouldReplan            = true

budget.status                   = continue
budget.terminal                 = false
budget.shouldReplan             = true
usage.steps                     = 1
usage.replansRequested          = 1
usage.consecutiveFailures       = 0
usage.stalledSteps              = 1

replan.permitted                = true
replan.attempted                = true
replan.strategyCallCount        = 1
replan.observationSource        = settled-after
returned decision.status        = act
returned action.type            = submit
returned action.contractVersion = present
```

Native invariant evidence:

```text
boundedStrategyCalls                         = true
oneSemanticActionPerLoop                     = true
nextActionExecuted                           = false
returnedActDecisionUsesSemanticAgentAction   = true
goalCheckerChoseAction                       = false
episodeBudgetCalledStrategy                  = false
```

This proves the intended bounded transition:

```text
moveTo succeeds
→ explicit goal remains unmet
→ continue / shouldReplan
→ budget grants one replan
→ Strategy returns semantic submit
→ A5.4 stops without executing submit
```

---

## Selective promotion to main

The experimental branch was not merged wholesale. Direct A5.4 dependencies were compared against main first; the following dependency blobs were identical between main and the tested branch:

```text
manager/strategy/contracts.js
manager/strategy/agent_action_contract.js
manager/goal/goal_checker.js
manager/goal/outcome_controller.js
manager/goal/episode_budget.js
manager/agent/one_action_bridge.js
manager/agent/broker_runtime_client.js
script/agent_one_action.js
```

Promoted A5.4/reproducibility files:

```text
control-center/ONE_STEP_REPLAN_CONTRACT.json
control-center/manager/agent/one_step_replan.js
control-center/script/checks/one_step_replan.js
control-center/script/one_step_replan_gate.js
control-center/script/page_cdp_test_lab.js
.github/workflows/a5-replan-gate.yml
.github/workflows/extension-syntax.yml  (A5.4 coverage added without replacing main coverage)
```

Experimental Browser UI/OS and follow-live execution work was not promoted as part of A5.4.

---

## Milestone decision

```text
A5.4 explicit one-step replan    COMPLETE / NATIVE PASS
Autonomous multi-step            NOT STARTED
```

Next planned gate is episode/outcome dataset validation and held-out evaluation before broader autonomous execution.

Required episode-level record shape remains:

```text
Task
Observation
Decision
Action
Outcome
Progress
terminal result
```
