# STATUS — 2026-08-25

## Source of truth

GitHub `banupham/extension_agent` là source chính của dự án.

```bat
git pull
```

Trước khi sửa code: đọc `STATUS.md` → `docs/PROJECT_JOURNAL.md` → fetch source hiện tại trên `main`.

---

# Training Collector — CURRENT: V0.7.1 Action Semantics + Export Recovery

Manifest:

```text
Training Collector V0.7.1 Action Semantics + Export Recovery
```

Runtime version: `0.7.1`  
Raw schema: `0.7.0`

Collector vẫn observe-only.

## V0.7 Action Semantics đang giữ

```text
raw hover facts:
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

Raw facts không bị overwrite bằng derived interpretation.

## V0.7.1 — auto-export recovery

Regression thực tế vừa phát hiện:

```text
Chrome session có raw data
→ Chrome đóng
→ lần mở Chrome sau không thấy auto-export file
→ session tiếp theo phải Manual Export
```

V0.7.1 sửa theo hướng:

```text
IndexedDB status-indexed recovery
→ scan active dangling sessions không phụ thuộc 24 session gần nhất
→ infer closed
→ stale verifying/preparing/downloading reset pending
→ scan closed/closed-inferred còn pending/failed
→ full integrity verify
→ offscreen gzip
→ chrome.downloads.download
→ chờ chrome.downloads.onChanged state=complete
→ chỉ sau đó mark autoExport.status=complete
```

Popup mới có:

```text
Recent Raw Sessions / Auto Export
sessionId
status
eventCount/chunkCount
autoExport.status
autoExport.attempts
autoExport.error
downloadId/downloadState
Retry Auto Export
```

Auto-export vẫn chỉ là **temporary development convenience**. IndexedDB là persistence chính.

## Current persistence

```text
RAW_BATCH + batchId
→ ACK/retry sender
→ background serialized append
→ IndexedDB trainingCollectorRawV06
   ├─ sessions
   ├─ chunks
   └─ batchReceipts
```

Raw schema 0.7.0 nhưng DB name V06 giữ lại để tránh migration không cần thiết.

Chunk size: 1000.

Integrity:

```text
checksum
missing chunk
event count metadata
first/last sessionSeq
cross-chunk sequence gap
```

Không tự delete raw khi integrity fail.

---

# New observed gap — iframe/frame-aware capture

Session thực tế gặp Google human verification cho thấy Collector top-frame nhìn thấy iframe nhưng chưa quan sát đầy đủ element/state bên trong frame.

Sau khi V0.7.1 auto-export được Chrome-test ổn, bước Collector tiếp theo là frame-aware capture:

```text
all_frames / frame-aware content execution
→ tabId + frameId + pageInstanceId + elementRef identity
→ semantic/physical event trong frame
→ cross-frame action/state reconstruction
```

Mục tiêu là observation completeness cho UI iframe nói chung; không phải tự động giải CAPTCHA.

---

# Agent boundary — CAPTCHA / human verification

CAPTCHA có thể xuất hiện bình thường trong test/browsing. Agent phải nhận ra đây là boundary condition.

Policy:

```text
observe challenge
→ Decision.status = blocked
→ reasonCode = human_verification_required
→ không cố tự giải/vượt challenge
→ không retry click/reload vô hạn
→ re-evaluate task
→ nếu có route/trang khác hợp lệ phục vụ goal: replan
→ nếu không: stop blocked
```

Chi tiết:

```text
docs/AGENT_BOUNDARY_CONDITIONS.md
```

Việc chuyển trang/route khác phải phục vụ task hợp lệ, không nhằm bypass challenge.

---

# Browser validation tiếp theo

Ưu tiên kiểm tra **auto-export recovery**, chưa cần test hover đầy đủ ngay.

```text
1 git pull
2 chrome://extensions → Reload
3 xác nhận tên V0.7.1 Action Semantics + Export Recovery
4 đóng/mở Chrome để có clean session
5 thao tác đơn giản 1–2 phút
6 KHÔNG Manual Export
7 đóng toàn bộ Chrome
8 mở Chrome lại
9 kiểm tra Downloads/training-collector/
10 mở popup → Recent Raw Sessions / Auto Export
```

Kỳ vọng session trước:

```text
status = closed-inferred
autoExport.status = complete
downloadState = complete
attempts >= 1
```

Nếu không có file, popup phải cho thấy `autoExport.status/error` và có `Retry Auto Export`.

Chỉ sau khi test này ổn mới tiếp tục:

```text
frame-aware capture
→ repeat iframe regression
→ repeat YouTube hover-preview / click-control tests
→ Behavior Dataset Preparation
```

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
