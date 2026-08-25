# STATUS — 2026-08-25

## Source of truth

GitHub `banupham/extension_agent` là source chính của dự án. Sau milestone implementation/architecture quan trọng phải cập nhật file này để lần sau có thể tiếp tục ngay mà không khảo sát lại từ đầu.

Local workflow thường dùng:

```bat
git pull
```

## Product boundaries

```text
RECORDER
Human → deterministic Scenario

TRAINING COLLECTOR
Human → raw physical + semantic browser session

AGENT
Task → Strategy → Action Contract → Behavior Policy → CDP Executor
```

Deterministic Scenario Mode không bị thay bởi Agent Mode.

---

# Training Collector — CURRENT: V0.6 IndexedDB Reliable Raw

Manifest name:

```text
Training Collector V0.6 IndexedDB Reliable Raw
```

Collector observe-only. Không tự click/type/navigate và không dùng `chrome.debugger` để điều khiển trang.

## Capture model inherited from V0.5

```text
Physical Capture
├─ pointer trajectory/down/up
├─ wheel + scroll positions
├─ keyboard timing + operation class
├─ focus / visibility / heartbeat / idle
└─ targetRef correlation at capture time

Semantic DOM
├─ stable page-scoped element refs
├─ click/focus/input/change/submit
├─ rendered / inViewport / interactable
├─ selectorCandidates + score
└─ semantic snapshot / episode state diff

Mutation
└─ 120 ms dom-mutation-burst
```

Raw physical data không bake speed/acceleration/path distributions. Các behavior features được derive offline.

## V0.6 persistence architecture

V0.6 đã bỏ `chrome.storage.local` khỏi vai trò raw event store chính.

```text
content scripts
↓
RAW_BATCH + batchId
↓
ACK/retry sender
↓
background serialized append
↓
IndexedDB trainingCollectorRawV06
├─ sessions
├─ chunks
└─ batchReceipts
```

Các file chính mới:

```text
training-collector/core/indexeddb_chunk_store.js
training-collector/core/reliable_sender.js
```

### IndexedDB ChunkStore

- schema raw: `0.6.0`;
- chunk size: 1000 events;
- session metadata lưu riêng;
- chunk key: `(sessionId, chunkIndex)`;
- batch receipt key: `(sessionId, batchId)`;
- event `sessionSeq` vẫn là persistence order;
- `tsEpochMs` vẫn là capture-time truth.

### ACK / retry / duplicate protection

Content script tạo `batchId` trước khi gửi raw batch.

Batch được giữ tạm trong `chrome.storage.session` journal và retry nếu chưa nhận ACK.

Background + IndexedDB lưu receipt trong cùng write transaction với raw events. Nếu cùng `batchId` tới lại do retry:

```text
receipt exists
→ duplicate=true
→ ACK lại
→ không append events lần hai
```

Mục tiêu là chịu được MV3 service-worker restart/transient messaging failure tốt hơn V0.5.

### Chunk integrity

Mỗi IndexedDB chunk có:

```text
chunkIndex
eventCount
firstSeq
lastSeq
checksum = fnv1a32(...)
events
```

`verifySession()` kiểm tra:

- missing chunks;
- checksum mismatch;
- eventCount metadata mismatch;
- firstSeq/lastSeq mismatch;
- sequence gap giữa chunk.

Khi browser session cũ được inferred closed ở lần Chrome khởi động kế tiếp, background verify tail chunks và ghi report vào `session.integrity`.

Có message contract `VERIFY_RAW_SESSION` để chạy tail/full verification khi cần diagnostics.

## V0.6 export

Manual development export không load toàn bộ raw session thành một JSON array.

Popup thực hiện:

```text
GET_RAW_EXPORT_META
↓
GET_RAW_EXPORT_CHUNK 0
GET_RAW_EXPORT_CHUNK 1
...
↓
CompressionStream('gzip')
↓
.raw.jsonl.gz
```

File đầu ra:

```text
training-collector-<sessionId>.raw.jsonl.gz
```

Đây vẫn là **development/debug export adapter**, không phải persistence architecture chính. Persistence chính là IndexedDB ChunkStore.

Auto-download JSON của các version trước chỉ là phương pháp tạm thời trong giai đoạn phát triển và không được coi là kiến trúc dài hạn.

## V0.6 retention policy

Chưa tự động delete raw sessions.

Lý do: retention phải có policy/configuration rõ trước khi destructive cleanup được bật. Không tự xóa chỉ vì vượt số session index.

## V0.6 CI

Workflow `.github/workflows/extension-syntax.yml` hiện check thêm:

```text
core/indexeddb_chunk_store.js
core/reliable_sender.js
tests/v06_storage_contract.js
```

Storage reliability contract kiểm tra IndexedDB stores, batch receipts, ACK retry, checksum/integrity API và streamed gzip export.

Latest verified code milestone at time of this update:

```text
a90be899ce9d7cb226997107987e48a9d1d2c193
GitHub Actions runtime-syntax: SUCCESS
run 32839712686
```

Các commit sau milestone này có thể chỉ mở rộng contract/docs; luôn kiểm tra Actions mới nhất trước khi tuyên bố CI cuối cùng.

## Browser validation cần làm tiếp

CI chỉ xác nhận syntax/contracts; chưa thay manual Chrome test.

Test V0.6 thực tế cần:

```text
1 git pull
2 chrome://extensions → Reload
3 xác nhận tên V0.6
4 đóng/mở Chrome để tạo clean 0.6 session
5 thao tác 5–15 phút trên nhiều trang/tab
6 kiểm tra eventCount/chunkCount tăng
7 Export JSONL.gz
8 gửi file để analyzer so V0.4/V0.5/V0.6
9 đóng Chrome → mở lại → kiểm tra session cũ integrity report
```

Cần đặc biệt kiểm tra:

- không duplicate `sessionSeq`;
- no missing seq;
- batch retry không tạo duplicate;
- chunk checksum ổn;
- gzip export đọc được;
- file size/rate MB per minute;
- pointer↔semantic correlation vẫn giữ chất lượng;
- privacy red flags = 0.

## Collector next after V0.6 validation

Không thêm feature lớn trước khi có native V0.6 raw data thật.

Nếu V0.6 storage ổn, bước tiếp theo là Behavior Dataset Preparation:

```text
raw physical + semantic
↓
action-window segmentation
↓
target acquisition trajectories
↓
pointer / click / typing / scroll features
↓
Execution Behavior training dataset
```

Sau đó mới xây empirical/learned Behavior Policy cho Agent.

---

# Agent architecture

Agent phải đồng thời:

```text
1 hiểu đúng vấn đề/mục tiêu
2 chọn đúng hành động
3 thực hiện hành động tự nhiên
```

Chuẩn kiến trúc:

```text
TASK
↓
OBSERVE
↓
STRATEGY / PLANNER
↓
NORMALIZED ACTION
↓
BEHAVIOR MODEL / NATURAL EXECUTION POLICY
↓
CDP EXECUTOR
↓
BROWSER
↓
OBSERVE AFTER
↓
GOAL CHECK
↓
REPLAN
```

Responsibilities:

```text
Strategy       = WHAT to do
Behavior Model = HOW to do it naturally
Executor       = translate execution plan into CDP
```

Natural behavior không được xây từ `random delay everywhere` hoặc `random jitter everywhere`. Nó phải dựa trên empirical/learned human demonstrations và condition theo action/target/context.

Behavior features dự kiến derive từ Collector:

```text
pointer: velocity, acceleration, jerk, curvature, correction, hover, click hold
keyboard: key hold, inter-key interval, burst/pause
scroll: wheel burst, delta, pause, correction
```

Execution Behavior Contract là contract riêng; không làm Strategy phát raw CDP.

Chi tiết dài hạn xem:

```text
docs/AGENT_TRAINING_ARCHITECTURE.md
```

---

# Development rules

1. GitHub là source of truth.
2. Cập nhật `STATUS.md` sau milestone lớn.
3. Quyết định kiến trúc dài hạn phải được ghi vào docs tương ứng.
4. Debug adapters phải ghi rõ temporary.
5. Không tuyên bố browser-tested nếu chỉ có CI.
6. Không thu password/cookie/token/Authorization/clipboard/payment secrets/raw sensitive values.
7. Recorder, Training Collector, deterministic Scenario Mode và Agent Runtime giữ boundary rõ ràng.
8. Trước khi thêm feature Collector lớn, ưu tiên phân tích native raw session mới nhất.
