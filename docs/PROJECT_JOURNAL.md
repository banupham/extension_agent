# PROJECT JOURNAL — persistent engineering memory

Mục đích: bộ nhớ kỹ thuật lâu dài cho `banupham/extension_agent`.

```text
STATUS.md
→ current milestone / next step

PROJECT_JOURNAL.md
→ code lookup / invariants / rationale / traps / regression cases

source trên main
→ implementation truth
```

Nếu journal và source mâu thuẫn, fetch source hiện tại trên `main`, sửa code theo source, rồi cập nhật lại journal.

---

# 1. Quy trình trước khi sửa code

```text
1 đọc STATUS.md
2 search PROJECT_JOURNAL.md theo component/problem
3 fetch đúng source files được chỉ ra
4 fetch contract/test liên quan
5 sửa nhỏ theo boundary hiện có
6 chạy CI; browser validation nếu là runtime/browser behavior
7 update STATUS/JOURNAL nếu có knowledge dài hạn mới
```

Không quét toàn repo nếu journal đã xác định được vùng code.

---

# 2. Product boundaries

```text
RECORDER
Human → deterministic Scenario

TRAINING COLLECTOR
Human → raw physical + semantic browser session

AGENT
Task → Strategy → Action Contract → Behavior Policy → CDP Executor
```

Recorder không phải raw training collector. Collector observe-only. Agent Strategy/model không phát raw CDP.

```text
Strategy       = WHAT to do
Behavior Model = HOW naturally
Executor       = translate execution plan to CDP
```

---

# 3. Training Collector code lookup

## Physical pointer / wheel / keyboard / idle / focus

Đọc:

```text
training-collector/capture/physical_capture.js
training-collector/correlation/physical_semantic_correlator.js
training-collector/content.js
training-collector/core/reliable_sender.js
```

Invariants:

- raw physical không bake velocity/acceleration/path distributions;
- printable keyboard không lưu actual char/code;
- sensitive target filter trước khi data rời content script;
- physical↔semantic target correlation gần capture time.

## DOM click/focus/input/change/submit

Đọc:

```text
training-collector/capture/dom_capture.js
training-collector/correlation/action_target_resolver.js
training-collector/observer/semantic_observer.js
training-collector/observer/element_registry.js
training-collector/content.js
```

V0.7 click target contract:

```text
targetRef          legacy/raw event target
rawTargetRef       raw DOM event.target
resolvedTargetRef  best actionable target
targetResolution   method + confidence
```

Resolver priority:

```text
composedPath actionable
→ elementFromPoint actionable
→ raw target actionable ancestor
→ raw target
```

Không overwrite raw target bằng resolved target.

## Hover / preview / dynamic controls

Đọc:

```text
training-collector/observer/hover_trace.js
training-collector/correlation/action_target_resolver.js
training-collector/capture/physical_capture.js
training-collector/observer/mutation_trace.js
training-collector/content.js
training-collector/tools/build_action_semantics.js
training-collector/tests/v07_action_semantics_contract.js
```

Raw V0.7 chỉ ghi direct facts:

```text
dom-hover-enter
dom-hover-dwell
dom-hover-leave
```

Không ghi `hover-preview` trực tiếp vào raw. `hover-preview` là derived semantic action ở offline builder.

Regression case chuẩn:

```text
YouTube recommended thumbnail
→ pointer enters thumbnail
→ dwell
→ animated preview starts
→ mute/audio control appears
→ no navigation
```

Phải phân biệt:

```text
hover-preview
click-open
click-control
```

## Mutation

Đọc:

```text
training-collector/observer/mutation_trace.js
training-collector/observer/element_registry.js
training-collector/content.js
training-collector/tools/analyze_raw.js
training-collector/tools/build_action_semantics.js
```

Current raw policy:

```text
dom-mutation-burst ~120 ms
```

Không dump innerHTML/textContent/raw value. Mutation relevance là dataset/derived concern.

V0.7 timeline detail: mutation burst nhận `pageSeq/sourceSeq` lúc burst bắt đầu, không phải lúc flush sau 120 ms.

## Semantic element / visibility / selector

Đọc:

```text
training-collector/observer/semantic_observer.js
training-collector/observer/element_registry.js
training-collector/correlation/physical_semantic_correlator.js
training-collector/core/state_diff.js
```

Current fields:

```text
rendered
inViewport
interactable
selectorCandidates + score
```

`elementRef` chỉ stable trong page context; không coi `e17` globally unique qua page/tab/frame.

## Timeline ordering

Đọc:

```text
training-collector/content.js
training-collector/capture/physical_capture.js
training-collector/capture/dom_capture.js
training-collector/observer/mutation_trace.js
training-collector/observer/hover_trace.js
training-collector/background.js
```

V0.7 ordering fields:

```text
tsEpochMs  capture timestamp
pageSeq    page-local capture order
sourceSeq  source-local order
sessionSeq background persistence order
```

`sessionSeq` không phải chronological truth.

---

# 4. Raw persistence / reliability lookup

Đọc:

```text
training-collector/core/raw_session_store.js
training-collector/core/indexeddb_chunk_store.js
training-collector/core/reliable_sender.js
training-collector/background.js
training-collector/tests/v06_storage_contract.js
```

Current:

```text
runtime/raw schema: 0.7.0
IndexedDB DB: trainingCollectorRawV06
chunk size: 1000
stores: sessions / chunks / batchReceipts
```

DB name V06 được giữ để không tạo migration storage không cần thiết; schema session/event mới là 0.7.0.

Retry invariant:

```text
same batchId retry
→ receipt exists
→ ACK again
→ never append duplicate events
```

Integrity:

```text
missing chunk
checksum mismatch
eventCount metadata mismatch
firstSeq/lastSeq mismatch
sequence gap between chunks
```

Không tự xóa raw data khi integrity fail.

---

# 5. Export lookup

Manual:

```text
training-collector/popup.js
training-collector/background.js
training-collector/popup.html
```

Automatic development export:

```text
training-collector/background.js
training-collector/offscreen.html
training-collector/offscreen.js
training-collector/manifest.json
training-collector/tests/v06_storage_contract.js
```

Flow:

```text
closed IndexedDB session
→ full integrity verify
→ offscreen CompressionStream(gzip)
→ Downloads/training-collector/*.raw.jsonl.gz
```

Important invariant:

```text
IndexedDB = persistence chính
JSONL.gz download = temporary development convenience only
```

Auto-export có per-session in-flight lock + persisted complete status + retry limit.

---

# 6. Analyzer / derived dataset lookup

Raw diagnostics:

```text
training-collector/tools/analyze_raw.js
training-collector/tests/raw_analysis_contract.js
```

V0.7 action semantics:

```text
training-collector/tools/build_action_semantics.js
training-collector/tests/v07_action_semantics_contract.js
```

`build_action_semantics.js` đọc raw JSON/JSONL/JSONL.gz và hiện derive hover windows từ:

```text
hover enter/dwell/leave
+ mutation bursts
+ click evidence
+ pageSeq/timestamp ordering
```

Output hiện phân loại conservative:

```text
hover
hover-dwell
hover-preview
```

Không coi heuristic derived output là raw truth. Thuật toán có thể thay đổi mà không cần thu lại raw data.

---

# 7. Agent lookup

Strategy:

```text
control-center/manager/strategy/index.js
control-center/manager/strategy/contracts.js
control-center/manager/strategy/baseline_strategy.js
control-center/manager/strategy/README.md
docs/AGENT_TRAINING_ARCHITECTURE.md
```

Execution:

```text
control-center/extension/agent-runtime-extension/background.js
control-center/ACTION_CONTRACT.json
control-center/script/checks/strategy_contract.js
```

Natural Execution planned flow:

```text
Normalized Action
→ Execution Behavior Contract
→ Behavior Policy / Synthesizer
→ CDP Executor
```

Không dùng random delay/jitter làm nền tảng behavior.

---

# 8. Recorder / deterministic scenario lookup

```text
recorder/content.js
recorder/background.js
recorder/ACTION_CONTRACT.json
recorder/README.md
docs/RECORDED_CLICK.md
docs/KEYBOARD.md
```

Scenario executor:

```text
control-center/manager/control_center.js
control-center/script/checks/run_check.js
control-center/ACTION_CONTRACT.json
control-center/extension/stealth-extension/background.js
```

Không phá deterministic Scenario Mode khi phát triển Agent/Collector.

---

# 9. Privacy invariants

Đọc:

```text
training-collector/core/privacy.js
training-collector/observer/semantic_observer.js
training-collector/capture/physical_capture.js
```

Không thu/lưu:

- password values;
- cookies;
- Authorization/access/refresh tokens;
- localStorage/sessionStorage secret contents;
- clipboard contents;
- payment secrets;
- raw sensitive input values;
- printable keyboard actual character/code;
- URL query values/hash content;
- raw document title theo policy hiện tại.

---

# 10. CI map

Workflow:

```text
.github/workflows/extension-syntax.yml
```

Collector contracts:

```text
training-collector/tests/architecture_contract.js
training-collector/tests/raw_session_contract.js
training-collector/tests/raw_analysis_contract.js
training-collector/tests/v06_storage_contract.js
training-collector/tests/v07_action_semantics_contract.js
```

V0.7 new syntax coverage:

```text
observer/hover_trace.js
correlation/action_target_resolver.js
tools/build_action_semantics.js
```

CI success != Chrome integration tested.

---

# 11. Architectural decisions

## D001 — Scenario Mode và Agent Mode tách biệt
Bảo vệ deterministic execution hiện có.

## D002 — Collector và Recorder là hai sản phẩm khác nhau
Recorder → deterministic Scenario; Collector → training telemetry.

## D003 — Raw physical data raw/un-derived
Velocity/acceleration/curvature/pause distributions derive offline.

## D004 — DOM core signal, physical supplementary
Agent cần target/state/outcome, không chỉ trajectory.

## D005 — Physical↔semantic correlation tại capture time
Tránh target drift do DOM/focus thay đổi.

## D006 — Mutation dùng burst
Quyết định sau V0.4 cho thấy mutation chiếm ~89% stream trong một session thật.

## D007 — IndexedDB là raw persistence chính
`chrome.storage.local` không phù hợp long-session raw event store.

## D008 — Download export chỉ là development adapter
Không biến temporary auto-export thành production architecture.

## D009 — Batch receipt bảo đảm retry idempotent
Serialized append không đủ chống ACK loss.

## D010 — Natural Execution là layer riêng
Strategy=WHAT, Behavior=HOW, Executor=CDP.

## D011 — Hover có thể là semantic action có outcome
Hover có thể mở preview/menu/tooltip/control mà không click/navigation.

## D012 — Raw target và resolved action target phải cùng tồn tại
Do DOM `event.target` có thể là wrapper/container; resolved target là interpretation, không được phá raw fact.

## D013 — V0.7 thêm pageSeq/sourceSeq
`sessionSeq` là persistence order; dataset reconstruction cần page/source-local ordering bên cạnh timestamp.

## D014 — `hover-preview` derive offline
Raw lưu hover lifecycle + mutation/state facts; classification algorithm được phép thay đổi sau này.

---

# 12. Engineering diary

## 2026-08-25 — Journal created
Dự án dài và nhiều product/module; cần persistent lookup memory trên GitHub.

## 2026-08-25 — V0.6.1 temporary auto-export
Offscreen gzip exporter + startup detection cho closed IndexedDB sessions. Explicitly development-only.

## 2026-08-25 — Native V0.6.1 hover regression discovered
User-confirmed:

```text
Action A
hover YouTube thumbnail
→ preview động
→ nút loa/mute xuất hiện
→ không navigation

Action B
click "Bỏ qua" quảng cáo
→ local ad/control state transition
```

Case này dẫn tới V0.7 Action Semantics.

## 2026-08-25 — V0.7 Action Semantics implemented
New files:

```text
training-collector/correlation/action_target_resolver.js
training-collector/observer/hover_trace.js
training-collector/tools/build_action_semantics.js
training-collector/tests/v07_action_semantics_contract.js
```

Changed contracts:

```text
raw schema 0.6.0 → 0.7.0
hover direct facts added
rawTargetRef/resolvedTargetRef added for DOM click
pageSeq/sourceSeq added at content capture
mutation sequence assigned at burst start
```

Synthetic regression fixture is embedded in contract test. Không commit raw user session vào repo.

Next gate:

```text
native Chrome V0.7 session
→ validate hover lifecycle
→ validate target resolver
→ validate page/source ordering
→ run offline action semantics builder
→ decide remaining fixes before Behavior Dataset
```

---

# 13. Journal maintenance rules

Update journal khi:

- file/module responsibility thay đổi;
- contract mới xuất hiện;
- dependency khó nhớ xuất hiện;
- bug khó lộ invariant mới;
- temporary mechanism thêm/xóa;
- architecture decision thay đổi;
- migration/version đổi điểm bắt đầu cho future edits.

Không dump mọi commit vào journal.
