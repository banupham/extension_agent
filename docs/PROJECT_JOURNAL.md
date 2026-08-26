# PROJECT JOURNAL — persistent engineering memory

Mục đích: bộ nhớ kỹ thuật lâu dài cho `banupham/extension_agent` để phiên làm việc mới tiếp tục đúng mốc mà không điều tra lại các bug/invariant đã biết.

```text
STATUS.md
→ current milestone / next gate

PROJECT_JOURNAL.md
→ invariants / difficult regressions / native evidence

source trên main
→ implementation truth
```

Nếu journal mâu thuẫn source hiện tại trên `main`, source là implementation truth; sau đó cập nhật journal.

---

# 1. Quy trình phát triển hiện tại

```text
1 đọc STATUS.md
2 đọc/search PROJECT_JOURNAL.md
3 fetch source/tests trên main
4 test chức năng hiện có trên main trước
5 PASS → ghi evidence và sang chức năng kế tiếp
6 FAIL do implementation → dùng nhánh thử nghiệm duy nhất
7 fix đúng boundary + contract/CI
8 native re-test
9 PASS → merge main
10 sync nhánh thử nghiệm lại main
11 update STATUS/JOURNAL khi milestone/invariant thay đổi
```

Nhánh thử nghiệm duy nhất:

```text
feat/agent-tab-context
```

Không tạo branch mới cho từng bug. Không thêm capability/test-mode chỉ để dễ test.

Repeated native tests ưu tiên neutral/controlled pages; account-backed sites chỉ dùng smoke validation thưa.

---

# 2. Product / execution boundaries

```text
RECORDER
Human → deterministic Scenario

TRAINING COLLECTOR
Human → raw physical + semantic browser session

AGENT
Task → Browser Context → Observer → Strategy → Agent Action → Behavior → CDP Plan → Executor
```

```text
Strategy        = WHAT
Behavior Policy = HOW naturally
CDP Planner     = exact browser-native plan
Executor        = dispatch only
Browser Context = exact tab/frame identity
```

Hard invariant:

```text
Strategy does not emit selector / coordinate / CDP packet.
Behavior does not choose task intent.
Executor does not choose strategy.
```

Functional Agent PASS, Brain-quality PASS và natural-behavior PASS là ba milestone riêng.

---

# 3. Stable context before P0 native validation

Collector V0.8 transport/capture gate đã PASS: continuous archive, late-server replay, no missing/duplicate seq, multi-browser, multi-tab/frame, SPA routes, login privacy, browser-close finalize.

Important identity lesson:

```text
Collector content-script event
→ sender.tab/sender.frameId supplies identity

Agent broker command originates outside page
→ no sender.tab
→ Runtime must explicitly resolve browser context
```

A0 Agent/Behavior boundary COMPLETE.
A1 Action Window 0.1.4 COMPLETE.
A2 Behavior Feature 0.2.0 COMPLETE.
A3 empirical baseline contract READY.

A3 uses aggregate robust quantiles only; no literal human trajectory replay. Functional tests may use conservative fallback and therefore do not prove naturalness.

---

# 4. Agent Runtime / browser context

Observation identity:

```text
observationId + targetRef
→ tab/frame
→ semantic descriptor
→ observed rect
→ internal-only selector if available
```

Public observation hides selectors.

Stale conditions:

```text
new observation
navigation/loading
TTL expiry (4 s)
debugger detach
→ old refs invalid
```

Stale refs must fail; never blind-reuse old coordinates.

Known moving-target gap: current registry does not robustly reread live geometry immediately before dispatch. Preferred future behavior after evidence: reject → re-observe, not silent Executor retarget.

Browser-context path native PASS:

```text
agentListTabs
switch/relist
matching --host facebook.com
--observe --tab facebook
human keyword → exact tabId
```

One broker listens on `127.0.0.1:3000`; multiple extension clients share it by `agentId`.

---

# 5. Unified CDP execution path

P0 functional validation uses one path only:

```text
OBSERVE
→ semantic target / Agent Action
→ Behavior
→ CDP Plan 0.1.1
→ allowlisted Agent Runtime dispatcher
→ Chrome
→ OBSERVE AFTER
```

Do not mix direct DOM `.click()`, arbitrary `Runtime.evaluate`, Scenario/Stealth primitives or a second in-page executor into the same gate.

Allowlist:

```text
Input.dispatchMouseEvent
Input.dispatchKeyEvent
Input.insertText
Page.navigate
Page.reload
Page.getNavigationHistory
Page.navigateToHistoryEntry
```

Plan-version regression already fixed:

```text
planner emitted 0.1.1
runtime originally accepted 0.1.0 only
→ unsupported_cdp_plan_version
```

Current dispatcher accepts `0.1.0` and `0.1.1`; planner emits `0.1.1`.

---

# 6. Native milestone — semantic basic click PASS

```bat
node script/agent_one_action.js --type click --label "Thông báo" --tab facebook
```

Evidence: semantic target correct, CDP 0.1.1, execution ok, observation invalidated + re-observed, human visual confirmation notification panel opened.

Post-click observer did not expose full notification contents; observer/outcome fidelity is separate from click execution.

---

# 7. Native milestone — vertical scroll PASS

Controlled page: `https://en.wikipedia.org/wiki/Web_browser`

```bat
node script/agent_one_action.js --type scrollVertical --direction 1 --host en.wikipedia.org --full
```

Original functional failure had two causes:

```text
previous agentPointer could anchor generic wheel on nested/control surface
missing metrics passed Number(null) → zero-like values
```

Fix:

```text
generic page wheel anchor = viewport center
missing metric stays null/absent
fallback ≈ 220 ms / 4 wheel events / ~480 requested delta
```

Native evidence:

```text
before.scroll.y = 0
after.scroll.y  = 388
same observed element moved exactly 388 px
```

PR #5 runtime-syntax SUCCESS. Functional PASS only, not naturalness.

---

# 8. Native milestone — hover PASS

```bat
node script/agent_one_action.js --type hover --label "Browser market" --host en.wikipedia.org --full
```

Human-visible evidence: Agent hover reached target; no click; no navigation.

CDP pointer input does not move the OS cursor, so hover can be invisible when target styling has no hover state.

---

# 9. Native milestone — horizontal scroll PASS

Controlled page: `http://127.0.0.1:8088/`

```bat
node script/agent_one_action.js --type scrollHorizontal --direction 1 --url-includes 127.0.0.1:8088 --full
```

Evidence:

```text
behaviorFamily = scroll-horizontal
4 × mouseWheel
viewport-center anchor = (683, 320.5)
deltaX > 0, deltaY = 0
execution.ok = true
before.scroll = {x:0,y:0}
after.scroll  = {x:388,y:0}
human visual confirmation: horizontal track moved clearly
```

---

# 10. Native milestone — doubleClick PASS

Controlled page: `http://127.0.0.1:8089/`

```bat
node script/agent_one_action.js --type doubleClick --label "Double Click Target" --url-includes 127.0.0.1:8089 --full
```

Exact native sequence after pointer approach:

```text
mousePressed  clickCount=1
mouseReleased clickCount=1
→ 90 ms inter-click gap
mousePressed  clickCount=2
mouseReleased clickCount=2
```

After observation: same ref `e0`, label changed to `Agent Double Click PASS`, `focusedRef=e0`. Human visual confirmation matched. Functional PASS; timing naturalness remains later.

---

# 11. Native milestone — focus PASS

Controlled page: `http://127.0.0.1:8090/`

```bat
node script/agent_one_action.js --type focus --label "Focus Target" --url-includes 127.0.0.1:8090 --full
```

Evidence:

```text
input rect = x 68..588, y 68..149
final click = (302.34, 80.12), inside hit-box
before.focusedRef = null
after.focusedRef  = e0
label changed Focus Target → Focused Input
human visual confirmation: FOCUS PASS
```

Functional gate requires valid interior hit + real focus. Exact click-point naturalness/safe-margin is later Behavior/robustness work.

Contract drift discovered:

```text
mappedAction.cdpPrimitives = Runtime.callFunctionOn|DOM.focus
actual CDP plan = Input.dispatchMouseEvent mouseMoved/pressed/released
```

Execution truth is the plan. Track mapping cleanup separately; it did not cause functional failure.

---

# 12. Native milestone — typeText PASS

Controlled page reused focused input: `http://127.0.0.1:8090/`

```bat
node script/agent_one_action.js --type typeText --text "Agent typing PASS 123" --url-includes 127.0.0.1:8090 --full
```

Evidence:

```text
actionType = typeText
behaviorFamily = keyboard-text
behavior.profile = conservative-fallback
cdpPlanVersion = 0.1.1
21 characters → 21 Input.insertText steps
first delay = 0 ms
fallback inter-character delay = 80 ms
execution.ok = true
stepCount = resultCount = 21
observationInvalidated = true
before.focusedRef = e0
after.focusedRef  = e0
human visual confirmation: exact text "Agent typing PASS 123" appeared
```

Observer currently does not expose input value; label remained `Focused Input`. UI + execution evidence is sufficient for functional insertion PASS.

Do not overclaim: `Input.insertText` does not prove physical keyboard listener fidelity. `keydown/keyup` semantics remain a separate later gate.

---

# 13. Navigation gap discovered before native back/forward gate

Action Contract / metadata already include:

```text
back    → Page.getNavigationHistory + Page.navigateToHistoryEntry
forward → Page.getNavigationHistory + Page.navigateToHistoryEntry
```

But current `control-center/manager/execution/cdp_plan.js` `buildCdpPlan()` only has explicit navigation cases for:

```text
navigate
reload
```

There is no `back` or `forward` plan case on current `main`, so source predicts `cdp_plan_unsupported:back|forward` before Runtime dispatch.

Per project rule, do not fix preemptively: native-confirm `back` on `main`; if it fails as predicted, that is an implementation failure and the fix belongs on reusable branch `feat/agent-tab-context`.

---

# 14. Scheduled observability tool — Agent Cursor Debug Overlay

After current functional matrix, implement a debug-only cursor mirroring actually dispatched pointer events.

```text
CDP plan / Runtime dispatch = source of truth
                 ↓ mirror only
Agent Cursor overlay        = visualization / telemetry only
```

Requirements: mirror exact x/y + timing and moved/pressed/released/wheel states; never generate input, choose/retarget targets, or alter Strategy/Behavior/CDP/registry; `pointer-events:none`; must not appear as Observer target; prefer isolated extension Shadow DOM.

---

# 15. Current native matrix / next gate

```text
tab inventory / matching          PASS
human keyword tab resolve         PASS
observe by keyword                PASS
semantic target selection         PASS
basic click                       PASS
OBSERVE AFTER / invalidation      PASS
vertical scroll                   PASS
hover                             PASS
horizontal scroll                 PASS
doubleClick                       PASS
focus                             PASS
typeText                          PASS

NEXT:
back on controlled local history surface
→ native-confirm current main behavior

THEN:
forward

AFTER FUNCTIONAL MATRIX:
Agent Cursor Debug Overlay

LATER:
stale-ref rejection via existing interfaces
moving-target rejection/reobserve
post-action semantic outcome fidelity
keyboard listener fidelity
focus primitive metadata cleanup
```

No autonomous multi-step yet.

---

# 16. Persistent architectural decisions

```text
D027 CDP is Agent in-page execution standard
D028 Agent execution = Action → Behavior → CDP Plan → Executor
D029 Human demos define distributions/context, not literal replay
D033 Stale targetRef triggers re-observation
D038 Brain sees semantics, not internal selectors
D039 Agent target refs are observation-bound
D041 External CDP plans are allowlisted
D042 Brain decides only after OBSERVE and one action per loop
D043 Focus reuses pointer-click HOW distribution
D044 DoubleClick requires two real press/release cycles
D045 Browser context is first-class; human selector resolves once to exact tabId
D047 Dispatcher accepts planner 0.1.1 and retains 0.1.0 compatibility
D048 Functional Agent / Brain quality / natural behavior are separate gates
D049 Visible UI effect can validate executor even with incomplete semantic outcome capture
D050 Test existing capability on main before implementation changes
D051 Implementation failures use one reusable experiment branch
D052 P0 in-page validation uses one unified CDP path
D053 Repeated tests prefer neutral/controlled pages
D054 Missing empirical metrics remain null/absent, never accidental numeric zero
D055 Generic page scroll anchors at viewport center
D056 Horizontal scroll uses axis-specific deltaX and is native validated
D057 Agent Cursor is scheduled after functional matrix and is mirror-only telemetry
D058 DoubleClick two-cycle sequence is browser-native validated with semantic outcome
D059 Focus functional correctness requires valid interior pointer hit + focusedRef transition; natural point quality is separate
D060 typeText per-character Input.insertText is functionally native validated; physical-key listener fidelity is separate
D061 back/forward contract exists but current planner support must be native-confirmed before repair
```

---

# 17. Safety / maintenance

CAPTCHA/human verification remains blocked; no automatic solve/bypass/blind retry. Never collect/train credentials, passwords, cookies, tokens, clipboard or payment secrets.

Journal only facts future sessions should not rediscover: what passed, exact evidence, what is not claimed, difficult bug root cause, invariant/fix, and next smallest native gate.
