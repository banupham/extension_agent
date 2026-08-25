# PROJECT JOURNAL — persistent engineering memory

Mục đích của file này là làm **bộ nhớ kỹ thuật lâu dài trên GitHub** cho dự án `banupham/extension_agent`.

`STATUS.md` trả lời: **dự án đang ở đâu, bước tiếp theo là gì**.

`docs/PROJECT_JOURNAL.md` trả lời: **khi cần sửa một phần cụ thể thì phải đọc file nào, contract nào liên quan, test nào cần chạy, quyết định kiến trúc nào không được phá, và lịch sử thay đổi quan trọng là gì**.

File này là living document. Sau thay đổi kiến trúc, refactor lớn, bug khó hoặc khi phát hiện một dependency/điểm dễ quên, phải cập nhật journal.

---

## 1. Quy trình tra cứu trước khi sửa code

Khi có yêu cầu sửa `A`, không quét toàn repo ngay. Dùng thứ tự:

```text
1. STATUS.md
   → version/milestone hiện tại

2. PROJECT_JOURNAL.md
   → tìm A trong Code Lookup Map / Invariants / Change Log

3. fetch đúng các file được journal chỉ ra
   → xác nhận code hiện tại trên main

4. fetch test/contract liên quan

5. sửa nhỏ theo boundary hiện có

6. CI / browser validation tùy loại thay đổi

7. cập nhật STATUS/JOURNAL nếu knowledge dài hạn thay đổi
```

Journal là **chỉ mục**, không thay thế việc fetch source hiện tại trước khi sửa. Nếu journal và source mâu thuẫn, source trên `main` là thực tế triển khai; sau đó journal phải được sửa lại.

---

# 2. Product boundaries — không được trộn vai trò

```text
RECORDER
Human → deterministic Scenario

TRAINING COLLECTOR
Human → raw physical + semantic browser session

AGENT
Task → Strategy → Action Contract → Behavior Policy → CDP Executor
```

### Recorder

Mục tiêu: tái dựng thao tác người dùng thành deterministic scenario.

Không dùng Recorder raw format làm raw training telemetry chính.

### Training Collector

Mục tiêu: observe-only human demonstration capture cho dataset/behavior learning.

Không tự click/type/navigate. Không dùng `chrome.debugger` để điều khiển trang.

### Agent

Mục tiêu:

```text
understand problem
→ choose correct action
→ execute naturally
```

Boundary bắt buộc:

```text
Strategy       = WHAT to do
Behavior Model = HOW to do it naturally
Executor       = translate execution plan to CDP
```

Strategy/model không phát raw CDP.

---

# 3. Code Lookup Map

## A. Training Collector — capture pipeline

### Khi sửa pointer / wheel / keyboard timing / idle / focus / visibility physical telemetry

Đọc trước:

```text
training-collector/capture/physical_capture.js
training-collector/content.js
training-collector/correlation/physical_semantic_correlator.js
training-collector/core/reliable_sender.js
```

Kiểm tra thêm:

```text
training-collector/tests/architecture_contract.js
training-collector/tests/raw_session_contract.js
training-collector/tests/v06_storage_contract.js
```

Invariants:

- không bake speed/acceleration/path distributions vào raw;
- printable keyboard không lưu actual char/code;
- sensitive targets phải bị loại trước khi data rời content script;
- physical event correlation phải xảy ra gần capture time, không suy target quá muộn.

### Khi sửa DOM click/focus/input/change/submit capture

Đọc:

```text
training-collector/capture/dom_capture.js
training-collector/observer/semantic_observer.js
training-collector/observer/element_registry.js
training-collector/content.js
```

Không được đưa raw input values vào telemetry.

### Khi sửa semantic element / selector / visibility / target descriptor

Đọc:

```text
training-collector/observer/semantic_observer.js
training-collector/observer/element_registry.js
training-collector/correlation/physical_semantic_correlator.js
training-collector/core/state_diff.js
```

Semantic element hiện phân biệt:

```text
rendered
inViewport
interactable
```

Selector dùng `selectorCandidates + score`; không quay về một selector duy nhất làm truth.

Element identity phải được hiểu theo page context; không coi `e17` là globally unique qua page/tab/frame.

### Khi sửa hover / preview / dynamic-controls semantics

Đọc trước:

```text
training-collector/capture/physical_capture.js
training-collector/capture/dom_capture.js
training-collector/observer/semantic_observer.js
training-collector/observer/element_registry.js
training-collector/observer/mutation_trace.js
training-collector/correlation/physical_semantic_correlator.js
training-collector/content.js
```

Regression case chuẩn phát hiện từ native V0.6.1 session trên YouTube:

```text
pointer enters recommended-video thumbnail
→ thumbnail activates animated preview
→ mute/audio control appears inside card
→ no URL navigation required
```

Đây là semantic action khác với `click-open`. Dataset/Observer phải có khả năng phân biệt ít nhất:

```text
hover-preview
click-open
click-control
```

Không suy mọi state change sau pointer/focus thành click hoặc navigation. Với UI động, hover có thể là action có outcome rõ ràng.

Khi dựng dataset, ưu tiên derive action window theo:

```text
STATE_BEFORE
→ pointer acquisition / enter / dwell
→ STATE_AFTER (preview activated, controls appeared)
→ navigation = false
```

Raw collector vẫn giữ physical + DOM/mutation facts; semantic `hover-preview` có thể được derive ở dataset layer nếu chưa có contract raw riêng.

### Khi sửa mutation

Đọc:

```text
training-collector/observer/mutation_trace.js
training-collector/observer/element_registry.js
training-collector/content.js
training-collector/tools/analyze_raw.js
```

Current policy: `dom-mutation-burst` ~120 ms, không dump `innerHTML`, `textContent`, raw values.

Lý do lịch sử: V0.4 raw mutation từng chiếm ~89% stream trong một session thật.

---

## B. Training Collector — raw persistence / reliability

### Khi sửa IndexedDB storage/chunk/session lifecycle

Đọc theo thứ tự:

```text
training-collector/core/raw_session_store.js
training-collector/core/indexeddb_chunk_store.js
training-collector/background.js
training-collector/tests/v06_storage_contract.js
```

Current runtime/raw versions:

```text
extension runtime: 0.6.1
raw schema:        0.6.0
IndexedDB:         trainingCollectorRawV06
chunk size:        1000 events
```

IndexedDB stores:

```text
sessions
chunks
batchReceipts
```

Chunk identity:

```text
(sessionId, chunkIndex)
```

Receipt identity:

```text
(sessionId, batchId)
```

`sessionSeq` = persistence order, không phải chronological truth.

`tsEpochMs` = capture-time truth.

### Khi sửa ACK / retry / duplicate behavior

Đọc:

```text
training-collector/core/reliable_sender.js
training-collector/core/indexeddb_chunk_store.js
training-collector/background.js
```

Invariant quan trọng:

```text
same batchId retry
→ receipt exists
→ ACK again
→ never append duplicate events
```

Pending batch journal dùng `chrome.storage.session`.

Không bỏ receipt dedupe chỉ vì background append đang serialized; hai cơ chế giải quyết hai lớp lỗi khác nhau.

### Khi sửa checksum/integrity

Đọc:

```text
training-collector/core/indexeddb_chunk_store.js
training-collector/background.js
training-collector/tests/v06_storage_contract.js
```

Integrity hiện kiểm tra:

```text
missing chunk
checksum mismatch
eventCount metadata mismatch
firstSeq/lastSeq mismatch
sequence gap between chunks
```

Không tự xóa raw data khi integrity fail; giữ data để diagnostics.

---

## C. Training Collector — export

### Manual current-session export

Đọc:

```text
training-collector/popup.js
training-collector/background.js
training-collector/popup.html
```

Flow:

```text
GET_RAW_EXPORT_META
GET_RAW_EXPORT_CHUNK N
→ JSONL
→ CompressionStream('gzip')
→ .raw.jsonl.gz
```

### Temporary automatic previous-session export

Đọc:

```text
training-collector/background.js
training-collector/offscreen.html
training-collector/offscreen.js
training-collector/manifest.json
training-collector/tests/v06_storage_contract.js
```

Current dev flow:

```text
Chrome session A
→ IndexedDB persistence
→ Chrome closes
→ next Chrome startup
→ A inferred closed
→ full integrity verify
→ offscreen gzip
→ chrome.downloads
→ Downloads/training-collector/*.raw.jsonl.gz
```

Important: đây là **temporary development convenience only**. Không xây storage architecture dài hạn phụ thuộc vào download này.

Auto-export có per-session in-flight serialization + persisted complete status để tránh duplicate export.

Nếu auto-export lỗi, raw data vẫn còn trong IndexedDB.

---

## D. Training Collector — analyzer / dataset diagnostics

Đọc:

```text
training-collector/tools/analyze_raw.js
training-collector/tests/raw_analysis_contract.js
```

Analyzer cần giữ khả năng đọc legacy formats nếu feasible:

```text
V0.4 raw JSON
V0.5 JSONL
V0.6 JSONL.gz / JSONL depending current tool support
```

Các metric quan trọng khi đánh giá phiên mới:

```text
file size / MB per minute
events per minute
source/type distributions
pointer sampling gaps
physical↔semantic correlation coverage
mutation burst count / represented records
sessionSeq missing/duplicate
capture timestamp ordering
chunk integrity
gzip ratio
privacy red flags
```

---

# 4. Agent Code Lookup Map

## Strategy / planning

Đọc:

```text
control-center/manager/strategy/index.js
control-center/manager/strategy/contracts.js
control-center/manager/strategy/baseline_strategy.js
control-center/manager/strategy/README.md
docs/AGENT_TRAINING_ARCHITECTURE.md
```

Strategy trả normalized action/decision, không thao tác Chrome trực tiếp.

### Khi sửa Agent action execution

Đọc:

```text
control-center/extension/agent-runtime-extension/background.js
control-center/ACTION_CONTRACT.json
control-center/script/checks/strategy_contract.js
```

Không cho Strategy/model bypass Action Contract bằng raw CDP.

### Khi thêm Natural Execution / Behavior Model

Trước khi implementation, đọc:

```text
docs/AGENT_TRAINING_ARCHITECTURE.md
STATUS.md
training-collector/tools/analyze_raw.js
```

Target architecture:

```text
Normalized Action
→ Execution Behavior Contract
→ Behavior Policy / Synthesizer
→ CDP Executor
```

Không dùng `random delay everywhere` / `random jitter everywhere` làm nền tảng. Behavior phải derive/learn từ human demonstrations và condition theo target/context/action.

---

# 5. Deterministic Scenario / Recorder lookup

### Scenario executor / control center behavior

Đọc:

```text
control-center/manager/control_center.js
control-center/script/checks/run_check.js
control-center/ACTION_CONTRACT.json
control-center/extension/stealth-extension/background.js
```

Deterministic Scenario Mode phải tiếp tục ổn định khi Agent Mode phát triển.

### Recorder click/mouse/keyboard/scroll capture

Đọc:

```text
recorder/content.js
recorder/background.js
recorder/ACTION_CONTRACT.json
recorder/README.md
docs/RECORDED_CLICK.md
docs/KEYBOARD.md
```

Recorder phục vụ deterministic replay; không trộn với Training Collector raw archive.

---

# 6. Cross-cutting privacy invariants

Trước mọi thay đổi Collector/Agent observation, kiểm tra:

```text
training-collector/core/privacy.js
training-collector/observer/semantic_observer.js
training-collector/capture/physical_capture.js
```

Không thu/lưu:

- password values;
- cookie;
- Authorization/access/refresh tokens;
- localStorage/sessionStorage secret contents;
- clipboard contents;
- payment secrets;
- raw sensitive input values;
- actual printable keyboard character/code trong raw physical stream;
- URL query values/hash content;
- raw document title nếu policy hiện tại chỉ lưu metrics.

Privacy filtering phải xảy ra trước khi data nhạy cảm rời content script whenever possible.

---

# 7. CI map

Workflow chính:

```text
.github/workflows/extension-syntax.yml
```

Khi thêm JS runtime/module mới trong các product chính, phải cân nhắc thêm `node --check` vào workflow.

Collector contract tests hiện gồm:

```text
training-collector/tests/architecture_contract.js
training-collector/tests/raw_session_contract.js
training-collector/tests/raw_analysis_contract.js
training-collector/tests/v06_storage_contract.js
```

CI syntax/contract success **không đồng nghĩa browser integration đã được test**.

Trong báo cáo luôn phân biệt:

```text
CI verified
vs
Chrome manual verified
```

---

# 8. Architectural decisions / rationale register

## D001 — Scenario Mode và Agent Mode tách biệt

Lý do: bảo vệ deterministic execution hiện có trong khi Agent Runtime còn đang phát triển.

## D002 — Collector và Recorder là hai sản phẩm khác nhau

Recorder: Human → deterministic Scenario.

Collector: Human → raw training telemetry.

Không ép hai mục tiêu vào cùng schema.

## D003 — Raw physical data phải raw/un-derived

Không bake velocity/acceleration/curvature/pause distributions vào capture source. Derive offline để có thể thay thuật toán sau này mà không thu lại dữ liệu.

## D004 — DOM là core signal, physical là supplementary signal

Agent cần hiểu target/state/outcome; mouse trajectory một mình không đủ.

## D005 — Physical↔semantic correlation tại capture time

Tránh suy target sau khi focus/DOM đã thay đổi.

## D006 — Mutation dùng burst thay vì từng MutationRecord

Được quyết định sau dữ liệu thật V0.4 cho thấy mutation noise áp đảo dataset.

## D007 — IndexedDB là raw persistence chính từ V0.6

`chrome.storage.local` không phù hợp làm long-session raw event store chính.

## D008 — JSON/JSONL download chỉ là debug/development adapter

Không để temporary auto-export trở thành production storage architecture.

## D009 — ACK receipt để retry idempotent

Serialized append không đủ chống message ACK loss. `batchReceipts` là idempotency boundary.

## D010 — Agent Natural Execution là layer riêng

```text
Strategy = WHAT
Behavior = HOW naturally
Executor = CDP
```

Không hard-code random behavior trong Strategy.

## D011 — Hover có thể là semantic action có outcome, không phải chỉ pointer noise

Dynamic web UI có thể phản ứng với hover bằng preview, menu, tooltip hoặc controls mà không có click/navigation.

Regression case đầu tiên: YouTube recommended-video thumbnail.

```text
hover thumbnail
→ animated preview starts
→ audio/mute control appears
→ URL không đổi
```

Dataset builder/Observer không được ép case này thành `click-open`. Khi phù hợp, derive `hover-preview` từ physical enter/dwell + semantic/mutation state change. Raw capture vẫn giữ facts nguyên thủy để thuật toán derive có thể thay đổi sau này.

---

# 9. Current known state — 2026-08-25

Training Collector hiện là:

```text
V0.6.1 IndexedDB Auto Export
raw schema 0.6.0
```

Đã có:

```text
compact targetRef
mutation burst
rendered/inViewport/interactable
selectorCandidates
state diff
IndexedDB chunks
batchId ACK/retry
duplicate receipts
chunk checksum + verification
manual JSONL.gz export
temporary automatic previous-session JSONL.gz export
```

Next validation gate:

```text
native Chrome V0.6.1 session
→ auto-export without pressing button
→ analyze .raw.jsonl.gz
→ decide fixes before Behavior Dataset Preparation
```

Không thêm Collector feature lớn trước khi đọc native V0.6.1 data, trừ khi test phát hiện blocker.

---

# 10. Change log / engineering diary

## 2026-08-25 — Journal created

Reason: dự án đã dài và nhiều product/module. Cần persistent lookup memory để không phải khảo sát lại toàn repo sau mỗi lần quay lại.

Rule mới:

```text
STATUS.md = current state / next step
PROJECT_JOURNAL.md = code map / invariants / rationale / historical traps
source files = implementation truth
```

## 2026-08-25 — Collector V0.6.1 temporary auto-export

Added offscreen gzip exporter + startup detection for closed IndexedDB sessions. Auto-export is explicitly temporary for development analysis. Manual export remains available.

Latest code commit at time journal was created should be re-checked from `main`; do not rely on a stale SHA in this journal when editing code.

## 2026-08-25 — Native V0.6.1 semantic hover case discovered

User-confirmed behavior from screenshot + raw-session review:

```text
Action A:
pointer hover vào thumbnail video đề xuất
→ YouTube chạy preview động trong thumbnail
→ nút loa/mute xuất hiện
→ không cần click mở URL/video page mới

Action B:
click nút "Bỏ qua" trên quảng cáo đang phát
→ ad state kết thúc/chuyển tiếp
```

Engineering implication:

- `hover-preview` phải được coi là action/outcome candidate trong Behavior Dataset Preparation;
- không map mọi focus/state transition thành navigation click;
- cần dùng pointer trajectory/enter/dwell cùng mutation/semantic state change để phân biệt hover activation;
- `click-control` như Skip Ad phải tách khỏi hover-preview;
- khi sau này sửa target/action resolver, dùng case này làm regression fixture synthetic thay vì commit raw user session.

---

# 11. Maintenance rules for this journal

Update this file when any of these happen:

- file/module responsibility changes;
- a new contract is introduced;
- one component starts depending on another;
- a difficult bug reveals a non-obvious invariant;
- a temporary mechanism is added/removed;
- a major architecture decision changes;
- test/CI path for a component changes;
- a migration/version changes where future edits should begin.

Do **not** turn journal into a dump of every commit. Only record information that helps future diagnosis/modification.

Before modifying an area after a long gap, search this journal by terms such as:

```text
pointer
mutation
IndexedDB
ACK
export
privacy
Strategy
Behavior
CDP
Recorder
selector
visibility
hover
preview
```

Then fetch the referenced source files from `main` before making changes.
