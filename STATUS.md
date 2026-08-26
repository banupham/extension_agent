# STATUS — 2026-08-27

## Source of truth

GitHub `banupham/extension_agent` is the implementation source of truth.

Before implementation changes:

```text
STATUS.md
→ docs/PROJECT_JOURNAL.md / focused appendices
→ current source/tests on main
```

Recent A5 evidence:

```text
docs/A5_NATIVE_VALIDATION_2026-08-26.md
docs/PROJECT_JOURNAL_APPENDIX_2026-08-27_A5_4_REPLAN.md
```

Older focused native evidence remains under `docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_*`.

---

# CURRENT FOCUS — episode/outcome dataset validation after A5.4

```text
A0 Agent/Behavior contracts             COMPLETE
A1 Action Window 0.1.4                  COMPLETE
A2 Behavior Feature 0.2.0               COMPLETE
A3 Empirical baseline contract          READY
P0 Agent Runtime                        SCOPED FUNCTION MATRIX NATIVE PASS
A4 One-action bridge                    SCOPED FUNCTION MATRIX NATIVE PASS
A5.1 Semantic Goal Checker              COMPLETE / NATIVE PASS
A5.2 Outcome → control status           COMPLETE / NATIVE PASS
A5.3 Step history + episode budgets     COMPLETE / CONTRACT PASS
A5.4 Explicit one-step replan           COMPLETE / NATIVE PASS
Episode/outcome dataset validation      NEXT
Autonomous multi-step                   NOT STARTED
```

Collector V0.8 transport/capture remains complete and only needs stability/regression support.

Functional Agent PASS != Brain-quality PASS != natural-behavior PASS.

---

# Scoped functional executor state

The semantic Agent Action Contract remains 35 actions:

```text
navigation 7
navigate
back
forward
reload
switchTab
openNewTab
closeTab

pointer 5
click
doubleClick
hover
moveTo
drag

scroll 3
scrollVertical
scrollHorizontal
scrollIntoView

keyboard 6
focus
typeText
replaceText
clear
pressKey
keyCombo

forms 4
selectOption
setChecked
toggle
submit

media 7
play
pause
mute
unmute
setVolume
seek
changePlaybackRate

observation/ui 3
hoverAndObserve
waitAndObserve
dismiss
```

Scoped PAGE_CDP/browser-native functional coverage is closed at 35/35.

Native functional evidence also includes:

```text
semantic OBSERVE and observation-bound target refs
post-action settled re-observation
stale-ref rejection after newer observation
same-origin iframe observation + PAGE_CDP click
nested same-origin iframe depth 2 observation + visible cursor click
moving-target guard on existing guarded pointer/drag paths
form/media observed-state binding
Agent Cursor V0.1 visualization
browser-native tab lifecycle switch/open/close
```

Forms 4/4, Observation/UI 3/3, Media 7/7 and browser-native tab lifecycle 3/3 are native PASS.

Cross-origin/OOPIF frame support is not claimed.

---

# A5 — Goal Checker + Replan control

## A5.1 Semantic Goal Checker — COMPLETE

Contract/source:

```text
control-center/GOAL_CHECKER_CONTRACT.json
control-center/manager/goal/goal_checker.js
control-center/script/checks/goal_checker.js
control-center/script/goal_checker_gate.js
```

Input/output:

```text
Task.successCriteria
+ BEFORE semantic evidence
+ execution result
+ AFTER semantic evidence
→ Outcome
```

Outcome keeps action success separate from task success:

```text
actionSucceeded
taskSucceeded
progress
evidence
errorCode
metadata.progressBefore
metadata.progressDelta
```

Supported success-criterion families:

```text
page        → url/title equals/includes
pageSignal  → semantic pageSignals equals
element     → semantic label/role/tag + state expectations
browserTab  → semantic title/url + exists/active
```

Goal criteria do not use selector, coordinate, frame path, tabId, raw CDP/browser packets, password/cookie/token/clipboard or printable private input values.

Native controlled evidence:

```text
moveTo Submit Target
→ execution succeeded
→ title goal remained unmatched
→ actionSucceeded=true
→ taskSucceeded=false
→ progressDelta=0

submit Submit Target
→ execution succeeded
→ title changed PAGE_CDP Batch Lab → SUBMIT PASS
→ beforeMatched=false
→ afterMatched=true
→ actionSucceeded=true
→ taskSucceeded=true
→ progressDelta=1
```

This proves `execution.ok` alone does not imply task completion.

## A5.2 Outcome Controller — COMPLETE

Contract/source:

```text
control-center/OUTCOME_CONTROL_CONTRACT.json
control-center/manager/goal/outcome_controller.js
control-center/script/checks/outcome_controller.js
control-center/script/outcome_control_gate.js
```

Control statuses:

```text
done
  terminal=true
  shouldReplan=false

continue
  terminal=false
  shouldReplan=true

failed
  terminal=false at A5.2
  shouldReplan=true

blocked
  terminal=true
  shouldReplan=false
```

Precedence:

```text
goal satisfied
→ explicit blocker
→ step/outcome failure
→ continue
```

Native controlled evidence:

```text
moveTo → continue / shouldReplan=true
submit → done / terminal=true / shouldReplan=false
```

The `done` native gate requires a real semantic `beforeMatched=false → afterMatched=true` transition.

## A5.3 Step History + Episode Budget Guard — COMPLETE

Contract/source:

```text
control-center/EPISODE_BUDGET_CONTRACT.json
control-center/manager/goal/episode_budget.js
control-center/script/checks/episode_budget.js
```

Default budget families:

```text
maxSteps                 8
maxDurationMs            120000
maxConsecutiveFailures   2
maxReplans               6
maxStalledSteps          3
```

Compact history fields only:

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

No selector, coordinate, CDP plan, browser packet, full observation, credential data or private reasoning is stored in A5.3 history.

Budget semantics:

```text
done    → terminal success; budget does not override achieved goal
blocked → terminal immediately
budget exhaustion → terminal failed
otherwise → continue; at most one next replan may be permitted
```

Exhaustion reason codes:

```text
budget_max_duration_reached
budget_max_steps_reached
budget_consecutive_failures_reached
budget_stalled_progress_reached
budget_max_replans_reached
```

Contract coverage includes every exhaustion path plus failure/stall counter resets after successful progress.

## A5.4 Explicit one-step replan — COMPLETE / NATIVE PASS

Contract/source:

```text
control-center/ONE_STEP_REPLAN_CONTRACT.json
control-center/manager/agent/one_step_replan.js
control-center/script/checks/one_step_replan.js
control-center/script/one_step_replan_gate.js
```

A5.4 orchestrates one bounded next Strategy decision only after A5.3 returns:

```text
terminal=false
shouldReplan=true
```

Locked shape:

```text
Task
→ OBSERVE
→ Strategy chooses ONE semantic Agent Action
→ Behavior/Execution
→ execute
→ settled OBSERVE AFTER
→ A5.1 Goal Checker
→ A5.2 Outcome Controller
→ A5.3 Episode Budget Guard
→ if permitted: ONE explicit Strategy decision
→ validate semantic Agent Action
→ return Decision
→ STOP
```

Native controlled evidence on `http://127.0.0.1:8091`:

```text
moveTo Submit Target
→ execution.ok=true
→ page title remains PAGE_CDP Batch Lab
→ actionSucceeded=true / taskSucceeded=false
→ control=continue / shouldReplan=true
→ budget non-terminal / shouldReplan=true
→ Strategy called exactly once
→ returned action=submit with Agent Action contractVersion
→ nextActionExecuted=false
→ result=PASS
```

Enforced invariants:

```text
boundedStrategyCalls=true
oneSemanticActionPerLoop=true
nextActionExecuted=false
returnedActDecisionUsesSemanticAgentAction=true
goalCheckerChoseAction=false
episodeBudgetCalledStrategy=false
```

Focused A5 CI also passes syntax, contract JSON and A5.1-A5.4 regressions. Full evidence is recorded in:

```text
docs/PROJECT_JOURNAL_APPENDIX_2026-08-27_A5_4_REPLAN.md
```

A5.4 is not an autonomous loop. Broader autonomous multi-step remains a later milestone after episode/outcome dataset validation and held-out evaluation.

---

# Architecture boundary

```text
TASK
→ BROWSER CONTEXT / TAB INVENTORY
→ OBSERVER
→ STRATEGY / BRAIN
→ AGENT ACTION CONTRACT        = WHAT
→ EXECUTION BEHAVIOR CONTRACT = HOW / allowed variant
→ PAGE_CDP PLAN or BROWSER ACTION ENVELOPE
→ AGENT RUNTIME EXTENSION      = dispatch + narrow binding
→ CHROME
→ SETTLED OBSERVE AFTER / BROWSER CONTEXT AFTER
→ GOAL CHECK
→ OUTCOME CONTROL
→ EPISODE BUDGET
→ bounded REPLAN
```

Hard invariant:

```text
Strategy does NOT emit selector / coordinate / CDP packet.
Behavior does NOT choose task intent.
Executor does NOT choose strategy.
Goal Checker does NOT choose next action.
Episode Budget does NOT call Strategy.
```

`tabId` remains internal execution identity.

---

# Runtime / observation baseline

Runtime dispatcher accepts PAGE_CDP plan versions:

```text
0.1.0
0.1.1
0.1.2
0.1.3
```

Allowlisted execution methods remain:

```text
Input.dispatchMouseEvent
Input.dispatchKeyEvent
Input.insertText
Page.navigate
Page.reload
Page.getNavigationHistory
Page.navigateToHistoryEntry
```

Browser-native tab lifecycle remains:

```text
switchTab  → chrome.tabs.update
openNewTab → chrome.tabs.create
closeTab   → chrome.tabs.remove
```

No arbitrary raw-CDP tunnel from Strategy/Brain.

Ordinary post-action semantic settling:

```text
poll 80 ms
minimum 400 ms
semantic stability >= 2 samples
maximum 800 ms
```

`waitAndObserve` remains observation-only with a dedicated 6000 ms bounded settle window.

Agent Cursor mirrors actual PAGE_CDP pointer dispatch only; it is telemetry and never generates input or affects Observer/Strategy.

---

# Experimental branch-only evidence

Reusable experimental branch remains:

```text
feat/agent-tab-context
```

Do not merge the whole branch blindly.

## Browser UI / OS

Windows UIA + Win32 SendInput experiments are native PASS for previously tested shell controls, including Back/Forward and tab-strip `switchTab/openNewTab/closeTab`. They remain experimental and are not integrated into ordinary Runtime/main execution.

Any future OS-input execution still requires an explicit desktop-input design/consent boundary.

## `follow-live` target tracking

Experimental Behavior/Execution variant:

```text
targetTracking=fixed       → existing baseline behavior
targetTracking=follow-live → live pointer correction while target moves
```

Native visual spike evidence on the experimental branch:

```text
submit + follow-live          PASS
hoverAndObserve + follow-live PASS
```

This variant is intentionally not promoted into `main` yet. Semantic actions remain `submit` and `hoverAndObserve`; tracking is HOW, not WHAT.

The earlier generic stale-geometry guard expansion for `replaceText`, `clear`, `submit`, `hoverAndObserve` was not retained on the experimental branch after visual testing. Do not claim those four actions have the same generic moving-target rejection invariant as the already-guarded pointer/state paths.

---

# Development / branch rule

Use only:

```text
main
feat/agent-tab-context
```

Workflow:

```text
main existing functionality
→ native/contract test first
→ PASS: record evidence and continue
→ implementation failure: use reusable experimental branch
→ fix + contract/CI + native re-test
→ selectively promote only native/contract-proven files
```

Controlled local webpage tests reuse:

```text
http://127.0.0.1:8091
```

No extra local test ports should be introduced without a real requirement.

---

# Training position

Behavior data pipeline already exists:

```text
human demonstrations
→ Collector raw
→ A1 Action Windows
→ A2 Behavior Features
→ A3 empirical/context-conditioned baseline
```

Naturalness remains a Behavior-learning milestone, not a functional executor gate.

A5.4 bounded replan is now validated. The next training-oriented gate is episode/outcome dataset validation and held-out evaluation before broader autonomous execution. Reliable episode records should contain:

```text
Task
Observation
Decision
Action
Outcome
Progress
terminal result
```

---

# Deferred / on-demand gates

These do not block the next episode/outcome dataset gate:

```text
cross-origin/OOPIF frame observation when a real task requires it
focus primitive metadata cleanup
physical-key-like typeText variant when listener fidelity is required
pointer/scroll/drag/range naturalness through Behavior learning
follow-live expansion to additional pointer actions only with real evidence
Browser UI/OS Runtime integration only after explicit design review
```

---

# Safety / privacy

CAPTCHA/human verification remains blocked; no automatic solve/bypass/blind retry.

Never collect or train on credential/password/cookie/token/clipboard/payment-secret content.
