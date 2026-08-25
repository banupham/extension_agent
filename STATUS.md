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

# Training Collector — CURRENT: V0.6.1 IndexedDB Auto Export

Manifest name:

```text
Training Collector V0.6.1 IndexedDB Auto Export
```

Raw schema vẫn là `0.6.0`; `0.6.1` là extension/runtime version bổ sung temporary auto-export, không đổi semantic raw schema.

Collector observe-only. Không tự click/type/navigate và không dùng `chrome.debugger` để điều khiển trang.

## Capture model

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

Raw physical data không bake speed/acceleration/path distributions. Behavior features được derive offline.

## V0.6 persistence architecture

Raw event store chính là IndexedDB, không còn dựa vào `chrome.storage.local` cho event chunks.

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

### IndexedDB ChunkStore

- raw schema: `0.6.0`;
- chunk size: 1000 events;
- chunk key: `(sessionId, chunkIndex)`;
- batch receipt key: `(sessionId, batchId)`;
- `sessionSeq` = persistence order;
- `tsEpochMs` = capture-time truth.

### ACK / retry / duplicate protection

Content script tạo `batchId`, giữ pending batch trong `chrome.storage.session`, retry nếu chưa nhận ACK.

Background + IndexedDB lưu receipt trong cùng transaction với events. Retry cùng `batchId`:

```text
receipt exists
→ duplicate=true
→ ACK lại
→ không append events lần hai
```

### Chunk integrity

Mỗi chunk có:

```text
chunkIndex
eventCount
firstSeq
lastSeq
checksum = fnv1a32(...)
events
```

`verifySession()` kiểm tra missing chunk, checksum mismatch, metadata mismatch và sequence gap giữa chunks.

Khi browser session cũ được inferred closed ở lần Chrome khởi động kế tiếp, background ghi integrity report. V0.6.1 chạy full verification trước temporary auto-export.

## V0.6.1 temporary automatic export

Mục tiêu của auto-export là tiện cho giai đoạn test/phân tích và giảm rủi ro người dùng quên bấm manual export. Đây **không phải persistence architecture dài hạn**.

Flow:

```text
Chrome session A
→ raw persist liên tục trong IndexedDB
→ Chrome tắt

Chrome mở lại
→ session A inferred closed
→ verify full chunk integrity
→ offscreen gzip exporter
→ Downloads/training-collector/training-collector-<sessionId>.raw.jsonl.gz
→ mark session.autoExport complete
→ session B tiếp tục capture
```

Implementation mới:

```text
training-collector/offscreen.html
training-collector/offscreen.js
```

Manifest có thêm permissions:

```text
offscreen
alarms
```

Auto-export behavior:

- chỉ session closed có `eventCount > 0`;
- session rỗng được mark `skipped-empty`;
- full integrity verification trước export;
- gzip JSONL tạo trong offscreen document bằng `CompressionStream('gzip')`;
- download vào `Downloads/training-collector/`;
- `session.autoExport.status = complete` sau khi download được tạo;
- không export lại session đã complete;
- failure tự retry tối đa 3 lần qua alarm;
- metadata ghi `temporaryDevelopmentAdapter: true` để tránh nhầm với storage architecture chính.

Nếu integrity report có warning, exporter vẫn cố gắng giữ dữ liệu để phục vụ diagnostics; nếu missing chunk làm export không thể hoàn tất thì session được mark `failed` và retry theo giới hạn.

Manual popup export vẫn tồn tại để debug current session, nhưng không còn là bước bắt buộc cho workflow test bình thường.

## Export format

Native V0.6 export:

```text
JSONL records
→ CompressionStream(gzip)
→ .raw.jsonl.gz
```

Header record chứa session metadata; các record sau là event từng dòng.

File auto-export:

```text
Downloads/training-collector/training-collector-<sessionId>.raw.jsonl.gz
```

## Retention

Chưa tự động delete raw sessions. Retention phải có policy/configuration rõ trước khi destructive cleanup được bật.

## CI latest verified

Latest runtime-syntax run sau V0.6.1 auto-export + offscreen syntax coverage:

```text
commit 794fbd1c6d18c24c620b4c150ac134370ad13188
run 32840984301
result SUCCESS
```

CI kiểm tra syntax, manifest, existing Collector contracts và `tests/v06_storage_contract.js`, bao gồm assertions cho offscreen/alarms/auto-export contract.

CI không thay manual Chrome validation.

## Browser validation cần làm tiếp

Bây giờ ưu tiên test thực tế, chưa thêm feature Collector lớn.

```text
1 git pull
2 chrome://extensions → Reload
3 xác nhận tên: Training Collector V0.6.1 IndexedDB Auto Export
4 đóng/mở Chrome để tạo clean session
5 thao tác 5–15 phút: pointer, click, scroll, typing, nhiều tab
6 không cần bấm Manual Export
7 đóng toàn bộ Chrome
8 mở Chrome lại
9 kiểm tra Downloads/training-collector/ có .raw.jsonl.gz của session trước
10 gửi file đó để phân tích
```

Phân tích tiếp theo phải kiểm tra:

```text
file size / MB per minute
events per minute
mutation burst reduction
pointer sampling gaps
physical↔semantic correlation
sessionSeq missing/duplicate
chunk checksum/integrity
auto-export reliability
gzip ratio
privacy red flags
```

Nếu auto-export không xuất file, kiểm tra popup/IndexedDB session metadata và `session.autoExport.status/error`; không giả định dữ liệu đã mất vì persistence chính vẫn là IndexedDB.

## Collector next after V0.6.1 validation

Sau khi có native `.raw.jsonl.gz` thật và phân tích ổn, bước tiếp theo là Behavior Dataset Preparation:

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

Natural behavior không dùng nền tảng `random delay everywhere` / `random jitter everywhere`; phải dựa trên empirical/learned human demonstrations và condition theo action/target/context.

Behavior features dự kiến derive từ Collector:

```text
pointer: velocity, acceleration, jerk, curvature, correction, hover, click hold
keyboard: key hold, inter-key interval, burst/pause
scroll: wheel burst, delta, pause, correction
```

Execution Behavior Contract là contract riêng; Strategy không phát raw CDP.

Chi tiết dài hạn xem `docs/AGENT_TRAINING_ARCHITECTURE.md`.

---

# Development rules

1. GitHub là source of truth.
2. Cập nhật `STATUS.md` sau milestone lớn.
3. Quyết định kiến trúc dài hạn phải được ghi vào docs tương ứng.
4. Debug/auto-export adapters phải ghi rõ temporary.
5. Không tuyên bố browser-tested nếu chỉ có CI.
6. Không thu password/cookie/token/Authorization/clipboard/payment secrets/raw sensitive values.
7. Recorder, Training Collector, deterministic Scenario Mode và Agent Runtime giữ boundary rõ ràng.
8. Trước khi thêm feature Collector lớn, ưu tiên phân tích native raw session mới nhất.
