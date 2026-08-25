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

Nếu journal và source mâu thuẫn, fetch source hiện tại trên `main`, sửa theo source, rồi cập nhật journal.

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

```text
Strategy       = WHAT to do
Behavior Model = HOW naturally
Executor       = translate execution plan to CDP
```

Recorder không phải raw training collector. Collector observe-only. Strategy/model không phát raw CDP.

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

Target contract:

```text
targetRef          legacy/raw event target
rawTargetRef       raw DOM event.target
resolvedTargetRef  best actionable target
targetResolution   method + confidence
```

Không overwrite raw target bằng resolved target.

## Hover / preview / dynamic controls

Đọc:

```text
training-collector/observer/hover_trace.js
training-collector/correlation/action_target_resolver.js
training-collector/observer/mutation_trace.js
training-collector/content.js
training-collector/tools/build_action_semantics.js
training-collector/tests/v07_action_semantics_contract.js
```

Raw ghi direct facts:

```text
dom-hover-enter
dom-hover-dwell
dom-hover-leave
```

`hover-preview` derive offline, không ghi trực tiếp vào raw.

Regression case chuẩn:

```text
YouTube thumbnail hover
→ dwell
→ animated preview
→ mute/audio control appears
→ no navigation
```

Phân biệt ít nhất:

```text
hover-preview
click-open
click-control
```

## Mutation

Đọc:

```text
training-collector/observer/mutation_trace.js
training-collector/tools/analyze_raw.js
training-collector/tools/build_action_semantics.js
```

Current policy: `dom-mutation-burst ~120 ms`. Không dump innerHTML/textContent/raw values. Mutation relevance là derived/dataset concern.

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

```text
tsEpochMs  capture timestamp
pageSeq    page-local capture order
sourceSeq  source-local order
sessionSeq background persistence order
```

`sessionSeq` không phải chronological truth. Mutation burst nhận page/source sequence lúc burst bắt đầu.

---

# 4. Frame-aware / SPA / stream diagnostics lookup — V0.7.2

Đọc trước:

```text
training-collector/manifest.json
training-collector/content.js
training-collector/observer/route_trace.js
training-collector/background.js
training-collector/core/raw_session_store.js
training-collector/tools/analyze_raw.js
training-collector/tests/v072_frame_stream_contract.js
```

## Frame capture contract

Manifest:

```text
all_frames = true
match_about_blank = true
match_origin_as_fallback = true
```

Mỗi matching frame chạy Collector raw riêng và có `pageInstanceId` riêng. Background persistence bổ sung:

```text
tabId
windowId
frameId
documentId
documentLifecycle
```

Composite element identity:

```text
tabId + frameId + pageInstanceId + elementRef
```

Không coi `e17` globally unique qua frame/page/tab.

Coordinates trong iframe là client coordinates của frame đó. `frame-context.coordinateSpace = frame-client` là convention hiện tại.

Continuous raw telemetry = all-frame. Optional Task Episode = top-frame only cho tới khi Agent Observation/Decision contract có explicit multi-frame model.

Không vô tình mở episode transitions ở subframe chỉ vì raw Collector all-frame.

## SPA route trace

File:

```text
training-collector/observer/route_trace.js
```

Reason: semantic snapshot cũ chỉ phát khi content start; Google/YouTube SPA có thể thay route mà không reload.

Detection:

```text
popstate
hashchange
location.href poll 500 ms
```

Output:

```text
route-change
semantic-snapshot snapshotReason=route-change
```

Chỉ lưu sanitized page representation; không lưu query values/hash content.

## Stream health

Direct raw diagnostics:

```text
collector-stream-start
collector-stream-health
collector-stream-stop
```

Health interval: 10 s.

Payload gồm:

```text
isTopFrame
readyState
visibilityState
viewport
module availability
cumulative sourceEventCounts
```

Analyzer dùng health để phát hiện conservative suspicion:

```text
missingInitialSemantic
physicalOnlySuspicion
```

Không suy `dom=0` đơn lẻ thành bug vì một frame có thể không có DOM interaction. `physicalOnlySuspicion` chỉ là diagnostic flag, không phải ground truth.

## Schema upgrade isolation

Raw schema hiện `0.7.2`.

Nếu current active session có schema khác:

```text
close old session
endReason = schema_upgrade_to_0.7.2
→ auto-export/recovery old session
→ create clean 0.7.2 session
```

Không trộn version raw trong cùng active session.

---

# 5. Raw persistence / reliability lookup

Đọc:

```text
training-collector/core/raw_session_store.js
training-collector/core/indexeddb_chunk_store.js
training-collector/core/reliable_sender.js
training-collector/background.js
training-collector/offscreen.js
training-collector/popup.js
training-collector/tests/v06_storage_contract.js
```

Current:

```text
runtime/raw schema: 0.7.2
IndexedDB DB: trainingCollectorRawV06
chunk size: 1000
stores: sessions / chunks / batchReceipts
```

DB name V06 giữ để tránh migration storage không cần thiết.

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

## Auto-export recovery

Files:

```text
training-collector/core/indexeddb_chunk_store.js
training-collector/background.js
training-collector/offscreen.js
training-collector/popup.js
training-collector/popup.html
```

Flow:

```text
status-indexed recovery
→ dangling active inferred closed
→ stale verifying/preparing/downloading reset pending
→ closed session scan
→ full integrity verify
→ offscreen gzip
→ chrome.downloads.download
→ wait downloads.onChanged state=complete
→ mark autoExport.complete
```

Invariant:

```text
IndexedDB = persistence chính
JSONL.gz download = temporary development convenience only
```

Không đánh dấu complete chỉ vì có `downloadId`.

---

# 6. Analyzer / derived dataset lookup

Raw diagnostics:

```text
training-collector/tools/analyze_raw.js
training-collector/tests/raw_analysis_contract.js
```

Analyzer hiện đọc:

```text
legacy JSON
JSONL
JSONL.gz
```

V0.7.2 report thêm:

```text
frame/document/pageInstance coverage
per-frame source distribution
route-change/snapshot count
stream-health summaries
physical-only suspicion
```

Action semantics:

```text
training-collector/tools/build_action_semantics.js
training-collector/tests/v07_action_semantics_contract.js
```

Derived output là heuristic, không phải raw truth.

---

# 7. Agent lookup

Strategy:

```text
control-center/manager/strategy/index.js
control-center/manager/strategy/contracts.js
control-center/manager/strategy/baseline_strategy.js
control-center/manager/strategy/README.md
docs/AGENT_TRAINING_ARCHITECTURE.md
docs/AGENT_BOUNDARY_CONDITIONS.md
```

Execution:

```text
control-center/extension/agent-runtime-extension/background.js
control-center/ACTION_CONTRACT.json
control-center/script/checks/strategy_contract.js
```

Natural Execution:

```text
Normalized Action
→ Execution Behavior Contract
→ Behavior Policy / Synthesizer
→ CDP Executor
```

Không dùng random delay/jitter làm nền tảng.

## CAPTCHA / human-verification boundary

```text
observe challenge
→ Decision.status = blocked
→ reasonCode = human_verification_required
→ không cố tự giải/vượt
→ không click/reload lặp vô hạn
→ re-evaluate task
→ route/trang khác hợp lệ nếu phục vụ goal
→ nếu không: stop blocked
```

Frame-aware Collector nhằm quan sát challenge/UI frame đầy đủ hơn, không nhằm tự động giải CAPTCHA.

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

Frame-aware capture không làm giảm privacy boundary; filtering vẫn phải xảy ra trong từng content frame trước khi raw rời frame.

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
training-collector/tests/v072_frame_stream_contract.js
```

V0.7.2 syntax coverage:

```text
observer/route_trace.js
content/background frame changes
analyze_raw.js gzip/frame diagnostics
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
V0.4 cho thấy mutation noise áp đảo stream.

## D007 — IndexedDB là raw persistence chính
Download không được trở thành persistence architecture.

## D008 — Download export chỉ là development adapter
Temporary convenience only.

## D009 — Batch receipt bảo đảm retry idempotent
Serialized append không đủ chống ACK loss.

## D010 — Natural Execution là layer riêng
Strategy=WHAT, Behavior=HOW, Executor=CDP.

## D011 — Hover có thể là semantic action có outcome
Hover có thể mở preview/menu/control mà không click/navigation.

## D012 — Raw target và resolved action target cùng tồn tại
Resolved target là interpretation, không phá raw fact.

## D013 — pageSeq/sourceSeq cho reconstruction
SessionSeq là persistence order.

## D014 — hover-preview derive offline
Raw giữ lifecycle/state facts.

## D015 — Auto-export complete chỉ sau download complete
`chrome.downloads.download()` trả ID chưa đủ.

## D016 — CAPTCHA là Agent boundary condition
Challenge → blocked/replan hợp lệ; không tự động giải/vượt.

## D017 — Frame identity là composite
`elementRef` chỉ meaningful trong `tabId + frameId + pageInstanceId` context.

## D018 — All-frame raw không đồng nghĩa multi-frame Agent Episode
Collector raw mở rộng trước; Episode/Strategy giữ top-frame cho tới khi multi-frame Observation contract được thiết kế explicit.

## D019 — SPA route cần semantic re-anchor
Route đổi không reload phải tạo `route-change + semantic-snapshot` để dataset biết state semantic mới.

## D020 — Stream silence phải observable
Collector tự phát health facts để phân biệt “không có interaction” với “capture module không phát dữ liệu”.

---

# 12. Engineering diary

## 2026-08-25 — Journal created
Persistent code lookup memory được thêm cho dự án dài hạn.

## 2026-08-25 — V0.6.1 temporary auto-export
Offscreen gzip exporter + startup detection cho closed IndexedDB sessions.

## 2026-08-25 — V0.7 Action Semantics
Action Target Resolver, hover lifecycle facts, pageSeq/sourceSeq, offline hover-preview.

## 2026-08-25 — CAPTCHA/iframe + export recovery regression
Native test cho thấy top-frame chỉ nhìn iframe container và auto-export từng không tạo file sau restart. Dẫn tới Agent CAPTCHA boundary + V0.7.1 recovery.

## 2026-08-25 — V0.7.1 export recovery
Status-indexed recovery, wait-for-download-complete, popup diagnostics, retry export.

## 2026-08-25 — YouTube Playables native session
Observed:

```text
YouTube /gaming → /playables SPA flow
resolved action target tốt hơn raw text/img wrapper
semantic labels của actionable parent đôi khi rỗng
```

Label propagation/minimization còn backlog; không sửa vội vì có privacy tradeoff.

## 2026-08-25 — Google Search embedded YouTube regression
Observed:

```text
Google Search
→ play YouTube video embedded trong result page
→ không navigation sang youtube.com/watch
→ iframe player visible
→ gray player overlay/state xuất hiện trong một thời điểm
```

Raw top-frame nhìn được iframe/container nhưng chưa đủ player internal state. Một đoạn session gần như chỉ có physical source, làm lộ thiếu stream diagnostics.

## 2026-08-25 — V0.7.2 frame-aware stream diagnostics implemented

Added:

```text
manifest all_frames/match_about_blank/match_origin_as_fallback
frame-context raw fact
background frameId/documentId/documentLifecycle
observer/route_trace.js
route-change + route semantic snapshot
collector-stream-start/health/stop
schema upgrade isolation
analyzer JSONL.gz support
frame/document/page/source health report
tests/v072_frame_stream_contract.js
README updated from stale V0.5 to V0.7.2
```

Next gate:

```text
native Chrome V0.7.2
→ embedded iframe/player interaction
→ SPA route change
→ verify per-frame stream health
→ verify auto-export
→ analyze .raw.jsonl.gz
→ decide frame filtering / parent-frame mapping / semantic label work
```

---

# 13. Known backlog after V0.7.2

```text
semantic label propagation for actionable parent/card while preserving privacy
hover background/container noise filtering in derived layer
parentFrameId mapping if nested-frame reconstruction needs it
all-frame volume/noise measurement before adding frame eligibility filters
reliable sender orphan journal recovery across pageInstance reload
maxPending eviction policy
selector stability/ephemeral token scoring
mutation relevance extraction in dataset layer
```

Không giải các backlog này chỉ theo suy đoán; ưu tiên native V0.7.2 evidence.

---

# 14. Journal maintenance rules

Update journal khi module responsibility, contract, dependency, difficult bug/invariant, temporary mechanism, architecture decision hoặc migration/version thay đổi.

Không dump mọi commit vào journal.
