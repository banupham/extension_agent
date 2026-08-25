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

---

# 2. Product boundaries

```text
RECORDER
Human → deterministic Scenario

TRAINING COLLECTOR
Human → raw physical + semantic browser session

AGENT
Task → Strategy → Agent Action → Behavior → CDP Plan → Executor
```

```text
Strategy        = WHAT
Behavior Policy = HOW naturally
CDP Planner     = exact browser-native plan
Executor        = dispatch only
```

Scenario Mode và Agent Mode không gộp contract.

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

---

# 9. Agent Runtime V0.2 — P0 tay chân READY

Read first:

```text
control-center/extension/agent-runtime-extension/manifest.json
control-center/extension/agent-runtime-extension/target_registry.js
control-center/extension/agent-runtime-extension/cdp_plan_dispatcher.js
control-center/extension/agent-runtime-extension/broker_client.js
control-center/extension/agent-runtime-extension/background.js
```

Observation registry:

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

Direct Agent Runtime broker:

```text
meta.product = agent-runtime
agentStatus
agentObserve
agentExecutePlan
```

Agent Mode không proxy qua Stealth/Scenario extension.

`EXECUTE_PLAN` allowlist:

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

---

# 10. CDP Execution Planner — v0.1.1

```text
control-center/manager/execution/cdp_plan.js
control-center/script/checks/cdp_execution_plan.js
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

Known runtime gaps:

```text
keyCombo modifiers incomplete
moving-target geometry revalidation chưa robust
drag/slider sparse
multi-frame Agent observation chưa có
```

---

# 11. A4 — One-action Agent bridge READY FOR NATIVE TEST

Manager path:

```text
control-center/manager/agent/broker_runtime_client.js
control-center/manager/agent/one_action_bridge.js
control-center/script/agent_one_action.js
```

Correct decision order:

```text
OBSERVE
→ Brain decide(observation)
→ exactly ONE Agent Action
→ map action
→ sample behavior
→ build CDP plan
→ execute plan bound to observationId
→ OBSERVE AFTER
```

`blocked`/terminal decision executes nothing.

Native harness examples:

```bat
node control-center/script/agent_one_action.js --observe
node control-center/script/agent_one_action.js --type click --label "Example label"
node control-center/script/agent_one_action.js --type doubleClick --label "Example label"
node control-center/script/agent_one_action.js --type hover --label "Example label"
node control-center/script/agent_one_action.js --type focus --label "Search"
node control-center/script/agent_one_action.js --type typeText --text "agent test"
node control-center/script/agent_one_action.js --type scrollVertical --direction 1
```

Optional:

```text
--baseline <generated baseline.json>
--tab <tabId>
--agent <runtime-agentId>
--full
```

Latest full gate after focus + two-cycle doubleClick:

```text
run:    32910975163
commit: 7667e66404b6aef7405b180a11707b0987975a5f
result: SUCCESS
```

CI success != native Chrome validation.

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

---

# 14. Next native gate

Validate one action at a time before autonomous loops:

```text
OBSERVE target semantics
click + re-observe
doubleClick safe target
hover only
vertical scroll
horizontal carousel scroll
focus then type non-sensitive text
back / forward
stale ref rejection
```

Measure:

```text
4 s TTL adequacy
moving target between observe/execute
two-cycle doubleClick behavior
Input.insertText listener fidelity
pointer path naturalness
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

Update journal when module responsibility, contract/protocol, difficult invariant, version/migration, test gate or architecture boundary changes. Do not log every commit.
