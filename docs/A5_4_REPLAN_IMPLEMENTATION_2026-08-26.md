# A5.4 Explicit One-Step Replan — implementation checkpoint — 2026-08-26

## Status

```text
implementation              COMPLETE on feat/agent-tab-context
focused contract coverage   ADDED + semantic-action hardening
historical focused CI       PASS (run 32992544707)
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

The initial focused A5.4 workflow completed successfully as GitHub Actions run `32992544707`. Later connector-created hardening commits may not immediately receive a workflow run; absence of a run for those commits is not treated as PASS.

## Orchestration boundary

```text
completed one-action step
→ A5.1 evaluateGoal()
→ A5.2 reduceOutcomeToControl()
→ A5.3 evaluateEpisodeBudget()
→ only if terminal=false && shouldReplan=true
→ resolve semantic observation
→ call Strategy.decide() exactly once
→ validate returned act decision against Agent Action Contract
→ return Decision
```

A5.4 does not execute the returned next action.

## Locked invariants

```text
max Strategy calls per A5.4 invocation = 1
next action executed by A5.4            = false
returned act decision                   = semantic Agent Action only
Strategy selector/coordinate/raw CDP    = rejected
Goal Checker chooses next action        = false
Episode Budget calls Strategy           = false
unbounded autonomous loop               = false
```

If the previous action has a settled page AFTER observation, that semantic observation is passed to Strategy. If the previous action only produced browser-context evidence (for example tab lifecycle), A5.4 requires one fresh semantic OBSERVE before Strategy is called.

## 2026-08-27 semantic-action hardening

Review of the experimental implementation found that `Strategy.decide()` output was validated only by the generic Strategy Decision contract. A `status=act` decision therefore still needed an explicit Agent Action Contract check before it could be considered a valid bounded replan result.

Hardening on `feat/agent-tab-context` now requires every returned `act` decision to pass `validateAgentAction()` before A5.4 exposes it as the next Decision.

This locks the existing architecture boundary:

```text
Strategy = WHAT
Agent Action = semantic intent
Behavior/Execution = HOW
```

Rejected replan payloads include selector, raw coordinates, raw CDP method, or execution-surface/variant fields. Decision-contract rejection returns compact `replan_decision_invalid`; provider exceptions return `replan_strategy_failed`. Neither path retries Strategy and neither path executes an action.

Relevant hardening commits:

```text
f276c96d8fe41d069e3f5308104bfc0946ff73b0  require semantic Agent Action from A5.4 replan
a376fd9a966d35a0c3dcd2fb111aa0ed9e38acc9  reject non-semantic A5.4 replan actions in regression coverage
6133164621b44e21b5e368627bff1a963e042132  lock semantic A5.4 replan decision boundary in contract
```

## Focused contract cases

The focused contract covers:

```text
done                         → 0 Strategy calls
blocked                      → 0 Strategy calls
budget exhausted             → 0 Strategy calls
ordinary continue            → exactly 1 Strategy call
browser-context step         → fresh OBSERVE → exactly 1 Strategy call
valid semantic act decision  → normalized Agent Action returned, not executed
selector-bearing act         → replan_decision_invalid, no execution
Strategy provider error      → replan_strategy_failed, no retry
```

The earlier local reconstructed orchestration smoke using the A5 API shape reported:

```text
A5.4 explicit bounded one-step replan contract: PASS
```

The semantic-action hardening has regression code committed, but the newest hardening head must not be called CI PASS until a workflow run is attached to that head.

This remains implementation/contract evidence only; official A5.4 completion still requires the native gate below.

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
→ Agent Action Contract validates returned submit action
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
returned decision.action.contractVersion present
invariant.returnedActDecisionUsesSemanticAgentAction=true
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
