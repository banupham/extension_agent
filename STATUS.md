# STATUS — 2026-08-25

## Source of truth

GitHub `banupham/extension_agent` là source chính của dự án.

```bat
git pull
```

Trước khi sửa code: đọc `STATUS.md` → `docs/PROJECT_JOURNAL.md` → fetch source hiện tại trên `main`.

---

# Training Collector — CURRENT: V0.7.2 Frame-Aware Stream Diagnostics

Manifest:

```text
Training Collector V0.7.2 Frame-Aware Stream Diagnostics
```

Runtime version: `0.7.2`  
Raw schema: `0.7.2`

Collector vẫn observe-only.

## Vì sao có V0.7.2

Hai native-session regressions dẫn tới milestone này:

```text
1. CAPTCHA / embedded UI
   top-frame nhìn thấy iframe container
   nhưng chưa quan sát đầy đủ interaction/state bên trong frame.

2. Google Search + embedded YouTube
   video phát ngay trong Google Search, không navigation sang youtube.com/watch;
   một đoạn raw gần như chỉ có physical source;
   semantic/DOM/hover/mutation completeness không thể chẩn đoán trực tiếp.
```

Mục tiêu V0.7.2 là observation completeness + diagnostics, không phải xử lý/vượt CAPTCHA.

## V0.7.2 — frame-aware raw capture

Manifest content script:

```text
all_frames = true
match_about_blank = true
match_origin_as_fallback = true
```

Mỗi frame có `pageInstanceId` riêng. Background bổ sung vào persisted event:

```text
tabId
windowId
frameId
documentId
documentLifecycle
```

Element identity phải hiểu theo:

```text
tabId + frameId + pageInstanceId + elementRef
```

Frame-local coordinate convention được ghi bằng:

```text
frame-context.coordinateSpace = frame-client
```

Continuous raw capture chạy ở matching frames. Optional Task Episode hiện vẫn top-frame only để không trộn multi-frame semantic state trước khi Agent Observation contract được nâng cấp.

## V0.7.2 — SPA route observation

File mới:

```text
training-collector/observer/route_trace.js
```

SPA route detector dùng:

```text
popstate
hashchange
500 ms location polling
```

Khi route đổi:

```text
route-change
→ sanitized previous/current page
→ semantic-snapshot snapshotReason=route-change
```

Điều này giải quyết việc semantic snapshot trước đây chỉ được ghi lúc content script start trong khi Google/YouTube có thể đổi route mà không reload document.

## V0.7.2 — stream health

Raw thêm direct diagnostic records:

```text
collector-stream-start
collector-stream-health    // mỗi 10 giây
collector-stream-stop
```

Mỗi health record chứa:

```text
isTopFrame
readyState
visibilityState
viewport
modules: physical/dom/mutation/hover/navigation
sourceEventCounts cumulative
```

Mục tiêu: nếu session xuất hiện tình trạng physical-only, analyzer có thể chỉ ra frame/pageInstance nào thiếu semantic side thay vì phải suy đoán thủ công.

## Analyzer V0.7.2

`training-collector/tools/analyze_raw.js` giờ đọc trực tiếp:

```text
JSON
JSONL
JSONL.gz
```

Report thêm:

```text
unique tab/frame
documentId count
pageInstance count
per-frame source distribution
frame-context count
route-change count
semantic snapshot count
stream-health summaries
missing initial semantic suspicion
physical-only suspicion
```

## Action semantics giữ nguyên

```text
raw hover:
  dom-hover-enter
  dom-hover-dwell
  dom-hover-leave

DOM target:
  rawTargetRef
  resolvedTargetRef
  targetResolution.method/confidence

timeline:
  tsEpochMs
  pageSeq
  sourceSeq
  sessionSeq
```

`hover-preview` vẫn derive offline bởi:

```text
training-collector/tools/build_action_semantics.js
```

Raw fact không bị overwrite bằng derived interpretation.

## Persistence / recovery

Raw store chính vẫn là IndexedDB:

```text
RAW_BATCH + batchId
→ ACK/retry sender
→ background serialized append
→ IndexedDB trainingCollectorRawV06
   ├─ sessions
   ├─ chunks
   └─ batchReceipts
```

Chunk size: 1000.

V0.7.1 auto-export recovery vẫn giữ:

```text
status-indexed dangling/closed session recovery
full integrity verification
offscreen gzip
wait downloads.onChanged state=complete
recent-session popup diagnostics
manual Retry Auto Export
```

Auto-export chỉ là temporary development convenience; IndexedDB là persistence chính.

V0.7.2 thêm schema-upgrade isolation:

```text
active session schema cũ
→ close reason schema_upgrade_to_0.7.2
→ auto-export/recovery như closed session
→ tạo clean 0.7.2 session
```

Không trộn raw schema cũ/mới trong một active archive.

---

# Agent boundary — CAPTCHA / human verification

Policy giữ nguyên:

```text
observe CAPTCHA / human verification
→ Decision.status = blocked
→ reasonCode = human_verification_required
→ không cố tự giải/vượt
→ không retry vô hạn
→ re-evaluate goal
→ route/trang khác hợp lệ nếu phục vụ task
→ nếu không có thì stop blocked
```

Chi tiết: `docs/AGENT_BOUNDARY_CONDITIONS.md`.

---

# Browser validation tiếp theo

V0.7.2 cần native Chrome validation; CI không thay thế browser test.

```text
1 git pull
2 chrome://extensions → Reload
3 refresh/reopen target pages để content scripts mới inject
4 xác nhận tên V0.7.2 Frame-Aware Stream Diagnostics
5 test một top page bình thường
6 test Google Search / YouTube SPA route
7 test embedded video/player hoặc iframe bình thường
8 nếu CAPTCHA xuất hiện: chỉ quan sát boundary, không cần giải
9 không Manual Export trong normal test
10 đóng toàn bộ Chrome → mở lại
11 kiểm tra auto-export
12 gửi .raw.jsonl.gz để analyze
```

Kỳ vọng mới:

```text
frame-context cho top + accessible frames
frameId/documentId populated
collector-stream-health per pageInstance
semantic snapshot document-start
route-change + route semantic snapshot khi SPA đổi route
DOM/hover/mutation từ iframe interaction nếu Chrome cho content-script injection
```

Phân tích tiếp theo phải tập trung:

```text
all-frame event volume / noise
per-frame source completeness
physical-only suspicion = 0
route snapshot correctness
embedded media interaction visibility
iframe local coordinate correctness
auto-export recovery
privacy
```

Sau native validation mới quyết định có cần frame filtering/parent-frame mapping/semantic label improvements trước Behavior Dataset Preparation.

---

# Agent architecture boundaries

```text
TASK
→ OBSERVE
→ STRATEGY / PLANNER
→ NORMALIZED ACTION
→ BEHAVIOR MODEL / NATURAL EXECUTION POLICY
→ CDP EXECUTOR
→ BROWSER
→ OBSERVE AFTER
→ GOAL CHECK
→ REPLAN
```

```text
Strategy       = WHAT to do
Behavior Model = HOW naturally
Executor       = translate execution plan into CDP
```

Natural behavior không dựa vào random delay/jitter; phải derive/learn từ human demonstrations.

---

# Development rules

1. GitHub là source of truth.
2. Cập nhật STATUS/JOURNAL sau milestone hoặc bug/invariant khó.
3. CI success không đồng nghĩa Chrome manual verified.
4. Debug/auto-export adapter phải ghi rõ temporary.
5. Không commit raw user session vào repo.
6. Không thu password/cookie/token/Authorization/clipboard/payment secrets/raw sensitive values.
7. Recorder, Collector, deterministic Scenario Mode và Agent Runtime giữ boundary rõ ràng.
8. Frame-aware raw capture không đồng nghĩa Agent Episode/Strategy đã multi-frame; hiện Episode vẫn top-frame only.
