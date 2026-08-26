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
9 PASS → merge/fast-forward main
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
Task → Browser Context → Observer → Strategy → Agent Action → Behavior/Variant Policy → CDP Plan → Executor
```

```text
Strategy        = WHAT
Behavior Policy = HOW naturally / allowed execution variant
CDP Planner     = exact browser-native plan
Executor        = dispatch + narrow runtime binding only
Browser Context = exact tab/frame identity
```

Hard invariant:

```text
Strategy does not emit selector / coordinate / CDP packet.
Behavior does not choose task intent.
Executor does not choose strategy.
```

Functional Agent PASS, Brain-quality PASS và natural-behavior PASS là ba milestone riêng.

A semantic action can have multiple execution variants without changing intent. Variant selection belongs below Strategy.

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

Browser-context native PASS:

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

Current P0/A4 validation path:

```text
OBSERVE
→ semantic target / Agent Action
→ Behavior / execution-variant policy
→ CDP Plan 0.1.2
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

Plan-version history:

```text
0.1.1 planner vs runtime 0.1.0 mismatch
→ unsupported_cdp_plan_version
→ runtime compatibility fixed

0.1.2 introduced only for narrow navigation-history binding
```

Current dispatcher accepts `0.1.0`, `0.1.1`, `0.1.2`; planner emits `0.1.2`.

---

# 6. Native milestone — semantic basic click PASS

```bat
node script/agent_one_action.js --type click --label "Thông báo" --tab facebook
```

Evidence: semantic target correct, CDP execution ok, observation invalidated + re-observed, human visual confirmation notification panel opened.

Post-click observer did not expose full notification contents; observer/outcome fidelity is separate from click execution.

---

# 7. Native milestone — vertical scroll PASS

Controlled page: `https://en.wikipedia.org/wiki/Web_browser`

```bat
node script/agent_one_action.js --type scrollVertical --direction 1 --host en.wikipedia.org --full
```

Original failure:

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

PR #5 runtime-syntax run `32924626320` SUCCESS. Functional PASS only, not naturalness.

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

After observation: same ref `e0`, label changed to `Agent Double Click PASS`, `focusedRef=e0`. Human visual confirmation matched.

Fallback Behavior reported `holdMs=0`; Planner minimum clamp produced 10 ms holds. Functional PASS, not timing-naturalness PASS.

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

Contract drift:

```text
mappedAction.cdpPrimitives = Runtime.callFunctionOn|DOM.focus
actual CDP plan = Input.dispatchMouseEvent mouseMoved/pressed/released
```

Execution truth is the plan. Track mapping cleanup separately.

---

# 12. Native milestone — typeText PASS

Controlled page reused focused input: `http://127.0.0.1:8090/`

```bat
node script/agent_one_action.js --type typeText --text "Agent typing PASS 123" --url-includes 127.0.0.1:8090 --full
```

Evidence:

```text
21 characters → 21 Input.insertText steps
first delay = 0 ms
fallback inter-character delay = 80 ms
execution.ok = true
stepCount = resultCount = 21
observationInvalidated = true
before.focusedRef = e0
after.focusedRef  = e0
human visual confirmation exact text appeared
```

Observer currently does not expose input value; label remained `Focused Input`. UI + execution evidence is sufficient for functional insertion PASS.

Do not overclaim: `Input.insertText` does not prove physical keyboard listener fidelity.

---

# 13. Native milestone — back / forward PASS and CDP 0.1.2

Controlled local history surface:

```text
http://127.0.0.1:8091/a
http://127.0.0.1:8091/b
```

Native-confirmed initial `main` failure:

```text
node script/agent_one_action.js --type back --url-includes 127.0.0.1:8091 --full
→ cdp_plan_unsupported:back
```

Root cause:

```text
Action Contract already had back/forward
metadata already listed Page.getNavigationHistory + Page.navigateToHistoryEntry
Runtime allowlist already allowed both methods
but buildCdpPlan() had only navigate/reload navigation cases
```

Repair used the reusable branch `feat/agent-tab-context` only.

Planner 0.1.2 now emits:

```text
back:
Page.getNavigationHistory
→ Page.navigateToHistoryEntry { historyOffset: -1 }

forward:
Page.getNavigationHistory
→ Page.navigateToHistoryEntry { historyOffset: +1 }
```

The second step does not contain a caller-provided `entryId`. Dispatcher resolves it only from the immediately preceding `Page.getNavigationHistory` result.

Boundary preserved:

```text
Strategy knows semantic back/forward only
Planner chooses history offset
Runtime resolves dynamic entryId
Executor does not choose direction/intent
```

Back native PASS:

```text
before.url = /b
after.url  = /a
historyOffset = -1
execution.ok = true
stepCount = resultCount = 2
```

Forward native PASS:

```text
before.url = /a
after.url  = /b
historyOffset = +1
execution.ok = true
stepCount = resultCount = 2
```

Contract checks:

```text
CDP execution planner contract: PASS
CDP plan dispatcher contract: PASS
```

CI:

```text
runtime-syntax run 32928523987 = SUCCESS
head = 056dd8ad24c088b6c503960a6210cc88553d53aa
```

The branch was ahead of `main` by exactly 4 commits / 4 files, behind 0; `main` was fast-forwarded to that native-PASS head.

---

# 14. Execution-variant policy

A semantic Agent Action is WHAT, not a promise of one fixed physical mechanism.

Example `back`:

```text
variant A — navigation-history CDP
Page.getNavigationHistory → Page.navigateToHistoryEntry
NATIVE PASS

variant B — keyboard shortcut
Alt+Left
FUTURE; depends on modifier-aware keyCombo/native keyboard fidelity

variant C — pointer click on browser Back button
FUTURE; this is browser chrome, not page viewport
```

Do not model Chrome browser UI as a normal DOM/page-CDP target. If browser-chrome pointer control is implemented, it requires an explicit browser-UI/OS-control execution boundary.

Variant selection must preserve Agent intent and stay below Strategy.

---

# 15. Scheduled observability tool — Agent Cursor Debug Overlay

The agreed core functional matrix through back/forward is now native PASS. Next scheduled work is a debug-only cursor mirroring actually dispatched pointer events.

```text
CDP plan / Runtime dispatch = source of truth
                 ↓ mirror only
Agent Cursor overlay        = visualization / telemetry only
```

Requirements:

```text
mirror exact x/y + timing
mirror moved/pressed/released/wheel states
never generate input
never choose/retarget target
never alter Strategy / Behavior / CDP plan / registry
pointer-events:none
must not appear as Observer target
prefer isolated extension Shadow DOM
```

This tool exists to make CDP pointer trajectories visible when page hover styling gives no visual feedback. It must never become an execution source.

---

# 16. Current native matrix / remaining gates

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
back                              PASS
forward                           PASS
```

NEXT scheduled work:

```text
Agent Cursor Debug Overlay
```

Still implemented but not native-validated in this agreed matrix:

```text
pressKey
navigate
reload
```

Later invariant/evidence gates:

```text
stale-ref rejection via existing interfaces
moving-target rejection/reobserve
post-action semantic outcome fidelity
keyboard listener fidelity
focus primitive metadata cleanup
```

No autonomous multi-step yet.

---

# 17. Persistent architectural decisions

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
D047 Dispatcher retains compatibility for older supported CDP plan versions
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
D061 back/forward planner gap was native-confirmed before repair
D062 CDP plan 0.1.2 adds only narrow navigation-history result binding; Strategy never emits entryId
D063 back and forward history-CDP variants are native validated
D064 One semantic Agent Action may have multiple execution variants; variant selection stays below Strategy
D065 Browser-chrome UI is not a normal page-CDP target and needs an explicit control boundary if added
```

---

# 18. Safety / maintenance

CAPTCHA/human verification remains blocked; no automatic solve/bypass/blind retry. Never collect/train credentials, passwords, cookies, tokens, clipboard or payment secrets.

Journal only facts future sessions should not rediscover: what passed, exact evidence, what is not claimed, difficult bug root cause, invariant/fix, and next smallest gate.
