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
P0 Agent Runtime                   CORE FUNCTION MATRIX NATIVE PASS
A4 One-action bridge               CORE FUNCTION MATRIX NATIVE PASS
A5 Goal Checker + Replan           NOT STARTED
Autonomous multi-step              NOT STARTED
```

Collector V0.8 transport/capture gate đã PASS và chỉ còn stability/regression support.

Current native evidence:

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
doubleClick two-cycle browser behavior   PASS
focus editable target                    PASS
typeText into focused editable target    PASS
back navigation                          PASS
forward navigation                       PASS
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
→ EXECUTION BEHAVIOR CONTRACT = HOW naturally / execution-variant policy
→ CDP EXECUTION PLAN           = exact browser-native plan
→ AGENT RUNTIME EXTENSION      = dispatch + narrow runtime binding only
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

Một semantic Agent Action có thể có nhiều execution variants nhưng intent không đổi. Ví dụ `back` có thể về sau có history-CDP, keyboard shortcut hoặc browser-UI variant; variant selection thuộc execution policy/planning layer, không thuộc Brain intent.

`tabId` là internal execution identity. Human-facing selector resolve một lần thành exact tabId trước OBSERVE và reuse cho EXECUTE + OBSERVE AFTER.

CDP là standard in-page/navigation execution path. `chrome.tabs.*` chỉ là control-plane.

---

# CDP / Runtime baseline

Planner hiện phát:

```text
cdpPlanVersion = 0.1.2
```

Runtime dispatcher accepts:

```text
0.1.0
0.1.1
0.1.2
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

Native-validated plan families:

```text
click / focus acquisition
doubleClick
hover
scrollVertical / scrollHorizontal
typeText
back / forward history navigation
```

Implemented but not yet native-validated in the current agreed matrix:

```text
pressKey
navigate / reload
```

Known fidelity / contract gaps:

```text
focus cdpPrimitives metadata still advertises Runtime.callFunctionOn|DOM.focus while planner executes Input.dispatchMouseEvent
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
switch/relist                         PASS
matching --host facebook.com          PASS
--observe --tab facebook              PASS
human keyword → exact internal tabId  PASS
```

Basic semantic click:

```bat
node script/agent_one_action.js --type click --label "Thông báo" --tab facebook
```

Evidence: target đúng, CDP execution ok, observation invalidated/re-observed, human visual confirmation notification panel opened.

Post-click observer chưa expose đầy đủ notification contents; classify riêng là observer/outcome fidelity.

---

# Native evidence — scroll / hover / doubleClick / focus / typing PASS

Vertical scroll:

```text
Wikipedia controlled surface
before.scroll.y = 0
after.scroll.y  = 388
```

Initial bug fixed: missing empirical metrics must remain `null`, not become numeric zero; generic page scroll anchors at viewport center. PR #5 / runtime-syntax run `32924626320` SUCCESS.

Horizontal scroll controlled surface:

```text
127.0.0.1:8088
4 × mouseWheel
deltaX > 0, deltaY = 0
before.scroll.x = 0
after.scroll.x  = 388
```

Hover:

```text
Browser market on Wikipedia
pointer logic reached target
no click / no navigation
```

DoubleClick controlled surface `127.0.0.1:8089`:

```text
clickCount 1 press/release
→ clickCount 2 press/release
label changed Double Click Target → Agent Double Click PASS
focusedRef became e0
```

Focus controlled surface `127.0.0.1:8090`:

```text
input rect = x 68..588, y 68..149
final click = (302.34, 80.12), inside hit-box
focusedRef: null → e0
label: Focus Target → Focused Input
human visual confirmation: FOCUS PASS
```

TypeText on same focused input:

```text
text = "Agent typing PASS 123"
21 chars → 21 Input.insertText steps
fallback inter-character delay = 80 ms
execution.ok = true
focusedRef remains e0
human visual confirmation exact text appeared
```

Physical-key/listener fidelity remains a separate later gate.

---

# Native evidence — back / forward PASS

Controlled surface:

```text
http://127.0.0.1:8091/a
http://127.0.0.1:8091/b
```

Main originally native-failed:

```text
cdp_plan_unsupported:back
```

Root cause: Action Contract / metadata and Runtime allowlist already supported history navigation primitives, but `buildCdpPlan()` had no `back`/`forward` case.

Fix on reusable experiment branch introduced CDP plan `0.1.2` with a narrow runtime history binding:

```text
Page.getNavigationHistory
→ Page.navigateToHistoryEntry
```

Planner emits only semantic offset:

```text
back    historyOffset = -1
forward historyOffset = +1
```

Dispatcher resolves `entryId` only from the immediately preceding `Page.getNavigationHistory` result. Strategy never sees or emits entryId.

Back native evidence:

```text
before = /b
historyOffset = -1
execution.ok = true
stepCount = resultCount = 2
after = /a
```

Forward native evidence:

```text
before = /a
historyOffset = +1
execution.ok = true
stepCount = resultCount = 2
after = /b
```

Contract tests PASS and runtime-syntax run `32928523987` SUCCESS.

The native-validated fix was fast-forwarded to `main` at commit `056dd8ad24c088b6c503960a6210cc88553d53aa` before this documentation update.

---

# Execution-variant policy

A semantic action is WHAT, not a fixed physical mechanism.

Example:

```text
back
├─ history CDP: Page.getNavigationHistory → Page.navigateToHistoryEntry   NATIVE PASS
├─ keyboard: Alt+Left                                                     FUTURE VARIANT
└─ browser chrome back-button pointer click                               FUTURE browser-UI/OS-control variant
```

Do not pretend browser-chrome controls are normal page-CDP targets. Browser UI requires an explicit browser-UI/OS-control boundary if implemented later.

Variant selection must preserve the same Agent Action intent and must not leak CDP packets/coordinates into Strategy.

---

# NEXT — after current core functional matrix

The agreed P0/A4 core matrix is now native PASS through `back/forward`.

Next scheduled work:

```text
Agent Cursor Debug Overlay
```

Requirements:

```text
CDP plan / Runtime dispatch = source of truth
                 ↓ mirror only
Agent Cursor overlay        = visualization / telemetry only

mirror exact x/y + timing
mirror moved / pressed / released / wheel states
never generate input
never choose or retarget target
never alter Strategy / Behavior / CDP plan / registry
pointer-events:none
must not appear as Observer target
prefer isolated extension Shadow DOM
```

This is an observability/debug tool, not a new execution source.

Remaining later evidence gates:

```text
stale-ref rejection when exercisable via existing interfaces
moving-target rejection/reobserve
post-action semantic outcome fidelity
keyboard listener fidelity
focus primitive metadata cleanup
pressKey native validation
navigate / reload native validation
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
browser-UI/OS-control execution variants where justified
```

---

# Safety / privacy

CAPTCHA/human verification remains blocked; no automatic solve/bypass or blind retry. Never collect/train credential/password/cookie/token/clipboard/payment-secret content.
