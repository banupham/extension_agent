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

V0.7 target contract:

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

Raw V0.7 ghi direct facts:

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

Current raw policy: `dom-mutation-burst ~120 ms`. Không dump innerHTML/textContent/raw values. Mutation relevance là derived/dataset concern.

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

# 4. Raw persistence / reliability lookup

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
runtime: 0.7.1
raw schema: 0.7.0
IndexedDB DB: trainingCollectorRawV06
chunk size: 1000
stores: sessions / chunks / batchReceipts
```

DB name V06 được giữ để không tạo migration storage không cần thiết.

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

## V0.7.1 auto-export recovery

Regression thực tế: Chrome session có data được đóng, lần mở Chrome sau không thấy file auto-export; session tiếp theo phải Manual Export để lấy dữ liệu.

Files cần đọc khi sửa:

```text
training-collector/core/indexeddb_chunk_store.js
training-collector/background.js
training-collector/offscreen.js
training-collector/popup.js
training-collector/popup.html
training-collector/tests/v06_storage_contract.js
```

V0.7.1 changes:

```text
status-indexed session query
→ không phụ thuộc scan 24 sessions gần nhất

startup recovery
→ active dangling sessions inferred closed
→ stale verifying/preparing/downloading reset to pending

closed session scan
→ tìm closed/closed-inferred sessions còn pending/failed

export
→ full integrity verify
→ offscreen gzip
→ chrome.downloads.download
→ wait chrome.downloads.onChanged state=complete
→ chỉ sau đó mark autoExport.status=complete

popup
→ recent session diagnostics
→ autoExport.status / attempts / error / downloadId
→ Retry Auto Export cho closed session
```

Invariant:

```text
IndexedDB = persistence chính
JSONL.gz download = temporary development convenience only
```

Không đánh dấu complete chỉ vì đã nhận `downloadId`.

---

# 5. Analyzer / derived dataset lookup

```text
training-collector/tools/analyze_raw.js
training-collector/tests/raw_analysis_contract.js
training-collector/tools/build_action_semantics.js
training-collector/tests/v07_action_semantics_contract.js
```

Derived action semantics hiện dùng hover lifecycle + mutation + click evidence + page/timestamp ordering.

Derived output là heuristic, không phải raw truth.

---

# 6. Agent lookup

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

CAPTCHA có thể xuất hiện tự nhiên trong quá trình test hoặc browsing. Agent không coi đây là một execution error cần retry mù quáng.

Policy:

```text
observe CAPTCHA / human verification
→ Decision.status = blocked
→ reasonCode = human_verification_required
→ không cố tự giải/vượt challenge
→ không click/reload lặp vô hạn
→ re-evaluate task
→ nếu có route/trang khác hợp lệ phục vụ goal: replan
→ nếu không: dừng task blocked
```

Chuyển sang trang/route khác phải phục vụ task hợp lệ, không phải nhằm bypass challenge.

Nếu challenge nằm trong iframe, frame-aware Collector/Observer cần quan sát đúng target/state; mục tiêu là observation completeness, không phải tự động giải CAPTCHA.

---

# 7. Recorder / deterministic scenario lookup

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

# 8. Privacy invariants

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

# 9. CI map

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

CI success != Chrome integration tested.

---

# 10. Architectural decisions

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
Quyết định sau V0.4 cho thấy mutation noise áp đảo stream.

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
`chrome.downloads.download()` trả ID chưa đủ. V0.7.1 chờ download state `complete`; interrupted/timeout → failed + recovery.

## D016 — CAPTCHA là Agent boundary condition
Challenge/human verification → blocked/replan hợp lệ; không tự động giải/vượt challenge.

---

# 11. Engineering diary

## 2026-08-25 — Journal created
Persistent code lookup memory được thêm để dự án dài hạn không phải khảo sát lại toàn repo.

## 2026-08-25 — V0.6.1 temporary auto-export
Offscreen gzip exporter + startup detection cho closed IndexedDB sessions.

## 2026-08-25 — V0.7 Action Semantics
Thêm Action Target Resolver, hover lifecycle facts, pageSeq/sourceSeq và offline hover-preview derivation.

## 2026-08-25 — Native V0.7 CAPTCHA/iframe + auto-export recovery case
Thực tế test:

```text
Chrome mở
→ Google human verification xuất hiện
→ pointer/click vào CAPTCHA frame
→ challenge mở
→ Chrome đóng
→ lần mở Chrome sau không thấy auto-export file
→ session kế tiếp Manual Export để lấy raw phân tích
```

Kết luận:

- iframe/frame-aware capture là gap observation cần xử lý sau recovery;
- auto-export cần recovery/diagnostics trước;
- CAPTCHA là normal boundary condition, không phải thứ Agent phải cố vượt.

## 2026-08-25 — V0.7.1 export recovery implemented

Added:

```text
IndexedDB status-indexed session recovery
startup stale-state recovery
closed session retry scan
wait-for-download-complete
recent-session popup diagnostics
manual retry auto-export
```

Next gate:

```text
manual Chrome test V0.7.1 close/reopen auto-export
→ verify prior closed session appears/downloads
→ then implement frame-aware capture
→ then repeat YouTube hover/action tests
```

---

# 12. Journal maintenance rules

Update journal khi module responsibility, contract, dependency, difficult bug/invariant, temporary mechanism, architecture decision hoặc migration/version thay đổi.

Không dump mọi commit vào journal.
