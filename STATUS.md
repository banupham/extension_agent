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

`tabId` là internal execution identity. Human-facing selector (keyword/hostname/title/url) được resolve một lần thành exact tabId trước OBSERVE và reuse cho EXECUTE + OBSERVE AFTER.

CDP là standard in-page execution path. `chrome.tabs.*` chỉ là control-plane.

---

# CDP / Runtime baseline

Planner hiện tại:

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
doubleClick still needs native validation
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

Post-click observer chưa expose đầy đủ nội dung notification panel; đây là observer/outcome-fidelity issue, không phải click-executor failure.

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

Initial `main` functional failure có hai nguyên nhân:

```text
1. Missing empirical metrics bị Number(null) → 0-like values
   → fallback scroll collapse gần như 1 px.

2. Generic page scroll inherited prior pointer position
   → wheel có thể nằm trên nested/control surface thay vì page body.
```

Fix merged PR #5:

```text
missing metric remains null
→ planner fallback activates
→ fallback ≈ 4 wheel events / ~480 px requested burst

generic page scroll
→ wheel anchor = viewport center
```

Native PASS evidence:

```text
after.scroll.y = 388
same observed element e405:
  before rect.y = 5500.015625
  after  rect.y = 5112.015625
  difference    = 388 px
```

CI/merge:

```text
PR:          #5
workflow:    runtime-syntax
run:         32924626320
result:      SUCCESS
merge:       21018224496dad3208c04a0a324fdcf7748c218b
```

This proves functional scrolling, not human-like scroll quality.

---

# Native evidence — hover without click PASS

Controlled surface:

```text
https://en.wikipedia.org/wiki/Web_browser
```

Command:

```bat
node script/agent_one_action.js --type hover --label "Browser market" --host en.wikipedia.org --full
```

Human visual confirmation:

```text
Agent pointer logic reached Browser market
no click occurred
no navigation occurred
page remained Web browser - Wikipedia
```

Classification:

```text
hover existing function = NATIVE PASS
```

CDP mouse events do not move the OS/native cursor, so correct hover may be visually hard to verify on targets without hover styling.

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

Plan evidence:

```text
actionType = scrollHorizontal
behaviorFamily = scroll-horizontal
behavior.profile = conservative-fallback
cdpPlanVersion = 0.1.1
4 × Input.dispatchMouseEvent(mouseWheel)
wheel point = viewport center (683, 320.5)
deltaX > 0 for all four events
deltaY = 0 for all four events
execution.ok = true
stepCount = resultCount = 4
observationInvalidated = true
```

Observer evidence:

```text
before.scroll = {x: 0,   y: 0}
after.scroll  = {x: 388, y: 0}
```

Human visual confirmation: controlled horizontal track moved left-to-right direction by roughly 2/3 of the visible test distance.

Classification:

```text
horizontal scroll existing function = NATIVE PASS
```

This proves functional horizontal wheel execution only, not natural human scroll quality.

---

# Scheduled after current functional matrix — Agent Cursor Debug Overlay

After the existing P0/A4 function matrix is complete, add a debug-only visible Agent cursor to mirror actual dispatched pointer events.

Boundary:

```text
CDP plan / Runtime dispatch = input source of truth
                 ↓ mirror only
Agent Cursor overlay        = visualization / telemetry only
```

Requirements:

```text
mirror exact dispatched x/y + timing
never generate input or choose targets
never modify Strategy / Behavior / CDP plan
pointer-events:none
must not become an Observer target
ideally isolated in extension Shadow DOM
```

This is scheduled observability tooling, not part of the current functional gate.

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
hover without click
horizontal scroll

NEXT:
doubleClick on a controlled safe target

THEN:
focus
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

CAPTCHA/human verification:

```text
status=blocked
reasonCode=human_verification_required
no automatic solve/bypass
no blind retry loop
```

Never collect/train credential/password/cookie/token/clipboard/payment-secret content.
