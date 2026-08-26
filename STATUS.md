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

Collector V0.8 transport/capture gate đã PASS và chỉ còn stability/regression support.

Current Agent native evidence:

```text
tab inventory / matching                 PASS
human keyword → exact tabId resolve      PASS
OBSERVE semantic targets                 PASS
semantic basic click                     PASS
visible click effect                     PASS
OBSERVE AFTER / invalidation             PASS
vertical page scroll                     PASS
hover without click                      PASS
horizontal page scroll                   PASS
doubleClick two-cycle native behavior    PASS
```

Functional Agent PASS không đồng nghĩa Brain-quality PASS hoặc natural-behavior PASS.

---

# Native validation operating rule

Test chức năng hiện có trên `main` trước. Không thêm capability/test-mode chỉ để dễ test.

```text
main
→ test existing function
→ PASS: record evidence and continue
→ FAIL do implementation: chuyển sang reusable experiment branch
→ fix + contract/CI + native re-test
→ merge chỉ fix đã native PASS
→ sync reusable branch về main
```

Reusable experiment branch duy nhất:

```text
feat/agent-tab-context
```

Không tạo branch mới cho từng bug.

Repeated functional tests ưu tiên neutral/controlled pages. Account-backed platforms chỉ dùng sparse smoke validation để giảm unintended account/platform effects từ automation lặp lại.

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

`tabId` là internal execution identity. Human-facing selector (keyword/hostname/title/url) resolve một lần thành exact tabId trước OBSERVE và reuse cho EXECUTE + OBSERVE AFTER.

CDP là standard in-page execution path. `chrome.tabs.*` chỉ là control-plane.

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

Implemented P0 plan families:

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
keyCombo modifiers incomplete
Input.insertText listener fidelity not yet proven
moving-target geometry revalidation not robust
multi-frame Agent observation not implemented
post-action semantic outcome can be incomplete on dynamic overlays
```

---

# Native evidence — browser context + basic click PASS

Browser context:

```text
agentListTabs                          PASS
switch tab and relist                 PASS
matching --host facebook.com          PASS
--observe --tab facebook              PASS
keyword → exact internal tabId        PASS
```

Basic semantic click:

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

Post-click observer chưa expose đầy đủ notification-panel contents; classify separately as observer/outcome fidelity.

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

Initial implementation failure:

```text
missing empirical metrics: Number(null) → zero-like fallback
previous agentPointer could anchor generic wheel over nested/control surface
```

Fix merged PR #5:

```text
missing metric remains null → planner fallback activates
generic page scroll → viewport-center wheel anchor
fallback ≈ 4 wheel events / ~480 px requested burst
```

Native evidence:

```text
before.scroll.y = 0
after.scroll.y  = 388
same observed element moved exactly 388 px
```

PR #5 / runtime-syntax run 32924626320 = SUCCESS.

---

# Native evidence — hover PASS

```bat
node script/agent_one_action.js --type hover --label "Browser market" --host en.wikipedia.org --full
```

Human visual confirmation: Agent pointer logic reached `Browser market`, with no click and no navigation.

CDP mouse input does not move the OS cursor; a correct hover may be visually hard to see when target styling has no hover state.

---

# Native evidence — horizontal scroll PASS

Controlled surface:

```text
http://127.0.0.1:8088/
title = Agent Horizontal Scroll Test
```

Command:

```bat
node script/agent_one_action.js --type scrollHorizontal --direction 1 --url-includes 127.0.0.1:8088 --full
```

Evidence:

```text
behaviorFamily = scroll-horizontal
4 × Input.dispatchMouseEvent(mouseWheel)
wheel anchor = viewport center = (683, 320.5)
deltaX > 0, deltaY = 0
execution.ok = true
before.scroll = {x:0, y:0}
after.scroll  = {x:388, y:0}
human visual confirmation: horizontal track moved clearly
```

---

# Native evidence — doubleClick PASS

Controlled surface:

```text
http://127.0.0.1:8089/
title = Agent Double Click PASS
```

Command:

```bat
node script/agent_one_action.js --type doubleClick --label "Double Click Target" --url-includes 127.0.0.1:8089 --full
```

Target / outcome:

```text
before:
  ref = e0
  label = Double Click Target
  focusedRef = null

after:
  same ref = e0
  label = Agent Double Click PASS
  focusedRef = e0
```

CDP sequence:

```text
pointer approach mouseMoved events
→ mousePressed  clickCount=1
→ 10 ms
→ mouseReleased clickCount=1
→ 90 ms inter-click gap
→ mousePressed  clickCount=2
→ 10 ms
→ mouseReleased clickCount=2
```

Execution evidence:

```text
cdpPlanVersion = 0.1.1
stepCount = 15
resultCount = 15
execution.ok = true
observationInvalidated = true
beforeObservationId != afterObservationId
```

Human visual confirmation: button changed to `Agent Double Click PASS`.

Classification:

```text
doubleClick existing function = NATIVE PASS
```

Note: fallback Behavior reported `holdMs=0`, while Planner minimum clamp produced 10 ms press holds. Functional behavior is validated; naturalness/timing quality remains a later gate.

---

# Scheduled after current functional matrix — Agent Cursor Debug Overlay

After current P0/A4 function matrix, add a debug-only visible Agent cursor that mirrors actual pointer events dispatched by Runtime.

```text
CDP plan / Runtime dispatch = input source of truth
                 ↓ mirror only
Agent Cursor overlay        = visualization / telemetry only
```

Requirements: mirror exact x/y/timing, never generate input/retarget/modify Strategy or Behavior, `pointer-events:none`, must not become Observer target, prefer extension Shadow DOM.

---

# NEXT — existing function only

Start from `main`.

```text
DONE:
tab context / human selector
observe semantic targets
basic click
OBSERVE AFTER / invalidation
vertical scroll
hover
horizontal scroll
doubleClick

NEXT:
focus on a controlled editable target

THEN:
type non-sensitive text
back / forward

AFTER FUNCTIONAL MATRIX:
Agent Cursor Debug Overlay

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

CAPTCHA/human verification remains blocked; no automatic solve/bypass or blind retry. Never collect/train credential/password/cookie/token/clipboard/payment-secret content.
