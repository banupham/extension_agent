# PROJECT JOURNAL — persistent engineering memory

Mục đích: bộ nhớ kỹ thuật lâu dài cho `banupham/extension_agent` để cuộc trò chuyện mới có thể tiếp tục đúng mốc mà không phải điều tra lại kiến trúc, bug khó hoặc native evidence đã có.

```text
STATUS.md
→ current milestone / next gate

PROJECT_JOURNAL.md
→ invariants / rationale / difficult regressions / native evidence

source trên main
→ implementation truth
```

Nếu journal mâu thuẫn với source hiện tại trên `main`, source là implementation truth; sau đó cập nhật journal.

---

# 1. Quy trình phát triển hiện tại

```text
1 đọc STATUS.md
2 đọc/search PROJECT_JOURNAL.md theo component/problem
3 fetch source/tests hiện tại trên main
4 test chức năng hiện có trên main trước
5 PASS → ghi evidence và sang chức năng kế tiếp
6 FAIL do implementation → chuyển sang nhánh thử nghiệm duy nhất
7 sửa đúng boundary + contract/CI
8 native browser re-test
9 native PASS → merge main
10 sync nhánh thử nghiệm lại từ main
11 cập nhật STATUS/JOURNAL khi milestone/invariant thay đổi
```

Nhánh thử nghiệm duy nhất:

```text
feat/agent-tab-context
```

Không tạo branch mới cho từng bug. Không thêm capability/test-mode mới chỉ để dễ test.

Repeated native function tests ưu tiên neutral/controlled pages; account-backed sites chỉ dùng smoke validation thưa sau khi capability đã hoạt động ở môi trường kiểm soát.

---

# 2. Product boundaries

```text
RECORDER
Human → deterministic Scenario

TRAINING COLLECTOR
Human → raw physical + semantic browser session

AGENT
Task → Browser Context → Observer → Strategy → Agent Action → Behavior → CDP Plan → Executor
```

Roles:

```text
Strategy        = WHAT
Behavior Policy = HOW naturally
CDP Planner     = exact browser-native plan
Executor        = dispatch only
Browser Context = exact tab/frame execution identity
```

Scenario Mode và Agent Mode không gộp contract.

Functional Agent PASS, Brain-quality PASS và natural-behavior PASS là ba milestone khác nhau.

---

# 3. Collector stable baseline — V0.8

Collector runtime `0.8.0`, raw schema `0.7.2`.

Stable path:

```text
all-frame content capture
→ RAW_BATCH + batchId
→ background normalize + sessionSeq
→ IndexedDB append/receipt dedupe
→ localhost WebSocket mirror
→ append-only server JSONL
```

Native gates already passed:

```text
continuous socket archive
late-server replay
no missing/duplicate seq
multi-browser concurrent
multi-tab / multi-frame
SPA routes
login-form observation
credential privacy
browser-close finalize
session-end
```

Important architectural lesson from Agent tab debugging:

```text
Collector content-script event originates inside page
→ Chrome sender.tab/sender.frameId supplies identity

Agent broker command originates outside page
→ no sender.tab identity
→ Agent Runtime must explicitly resolve/hold browser context
```

Do not conflate Collector `activeTab()` helper with continuous raw capture architecture.

Raw chronology:

```text
tsEpochMs  = primary global time
pageSeq    = page-local order
sourceSeq  = source-local order
sessionSeq = persistence/integrity order only
```

Never sort human behavior trajectory by `sessionSeq`.

Privacy boundary excludes raw password/cookie/token/Authorization/clipboard/payment/local-storage/session-storage secrets and printable human key content.

---

# 4. A0–A3 preparation

## A0 — Agent contract boundary COMPLETE

Read first:

```text
control-center/AGENT_ACTION_CONTRACT.json
control-center/manager/strategy/agent_action_contract.js
control-center/manager/strategy/execution_behavior_contract.js
docs/AGENT_ACTION_CDP_MAP.md
```

Invariant:

```text
Strategy does not emit selector / coordinate / CDP method.
Behavior does not choose task intent.
Executor does not choose strategy.
```

## A1 — Action Window 0.1.4 COMPLETE

```text
BEFORE
→ semantic action
→ AFTER / mutation / route
→ OUTCOME
```

Families include click, hover, scrollVertical/Horizontal, focus, typeText, pressKey, drag, toggle, dismiss, submit/selectOption candidates.

## A2 — Behavior Feature 0.2.0 COMPLETE

Derived groups include pointer path/speed/turn/correction, click hold/acquisition, hover approach+dwell+leave, vertical/horizontal wheel burst, keyboard hold/inter-key timing and target geometry.

Drag remains sparse.

## A3 — Empirical Behavior Baseline READY

Baseline `0.1.0` stores aggregate robust quantiles only:

```text
p10 / p25 / p50 / p75 / p90
```

No literal human trajectory replay.

Families:

```text
pointer-click
pointer-hover
scroll-vertical
scroll-horizontal
keyboard-text
keyboard-key
pointer-drag sparse fallback
```

Functional native tests may use conservative fallback behavior. That does not prove naturalness quality.

---

# 5. Agent Runtime V0.2 — browser context and observation registry

Read first:

```text
control-center/extension/agent-runtime-extension/target_registry.js
control-center/extension/agent-runtime-extension/tab_context.js
control-center/extension/agent-runtime-extension/cdp_plan_dispatcher.js
control-center/extension/agent-runtime-extension/background.js
```

Observation identity:

```text
observationId + targetRef
→ tab/frame
→ semantic descriptor
→ observed rect
→ internal-only selector if available
```

Public observation does not expose selector.

Stale conditions:

```text
new observation
navigation/loading
TTL expiry (currently 4 s)
debugger detach
→ old refs invalid
```

Stale refs fail and require re-observation; never blind-reuse old coordinates.

Known moving-target risk: current registry validates observation/ref/tab/url/interactability but does not robustly reread live geometry immediately before dispatch. When native evidence demonstrates movement, prefer reject → re-observe rather than silent Executor retarget.

Browser-context actions:

```text
agentStatus
agentListTabs
agentObserveTabs
agentObserve
agentExecutePlan
```

Scopes:

```text
active
visible
matching
all
```

Human selectors such as `facebook`, hostname/title/url resolve deterministically to one internal tabId before OBSERVE. If ambiguous, reject rather than guess.

Native context evidence:

```text
list tabs                         PASS
switch active tab and relist      PASS
matching --host facebook.com      PASS
observe --tab facebook            PASS
keyword → exact tabId             PASS
```

Broker note: one server listens on `127.0.0.1:3000`; multiple extension clients may share it and are routed by `agentId`. Stealth Executor and Agent Runtime are different broker clients/products, not competing TCP listeners.

---

# 6. Unified CDP execution path

P0 functional validation must use one path:

```text
OBSERVE
→ semantic target / Agent Action
→ Behavior
→ CDP Plan 0.1.1
→ allowlisted Agent Runtime dispatcher
→ Chrome
→ OBSERVE AFTER
```

Do not mix direct DOM `.click()`, arbitrary `Runtime.evaluate`, Scenario/Stealth primitives or a second in-page executor into the same functional gate.

`chrome.tabs.*` is control-plane only.

Dispatcher allowlist:

```text
Input.dispatchMouseEvent
Input.dispatchKeyEvent
Input.insertText
Page.navigate
Page.reload
Page.getNavigationHistory
Page.navigateToHistoryEntry
```

Version compatibility regression already fixed:

```text
planner emitted 0.1.1
runtime originally accepted 0.1.0 only
→ unsupported_cdp_plan_version
```

Current:

```text
SUPPORTED_PLAN_VERSIONS = {0.1.0, 0.1.1}
LATEST_PLAN_VERSION = 0.1.1
```

---

# 7. CDP Planner 0.1.1

Pointer click:

```text
sample target point
→ curved approach
→ optional micro-correction
→ dwell
→ press
→ hold
→ release
```

DoubleClick:

```text
press/release clickCount=1
→ inter-click gap
→ press/release clickCount=2
```

Hover = pointer approach + optional dwell.

Scroll vertical/horizontal = axis-specific multi-event `mouseWheel` burst.

Typing currently uses per-character `Input.insertText` with timing; listener fidelity remains a native question.

Known gaps:

```text
keyCombo modifiers incomplete
moving-target geometry revalidation incomplete
drag/slider sparse
multi-frame Agent observation missing
post-action semantic outcome incomplete on some overlays
```

---

# 8. A4 one-action bridge

Manager path:

```text
control-center/manager/agent/broker_runtime_client.js
control-center/manager/agent/one_action_bridge.js
control-center/script/agent_one_action.js
```

Decision order:

```text
resolve browser context once
→ OBSERVE
→ Brain/harness decide one action
→ map action
→ sample behavior
→ build CDP plan
→ execute bound to tabId + observationId
→ OBSERVE AFTER same tab
```

No autonomous multi-step loop yet.

---

# 9. Native milestone — semantic basic click PASS

Command:

```bat
node script/agent_one_action.js --type click --label "Thông báo" --tab facebook
```

Evidence:

```text
resolved Facebook tab
selectedTarget.role = button
selectedTarget.label = Thông báo
cdpPlanVersion = 0.1.1
execution.ok = true
observationInvalidated = true
beforeObservationId != afterObservationId
```

Human visual confirmation: Facebook notification panel actually opened.

Classification:

```text
basic semantic native click executor = PASS
```

Do not overclaim: notification-panel contents were not fully surfaced by OBSERVE AFTER; this is observer/outcome fidelity, not click failure. Brain reasoning, autonomous planning and naturalness were not tested by this pass.

---

# 10. Native milestone — vertical page scroll PASS

Controlled page:

```text
https://en.wikipedia.org/wiki/Web_browser
```

Command:

```bat
node script/agent_one_action.js --type scrollVertical --direction 1 --host en.wikipedia.org --full
```

## 10.1 First native failure

The original existing function returned successful CDP dispatch but produced no meaningful visible page movement.

First investigation found generic page scroll used previous `agentPointer` as wheel coordinate. This could anchor wheel over a nested/control surface. Planner changed so generic page scroll uses `viewportCenter`; targeted/nested scrolling remains a separate concern.

Native retest still showed no meaningful movement, proving that was not the only root cause.

## 10.2 Root cause

Without generated empirical baseline, Behavior Policy emitted missing scroll metrics as `null`.

Old numeric helper semantics did:

```text
Number(null) = 0
```

This accidentally converted “metric absent” into real zero-like values before planner fallback logic.

Functional effect was approximately:

```text
duration → minimum bound
eventCount → 1
absoluteDelta → ~1 px
```

CDP could legitimately report success while the page appeared stationary.

Fix semantics:

```text
missing/empty behavior metric
→ remain null
→ planner recognizes absent value
→ conservative fallback activates
```

Fallback scroll plan approximately:

```text
durationMs = 220
eventCount = 4
absoluteDelta = 480 requested total burst
wheel anchor = viewport center
```

True numeric zero remains valid data; only null/empty means missing.

## 10.3 Native PASS evidence

After fix Wikipedia visibly moved.

OBSERVE AFTER:

```text
scroll.x = 0
scroll.y = 388
```

Independent geometry evidence from same semantic element `e405`:

```text
before rect.y = 5500.015625
after  rect.y = 5112.015625
difference     = 388 px
```

The matching 388 px values prove real document scroll rather than only successful command dispatch.

Classification:

```text
vertical scroll existing function = NATIVE PASS
```

This is functional correctness only; it does not claim natural human scroll quality.

PR/CI:

```text
PR:          #5
head:        f23e9bfb45d28ad3ad6d0e22f65e39874cf8b906
workflow:    runtime-syntax
run:         32924626320
result:      SUCCESS
merge:       21018224496dad3208c04a0a324fdcf7748c218b
```

Regression coverage now checks fallback scroll magnitude and viewport-center anchoring.

---

# 11. Native milestone — hover without click PASS

Controlled page:

```text
https://en.wikipedia.org/wiki/Web_browser
```

Command:

```bat
node script/agent_one_action.js --type hover --label "Browser market" --host en.wikipedia.org --full
```

Native human-visible evidence:

```text
Agent hover position reached Browser market
no mouse press/release side effect observed
no navigation occurred
Wikipedia page remained on Web browser article
```

Classification:

```text
hover existing function = NATIVE PASS
```

Important observability note: CDP `Input.dispatchMouseEvent` does not move the OS/native mouse cursor. Therefore a correct hover can be visually hard to verify when the target does not expose CSS/UI hover state.

A future **Agent Cursor debug overlay** is technically appropriate if scheduled, but it must obey this boundary:

```text
CDP plan / Runtime dispatch = source of truth for input
                 ↓ mirror only
Agent Cursor overlay = visualization/telemetry only
```

Requirements if implemented later:

```text
- consume exact dispatched mouse-event x/y and timing;
- never generate input or choose target;
- pointer-events:none;
- no influence on Strategy, Behavior, target registry or CDP plan;
- ideally render each actually-dispatched mouseMoved/pressed/released/wheel step rather than run an independent animation;
- optional click/ripple/trail visuals are debug presentation only.
```

Do not add this visualization as part of the current P0 function matrix unless explicitly scheduled; current focus remains validation of existing Agent functions.

---

# 12. Current native matrix

```text
tab inventory / matching          PASS
human keyword tab resolve         PASS
observe by keyword                PASS
semantic target selection         PASS
basic click dispatch 0.1.1        PASS
visible click effect              PASS
observation invalidation          PASS
OBSERVE AFTER                     PASS
vertical page scroll              PASS
hover without click               PASS

NEXT existing function:
horizontal scroll on controlled horizontal surface

THEN:
doubleClick
focus
typeText
back / forward

LATER invariant/evidence gates:
stale-ref rejection via existing interfaces
moving-target rejection/reobserve
post-action semantic outcome fidelity
keyboard listener fidelity
```

Do not start autonomous multi-step tasks yet.

---

# 13. Safety boundary

CAPTCHA/human verification:

```text
observe
→ blocked / human_verification_required
→ no automatic solve/bypass
→ no blind retry loop
```

Human login demonstrations may contribute timing/semantic operation classes but never credential content.

---

# 14. Architectural decisions

```text
D001 Scenario Mode and Agent Mode stay separate
D002 Recorder and Training Collector are different products
D003 Physical raw stays un-derived
D004 DOM semantics are core; physical data supplements behavior
D005 Correlate physical↔semantic near capture time
D006 Mutation uses bursts
D007 IndexedDB is browser-side raw persistence
D008 Manual/download export is fallback only
D009 RAW_BATCH retries are idempotent through receipts
D010 Natural Execution is a separate layer
D011 Hover may be semantic action with outcome
D012 Raw and resolved targets coexist
D013 sessionSeq is persistence order, not chronology
D014 hover-preview is derived offline
D015 CAPTCHA is Agent boundary condition
D016 Frame identity is composite
D017 all-frame Collector does not imply multi-frame Agent runtime
D018 SPA route change requires semantic re-anchor
D019 Stream silence must be observable
D020 Socket mirror is post-persist transport
D021 Socket resume uses server durable sequence
D022 Server tolerates duplicates and rejects gaps
D023 Socket disconnect is not immediate session end
D024 Continuous JSONL is preferred development archive
D025 Socket protocol requires integration CI
D026 Agent has its own semantic Action Contract
D027 CDP is Agent in-page execution standard
D028 Agent execution = Action → Behavior → CDP Plan → Executor
D029 Human demos define distributions/context, not literal replay
D030 Derived cleanup never mutates raw Collector truth
D031 A1 preserves safe physical facts required by A2
D032 Native descriptor field names are contract facts
D033 Stale targetRef triggers re-observation
D034 Hover windows embed bounded pointer approach/leave
D035 Strategy and Behavior eligibility are separate
D036 A2 is deterministic derived feature layer
D037 Sparse families remain explicitly sparse
D038 Brain sees semantics, not internal selectors
D039 Agent target refs are observation-bound
D040 Agent Runtime connects directly to broker; no Scenario proxy
D041 External CDP plans are allowlisted
D042 Brain decides only after OBSERVE and one action per loop
D043 Focus reuses pointer-click HOW distribution
D044 DoubleClick requires two native press/release cycles
D045 Browser context is first-class; user selector resolves once to tabId
D046 Multiple broker extension clients share port 3000 by agentId routing
D047 Dispatcher accepts planner 0.1.1 and retains 0.1.0 compatibility
D048 Functional Agent, Brain quality and natural behavior are separate gates
D049 Visible UI effect may validate executor even with incomplete semantic outcome capture
D050 Native functional validation tests existing capabilities on main first
D051 Implementation failures use one reusable experiment branch
D052 P0 in-page functional validation uses one unified CDP path
D053 Repeated tests prefer neutral/controlled pages
D054 Missing empirical metrics must remain absent/null; do not coerce null to numeric zero
D055 Generic page scroll anchors at viewport center; nested/targeted scroll is separate
D056 Any future visible Agent Cursor is debug telemetry only and mirrors actual dispatched mouse events; it never becomes an input/execution source
```

---

# 15. Maintenance rule

Journal only difficult facts that a future session must not rediscover:

```text
what is already PASS?
what command/evidence proved it?
what is deliberately NOT claimed?
what bug/regression was discovered?
what invariant/fix resolved it?
what is the next smallest native gate?
```

Do not log every commit.
