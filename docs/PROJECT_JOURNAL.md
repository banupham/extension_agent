# PROJECT JOURNAL — persistent engineering memory

Mục đích: bộ nhớ kỹ thuật lâu dài cho `banupham/extension_agent`.

```text
STATUS.md
→ current milestone / next gate

PROJECT_JOURNAL.md
→ lookup map / invariants / rationale / regressions

source trên main
→ implementation truth
```

Nếu journal mâu thuẫn với source, source hiện tại trên `main` là implementation truth; sau đó cập nhật journal.

---

# 1. Quy trình trước khi sửa code

```text
1 đọc STATUS.md
2 search journal theo component/problem
3 fetch source hiện tại trên main
4 fetch contract/test liên quan
5 sửa theo boundary
6 CI/offline test
7 native browser validation nếu runtime behavior
8 cập nhật STATUS/JOURNAL khi invariant/milestone thay đổi
```

Không kéo nhiều thay đổi chưa có native evidence vào cùng một branch. Khi một gate đã PASS, ưu tiên merge milestone nhỏ rồi mở bug/feature tiếp theo riêng.

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

```text
Strategy        = WHAT
Behavior Policy = HOW naturally
CDP Planner     = exact browser-native plan
Executor        = dispatch only
Browser Context = which exact Chrome tab/frame identity
```

Scenario Mode và Agent Mode không gộp contract.

Native functional validation của Agent không đồng nghĩa Brain đã thông minh hoặc natural behavior đã đạt chất lượng người dùng thật.

---

# 3. Collector stable baseline — V0.8

Runtime `0.8.0`, raw schema `0.7.2`.

```text
all-frame content capture
→ RAW_BATCH + batchId
→ background normalize + sessionSeq
→ IndexedDB append/receipt dedupe
→ localhost WebSocket mirror
→ append-only server JSONL
```

Invariant:

```text
IndexedDB persist first
→ socket mirror second
```

Native gate đã đạt:

```text
continuous socket archive      PASS
late-server replay             PASS
no missing/duplicate seq       PASS
multi-browser concurrent       PASS
multi-tab / multi-frame        PASS
SPA routes                     PASS
login-form observation         PASS
credential privacy             PASS
browser close >45s finalize    PASS
session-end                    PASS
```

Collector từ đây là stability/regression support. Manual gzip chỉ fallback/debug; không quay lại Downloads/offscreen làm primary pipeline.

Lookup:

```text
training-collector/core/socket_mirror.js
training-collector/background.js
training-collector/socket-server/server.js
training-collector/socket-server/integration_test.js
training-collector/tests/v08_socket_mirror_contract.js
```

Important comparison learned during Agent tab debugging:

```text
Collector continuous capture:
page/content-script event originates inside a tab
→ Chrome sender.tab/sender.frameId supplies identity

Agent broker command:
command originates outside page
→ no sender.tab identity
→ Agent Runtime must explicitly resolve/hold browser context
```

Collector does contain an `activeTab()` helper for episode anchoring, but continuous multi-tab raw capture does not depend on that helper. Do not conflate the two architectures again.

---

# 4. Collector raw/semantic invariants

Action target facts:

```text
rawTargetRef
resolvedTargetRef

targetDescriptor
resolvedTargetDescriptor
```

Không overwrite raw target bằng interpreted target.

Hover raw:

```text
dom-hover-enter
dom-hover-dwell
dom-hover-leave
```

`hover-preview` chỉ derive offline.

Frame identity:

```text
tabId + frameId + pageInstanceId + elementRef
```

Timeline:

```text
tsEpochMs  = primary global reconstruction time
pageSeq    = page-local order
sourceSeq  = source-local order
sessionSeq = persistence/integrity order only
```

Không sort behavior trajectory theo `sessionSeq`.

Privacy không lưu/train raw password, cookie, Authorization/token, clipboard, payment secret, local/session storage secret hoặc printable human key content.

---

# 5. A0 — Agent contract boundary COMPLETE

Read first:

```text
control-center/AGENT_ACTION_CONTRACT.json
control-center/manager/strategy/agent_action_contract.js
control-center/manager/strategy/execution_behavior_contract.js
docs/AGENT_ACTION_CDP_MAP.md
```

Invariant:

```text
Strategy không emit selector / coordinates / CDP method.
Behavior không chọn task intent.
Executor không chọn strategy.
```

CDP là chuẩn in-page execution; `chrome.tabs.*` là tab control-plane.

---

# 6. A1 — Action Window COMPLETE

```text
training-collector/tools/build_action_windows.js
training-collector/tools/analyze_action_windows.js
training-collector/tests/action_window_contract.js
training-collector/tests/action_window_quality_contract.js
docs/A1_NATIVE_DATASET_VALIDATION.md
```

Current `actionWindowVersion 0.1.4`.

```text
BEFORE
→ semantic action
→ AFTER / mutation / route
→ OUTCOME
```

Families:

```text
click / dismiss / toggle
focus / selectOption / submit
drag
hover / hoverAndObserve
scrollVertical / scrollHorizontal
typeText / pressKey
```

A1 giữ safe physical facts cho A2; hover window nhúng pointer approach/leave bounded; label enrichment đọc `resolvedTargetDescriptor` đúng với native raw; hover background noise chỉ lọc ở derived dataset.

Strategy eligibility và Behavior eligibility là hai khái niệm khác nhau.

---

# 7. A2 — Behavior Features COMPLETE

```text
training-collector/tools/extract_behavior_features.js
training-collector/tools/analyze_behavior_features.js
docs/A2_NATIVE_FEATURE_VALIDATION.md
```

Current `behaviorFeatureVersion 0.2.0`.

Feature groups:

```text
pointer:
  duration / displacement / path length
  speed / acceleration
  straightness / turn / correction

click:
  acquisition pause
  down→up hold
  endpoint error vs target geometry

hover:
  approach / dwell / leave / outcome

scroll:
  vertical/horizontal burst separately
  delta / timing / correction ratio

keyboard:
  hold / inter-key / pause / operation class
  no printable human content
```

Native gate: click/hover/scroll/keyboard đủ để bắt đầu empirical baseline; drag vẫn sparse.

---

# 8. A3 — Empirical Behavior Baseline READY

```text
training-collector/tools/build_behavior_baseline.js
control-center/manager/behavior/empirical_policy.js
control-center/script/checks/empirical_behavior_policy.js
```

Baseline `0.1.0` lưu aggregate quantiles only:

```text
p10 / p25 / p50 / p75 / p90
```

Không lưu/replay literal human trajectory.

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

`focus-acquisition` dùng `pointer-click` baseline cho phần HOW; semantic action vẫn là `focus`.

Real baseline JSON là generated local artifact từ native raw sessions, không hard-code vào source.

Current native A4 functional tests may use conservative fallback behavior. Functional correctness is validated before naturalness quality; do not treat a fallback-profile native click PASS as proof of human-like behavior quality.

---

# 9. Agent Runtime V0.2 — P0 native validation

Read first:

```text
control-center/extension/agent-runtime-extension/manifest.json
control-center/extension/agent-runtime-extension/target_registry.js
control-center/extension/agent-runtime-extension/tab_context.js
control-center/extension/agent-runtime-extension/cdp_plan_dispatcher.js
control-center/extension/agent-runtime-extension/broker_client.js
control-center/extension/agent-runtime-extension/background.js
```

## 9.1 Observation registry

```text
observationId + targetRef
→ tab/frame
→ semantic descriptor
→ observed rect
→ internal-only selector if available
```

Public observation không expose selector.

Stale rules:

```text
new observation
navigation/loading
TTL expiry (currently 4 s)
debugger detach
→ old refs invalid
```

Stale ref phải fail và re-observe, không blind reuse coordinates.

Known moving-target risk: registry validates observation/ref/tab/url/interactability but initial implementation returns captured rect rather than rereading current geometry immediately before dispatch. If native evidence shows movement, prefer reject → re-observe instead of silent retarget in Executor.

## 9.2 Browser/tab context

Agent broker commands originate outside a content script and therefore need explicit context.

Broker/runtime actions:

```text
agentStatus
agentListTabs
agentObserveTabs
agentObserve
agentExecutePlan
```

Tab scopes:

```text
active
visible = active web tab in each normal window
matching = hostname/url/title facts
all = all http/https tabs
```

User-facing CLI may say:

```bat
--tab facebook
--on facebook
--host facebook.com
--title-includes Facebook
```

Resolution rule:

```text
human selector
→ list browser facts
→ deterministic unique match
→ exact internal tabId
→ OBSERVE(tabId)
→ EXECUTE(tabId + observationId)
→ OBSERVE AFTER(tabId)
```

If several candidates remain and no unique active match exists, reject ambiguity; do not guess. Numeric tabId remains debugging/internal identity, not preferred user language.

Native evidence 2026-08-26:

```text
list tabs                         PASS
switch tab and relist             PASS
matching --host facebook.com      PASS
observe --tab facebook            PASS
resolved observation.tabId/url    PASS
```

## 9.3 Broker routing note

One broker server listens on `127.0.0.1:3000`. Multiple extensions are WebSocket clients and may share that server. Broker stores extensions by `agentId` and routes commands to the selected agent.

During debugging, `/agents` initially showed only Stealth Executor; after Agent Runtime was actually loaded/registered it appeared as:

```text
meta.product = agent-runtime
runtimeVersion = 0.2.1
```

This was not a TCP port-listen collision between two servers. Do not diagnose future `no_agent_runtime_connected` solely as “port conflict”; inspect `/agents` and `meta.product` first.

## 9.4 EXECUTE_PLAN allowlist and plan versions

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

Không có arbitrary CDP tunnel từ Brain.

Important regression discovered in native click test:

```text
manager CDP planner emitted: 0.1.1
runtime dispatcher accepted: 0.1.0 only
→ unsupported_cdp_plan_version
```

Fix after native branch validation:

```text
SUPPORTED_PLAN_VERSIONS = {0.1.0, 0.1.1}
LATEST_PLAN_VERSION = 0.1.1
```

Keep legacy `0.1.0` acceptance for backward compatibility, reject unknown versions, and preserve method/delay validation.

After a plan executes, observation is invalidated and OBSERVE AFTER is mandatory.

---

# 10. CDP Execution Planner — v0.1.1

```text
control-center/manager/execution/cdp_plan.js
control-center/script/checks/cdp_execution_plan.js
control-center/script/checks/cdp_plan_dispatcher.js
```

Pointer click:

```text
sample target point inside rect
→ bounded curved approach
→ optional micro-correction
→ dwell
→ press
→ empirical hold
→ release
```

Double click được chuẩn hóa thành hai cycle:

```text
press/release clickCount=1
→ bounded inter-click gap
→ press/release clickCount=2
```

Không dùng một single press/release `clickCount=2` nữa.

Focus compile theo pointer acquisition + click, dùng pointer-click empirical baseline.

Scroll vertical/horizontal là multi-event wheel burst riêng từng axis.

Typing hiện dùng per-character `Input.insertText` với empirical timing. Native test phải kiểm tra site listener fidelity trước khi quyết định chuyển sang keyDown/keyUp synthesis.

Native basic pointer-click dispatch with plan `0.1.1` is now PASS. This proves functional compatibility, not naturalness quality.

Known runtime gaps:

```text
keyCombo modifiers incomplete
moving-target geometry revalidation chưa robust
drag/slider sparse
multi-frame Agent observation chưa có
post-action semantic outcome capture may be incomplete on dynamic overlays
```

---

# 11. A4 — One-action Agent bridge native progress

Manager path:

```text
control-center/manager/agent/broker_runtime_client.js
control-center/manager/agent/one_action_bridge.js
control-center/script/agent_one_action.js
```

Correct decision order:

```text
resolve browser context once
→ OBSERVE
→ Brain/harness decide(observation)
→ exactly ONE Agent Action
→ map action
→ sample behavior
→ build CDP plan
→ execute plan bound to tabId + observationId
→ OBSERVE AFTER same tab
```

`blocked`/terminal decision executes nothing.

## 11.1 Native functional evidence — Facebook notification button

Command:

```bat
node script/agent_one_action.js --type click --label "Thông báo" --tab facebook
```

Evidence captured:

```text
resolved tab: Facebook
selectedTarget.ref: e13
selectedTarget.role: button
selectedTarget.label: Thông báo
mapped action: click / pointer-click
cdpPlanVersion: 0.1.1
CDP steps: 4 mouse events
execution.ok: true
resultCount: 4
observationInvalidated: true
beforeObservationId != afterObservationId
```

Human visual confirmation: the Facebook “Thông báo” panel actually opened.

Classification:

```text
basic semantic native click executor = PASS
```

Do not overclaim:

```text
post-click observer did not surface notification panel contents as completely as desired
→ record as observer/outcome-fidelity evidence
→ not a click executor failure

this test did not validate:
Brain goal reasoning
autonomous multi-step planning
natural/human-like behavior quality
```

This distinction matters: current phase is testing Agent functions/tay chân first. Brain and natural behavior are separate gates.

## 11.2 Current native matrix

```text
tab inventory / matching          PASS
human keyword tab resolve         PASS
observe Facebook by keyword       PASS
semantic target selection         PASS
basic click dispatch 0.1.1        PASS
visible click effect              PASS
observation invalidation          PASS
OBSERVE AFTER new observation     PASS

pending:
stale-ref rejection
doubleClick native behavior
hover without click
vertical scroll
horizontal carousel scroll
focus + typeText
back / forward
moving-target rejection/reobserve
post-action semantic outcome fidelity
```

---

# 12. Safety boundary

CAPTCHA/human verification:

```text
observe
→ status=blocked
→ reasonCode=human_verification_required
→ no automatic solve/bypass
→ no blind retry loop
```

Human login demonstrations có thể đóng góp timing/semantic form behavior nhưng không credential content.

---

# 13. Architectural decisions

## D001 — Scenario Mode and Agent Mode stay separate
## D002 — Recorder and Training Collector are different products
## D003 — Physical raw stays un-derived
## D004 — DOM semantics are core; physical supplements behavior
## D005 — Correlate physical↔semantic near capture time
## D006 — Mutation uses bursts
## D007 — IndexedDB is browser-side raw persistence
## D008 — Manual/download export is fallback only
## D009 — Batch receipts make RAW_BATCH retries idempotent
## D010 — Natural Execution is a separate layer
## D011 — Hover can be semantic action with outcome
## D012 — Raw and resolved action targets coexist
## D013 — sessionSeq is persistence order, not chronology
## D014 — hover-preview is derived offline
## D015 — CAPTCHA is Agent boundary condition
## D016 — Frame identity is composite
## D017 — All-frame raw does not imply multi-frame Agent episode/runtime
## D018 — SPA route change needs semantic re-anchor
## D019 — Stream silence must be observable
## D020 — Socket mirror is post-persist transport
## D021 — Socket resume uses server durable sequence
## D022 — Server tolerates duplicates and rejects gaps
## D023 — Socket disconnect is not immediate session end
## D024 — Continuous JSONL is preferred development archive
## D025 — Socket protocol requires integration CI
## D026 — Agent has its own semantic Action Contract
## D027 — CDP is Agent in-page execution standard
## D028 — Agent execution is Action → Behavior → CDP Plan → Executor
## D029 — Human demonstrations define distributions/context, not literal replay
## D030 — Derived cleanup never mutates raw Collector truth
## D031 — A1 preserves safe physical facts required by A2
## D032 — Native descriptor field names are contract facts
## D033 — Stale targetRef triggers re-observation
## D034 — Hover windows embed bounded pointer approach/leave
## D035 — Strategy and Behavior eligibility are separate
## D036 — A2 is deterministic derived feature layer
## D037 — Sparse action families remain explicitly sparse
## D038 — Brain sees semantics, not internal selectors
## D039 — Agent target refs are observation-bound, not global IDs
## D040 — Agent Runtime connects directly to broker; no Scenario proxy
## D041 — External CDP plans are allowlisted
## D042 — Brain decides only after OBSERVE and one action per loop
## D043 — Focus reuses pointer-click HOW distribution, not a separate invented distribution
## D044 — DoubleClick requires two native press/release cycles
## D045 — Browser context is first-class; user-facing selector resolves once to exact tabId
## D046 — Multiple broker extension clients may share port 3000; routing is by agentId/product identity
## D047 — Dispatcher accepts planner 0.1.1 while retaining 0.1.0 compatibility after native evidence
## D048 — Functional Agent PASS, Brain-quality PASS and natural-behavior PASS are separate milestones
## D049 — Visible native UI effect may validate executor even when OBSERVE AFTER semantic outcome capture is incomplete

---

# 14. Next native gate

Continue one action/function at a time before autonomous loops:

```text
DONE:
TAB CONTEXT / human selector
OBSERVE semantic targets
basic click + visible UI effect
OBSERVE AFTER / invalidation

NEXT:
stale ref rejection
doubleClick safe target
hover only
vertical scroll
horizontal carousel scroll
focus then type non-sensitive text
back / forward
moving-target rejection/reobserve
```

Measure functional correctness first.

Separate later measurements:

```text
Brain goal quality
post-action semantic outcome completeness
4 s TTL under real model latency
Input.insertText listener fidelity
pointer path naturalness
human-like timing quality
```

Remaining P1 after native P0 gate:

```text
drag / slider / seek
scrollIntoView
selectOption / setChecked / submit / dismiss
tab lifecycle
hoverAndObserve / waitAndObserve outcome policy
multi-frame Agent target registry
robust moving-target revalidation
modifier-aware keyCombo
```

---

# 15. Maintenance rule

Update journal when module responsibility, contract/protocol, difficult invariant, version/migration, native test gate or architecture boundary changes. Do not log every commit.

For runtime work, every merged native milestone should leave enough evidence here that a fresh conversation can answer:

```text
what is already PASS?
what exact command/evidence proved it?
what is deliberately NOT claimed?
what bug/regression was discovered and fixed?
what is the next smallest native gate?
```
