# STATUS — 2026-08-26

## Source of truth

GitHub `banupham/extension_agent` là source chính.

Trước khi sửa code:

```text
STATUS.md
→ docs/PROJECT_JOURNAL.md
→ source/tests hiện tại trên main
```

---

# CURRENT FOCUS — AGENT / A4 one-action functional native validation

Collector V0.8 đã qua transport/capture gate và chỉ còn stability/regression support.

```text
A0 Agent/Behavior contracts        COMPLETE
A1 Action Window 0.1.4             COMPLETE
A2 Behavior Feature 0.2.0          COMPLETE
A3 Empirical baseline contract     READY
P0 Agent Runtime                   IN NATIVE VALIDATION
A4 One-action bridge               IN NATIVE VALIDATION
A5 Goal Checker + Replan           NOT STARTED
Autonomous multi-step              NOT STARTED
```

Current native evidence:

```text
tab inventory / matching                 PASS
human keyword → exact tabId resolve      PASS
OBSERVE semantic targets                  PASS
semantic basic click                      PASS
visible click effect                      PASS
OBSERVE AFTER / invalidation              PASS
vertical page scroll                      PASS
```

Functional Agent PASS does **not** imply Brain-quality PASS or natural-behavior PASS.

---

# Native validation operating rule

Test existing Agent functions on `main` first. Do not add a capability or test-mode merely to make a native test easier.

```text
main
→ test existing function
→ PASS: record evidence and continue
→ FAIL due implementation: switch to reusable experiment branch
→ fix + contract/CI + native re-test
→ merge only native-passed fix to main
→ sync reusable branch back to main
```

Reusable experiment branch:

```text
feat/agent-tab-context
```

Do not create one branch per bug.

Repeated functional tests should prefer neutral/controlled pages. Account-backed platforms are sparse smoke-validation surfaces only, to reduce unintended account/platform effects from repeated automation.

---

# Execution boundary

```text
TASK
→ BROWSER CONTEXT / TAB INVENTORY
→ OBSERVER
→ STRATEGY / BRAIN
→ AGENT ACTION CONTRACT        = WHAT
→ EXECUTION BEHAVIOR CONTRACT = HOW naturally
→ CDP EXECUTION PLAN           = exact browser-native plan
→ AGENT RUNTIME EXTENSION      = dispatch only
→ CHROME
→ OBSERVE AFTER
→ GOAL CHECK / REPLAN
```

Hard invariant:

```text
Strategy does NOT emit selector / coordinate / CDP packet.
Behavior does NOT choose task intent.
Executor does NOT choose strategy.
```

`tabId` is internal execution identity. Human-facing selectors such as `facebook`, hostname/title/url are resolved once to one exact tabId before OBSERVE and the same tab is reused for EXECUTE + OBSERVE AFTER.

CDP is the standard in-page execution path. `chrome.tabs.*` is control-plane only.

---

# CDP / Runtime baseline

Planner:

```text
cdpPlanVersion = 0.1.1
```

Runtime dispatcher accepts:

```text
0.1.0
0.1.1
```

Allowlisted EXECUTE_PLAN methods:

```text
Input.dispatchMouseEvent
Input.dispatchKeyEvent
Input.insertText
Page.navigate
Page.reload
Page.getNavigationHistory
Page.navigateToHistoryEntry
```

No arbitrary raw-CDP tunnel from Brain.

Current implemented P0 plan families:

```text
click / focus acquisition
doubleClick
hover
scrollVertical / scrollHorizontal
typeText / pressKey
navigate / reload
```

Known fidelity gaps:

```text
doubleClick still needs native validation
keyCombo modifiers incomplete
Input.insertText listener fidelity not yet proven
moving-target geometry revalidation not robust
multi-frame Agent observation not implemented
post-action semantic outcome can be incomplete on dynamic overlays
```

---

# Native evidence — browser context + click

Browser-context core path:

```text
agentListTabs                          PASS
switch tab and relist                 PASS
matching --host facebook.com          PASS
--observe --tab facebook              PASS
keyword → exact internal tabId        PASS
```

Basic semantic click command:

```bat
node script/agent_one_action.js --type click --label "Thông báo" --tab facebook
```

Evidence:

```text
selected target = button / Thông báo
CDP plan = 0.1.1
execution.ok = true
observation invalidated = true
beforeObservationId != afterObservationId
human visual confirmation: notification panel opened
```

Post-click observer did not expose all notification-panel contents; classify that separately as observer/outcome fidelity, not click-executor failure.

---

# Native evidence — vertical scroll PASS

Controlled surface:

```text
https://en.wikipedia.org/wiki/Web_browser
```

Command:

```bat
node script/agent_one_action.js --type scrollVertical --direction 1 --host en.wikipedia.org --full
```

Initial `main` behavior FAILED functionally even though CDP dispatch returned success.

Two implementation bugs were found:

```text
1. Missing empirical behavior metrics passed through Number(null)
   → became zero-like values
   → fallback scroll collapsed to an almost invisible wheel amount.

2. Generic page scroll inherited prior pointer position
   → wheel could target a nested/control surface instead of the page body.
```

Fix merged through PR #5:

```text
missing metric remains null
→ planner fallback activates
→ fallback scroll ≈ 4 wheel events / ~480 px requested burst

generic page scroll
→ wheel anchor = viewport center
```

Native evidence after fix:

```text
after.scroll.y = 388
same observed element e405:
  before rect.y = 5500.015625
  after  rect.y = 5112.015625
  difference    = 388 px
```

Classification:

```text
vertical scroll existing function = NATIVE PASS
```

This validates functional scrolling only; it does not claim human-like scroll quality.

PR/CI:

```text
PR:          #5
head:        f23e9bfb45d28ad3ad6d0e22f65e39874cf8b906
workflow:    runtime-syntax
run:         32924626320
result:      SUCCESS
merge:       21018224496dad3208c04a0a324fdcf7748c218b
```

---

# NEXT — existing function only

Start again from `main`.

```text
DONE:
tab context / human selector
observe semantic targets
basic click
OBSERVE AFTER / invalidation
vertical scroll

NEXT:
hover without click

THEN:
horizontal scroll on a controlled horizontal surface
doubleClick safe target
focus
type non-sensitive text
back / forward

LATER INVARIANT / EVIDENCE GATES:
stale-ref rejection when exercisable via existing interfaces
moving-target rejection/reobserve
post-action semantic outcome fidelity
keyboard listener fidelity
```

Do not start autonomous multi-step tasks yet.

---

# P1 deferred

```text
drag / slider / seek
scrollIntoView
selectOption / setChecked / submit / dismiss
tab lifecycle through Agent bridge
hoverAndObserve / waitAndObserve policy
multi-frame target registry
robust moving-target revalidation
modifier-aware keyCombo
```

---

# Safety / privacy

CAPTCHA/human verification:

```text
status=blocked
reasonCode=human_verification_required
no automatic solve/bypass
no blind retry loop
```

Never collect/train credential/password/cookie/token/clipboard/payment-secret content.
