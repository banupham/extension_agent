# STATUS — 2026-08-25

## Source of truth

GitHub `banupham/extension_agent` là source chính của dự án. Sau milestone implementation/architecture quan trọng phải cập nhật file này để lần sau có thể tiếp tục ngay.

Local workflow:

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

# Training Collector — CURRENT: V0.7 Action Semantics

Manifest name:

```text
Training Collector V0.7 Action Semantics
```

Runtime version: `0.7.0`  
Raw schema: `0.7.0`

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
├─ hover enter/dwell/leave raw semantic facts
├─ rendered / inViewport / interactable
├─ selectorCandidates + score
└─ semantic snapshot / episode state diff

Mutation
└─ 120 ms dom-mutation-burst
```

Raw physical data không bake velocity/acceleration/path distributions. Higher-level behavior/action semantics được derive offline.

## V0.7 — hover semantics

Dữ liệu thực tế V0.6.1 trên YouTube cho thấy hover có thể là action có outcome:

```text
pointer enters video thumbnail
→ dwell
→ animated preview starts
→ mute/audio control appears
→ no navigation
```

V0.7 không ghi thẳng `hover-preview` vào raw. Raw chỉ bổ sung các fact trực tiếp:

```text
dom-hover-enter
dom-hover-dwell
dom-hover-leave
```

Higher-level classification được derive bởi:

```text
training-collector/tools/build_action_semantics.js
```

Flow:

```text
hover facts
+ mutation bursts
+ click evidence
+ page/capture ordering
↓
hover / hover-dwell / hover-preview derived action
```

Điều này giữ nguyên nguyên tắc raw physical/semantic facts không bị thay bằng feature suy diễn.

## V0.7 — Action Target Resolver

File mới:

```text
training-collector/correlation/action_target_resolver.js
```

DOM click giờ giữ đồng thời:

```text
targetRef          = legacy/raw event target ref
rawTargetRef       = raw DOM event.target ref
resolvedTargetRef  = best actionable semantic target
targetResolution   = method + confidence
```

Resolver ưu tiên:

```text
composedPath actionable
→ elementFromPoint actionable
→ raw target actionable ancestor
→ raw target
```

Không overwrite raw target. Mục tiêu là sửa các case UI động nơi `event.target` rơi vào wrapper/container lớn nhưng intent thực tế nằm ở button/card/control con.

## V0.7 — timeline ordering

Mỗi event capture mới có thêm:

```text
pageSeq   = thứ tự capture trong pageInstance hiện tại
sourceSeq = thứ tự trong source stream
sessionSeq = persistence order ở background
```

Interpretation:

```text
tsEpochMs = capture timestamp truth
pageSeq   = page-local capture ordering / tie-breaker
sourceSeq = source-local ordering
sessionSeq = durable persistence ordering
```

Mutation burst được cấp `pageSeq/sourceSeq` ngay khi burst bắt đầu, không chờ flush 120 ms.

## Persistence / reliability inherited from V0.6

Raw event store chính vẫn là IndexedDB:

```text
content scripts
→ RAW_BATCH + batchId
→ ACK/retry journal
→ background serialized append
→ IndexedDB trainingCollectorRawV06
   ├─ sessions
   ├─ chunks
   └─ batchReceipts
```

Chunk size: 1000 events.

Reliability vẫn gồm:

- batch receipt idempotency;
- retry khi ACK mất;
- chunk checksum FNV-1a;
- missing/checksum/sequence integrity verification;
- không tự delete raw session khi integrity fail.

IndexedDB DB name vẫn giữ `trainingCollectorRawV06` để tránh migration storage không cần thiết; raw schema trong session/event mới là `0.7.0`.

## Temporary auto-export

V0.7 tiếp tục giữ temporary development auto-export:

```text
Chrome session A
→ IndexedDB
→ Chrome đóng
→ lần mở Chrome tiếp theo
→ infer A closed
→ full integrity verify
→ offscreen gzip JSONL
→ Downloads/training-collector/*.raw.jsonl.gz
```

Đây chỉ là development convenience, không phải storage architecture dài hạn.

Export header ưu tiên `session.schemaVersion`, nên native V0.7 export được đánh dấu `0.7.0` dù background compatibility API vẫn thuộc V0.6 storage layer.

## Privacy boundary

Không thu/lưu:

- password values;
- cookies;
- Authorization/access tokens;
- localStorage/sessionStorage secret contents;
- clipboard contents;
- payment secrets;
- raw sensitive input values;
- printable keyboard actual character/code;
- URL query values/hash content;
- raw document title theo policy hiện tại.

## V0.7 tests / CI

New contract:

```text
training-collector/tests/v07_action_semantics_contract.js
```

Synthetic regression test gồm:

```text
hover-enter
→ hover-dwell
→ mutation burst / control added
→ hover-leave
→ derived hover-preview
```

v06 storage contract vẫn chạy để đảm bảo V0.7 không phá IndexedDB/ACK/checksum/auto-export.

CI workflow phải check thêm:

```text
observer/hover_trace.js
correlation/action_target_resolver.js
tools/build_action_semantics.js
tests/v07_action_semantics_contract.js
```

CI không thay manual Chrome validation.

## Browser validation tiếp theo

Ưu tiên native V0.7 data thật trước khi xây Behavior Model.

```text
1 git pull
2 chrome://extensions → Reload
3 xác nhận Training Collector V0.7 Action Semantics
4 đóng/mở Chrome để tạo clean raw schema 0.7.0 session
5 test đặc biệt:
   - hover thumbnail đủ lâu để preview động
   - hover rồi rời đi không click
   - hover rồi click control loa/mute
   - click Skip Ad
   - click link/card bình thường
   - scroll/type/multiple tabs như trước
6 không cần manual export
7 đóng Chrome → mở lại
8 gửi .raw.jsonl.gz auto-export
```

Phân tích V0.7 phải kiểm tra:

```text
hover enter/dwell/leave pairing
hover-preview derivation quality
rawTargetRef vs resolvedTargetRef
resolution confidence/method distribution
pageSeq/sourceSeq continuity
timestamp inversions
pointer sampling
mutation relevance/noise
sessionSeq/chunk integrity
gzip size/privacy
```

## Next after V0.7 validation

Nếu V0.7 action semantics ổn:

```text
Action Window Builder
→ target acquisition trajectories
→ click / hover / typing / scroll windows
→ mutation/state outcome relevance
→ Behavior Feature Extractor
→ Execution Behavior Dataset
```

Sau đó mới xây empirical/learned Natural Execution Policy cho Agent.

---

# Agent architecture

Agent phải đồng thời:

```text
1 hiểu đúng vấn đề/mục tiêu
2 chọn đúng hành động
3 thực hiện hành động tự nhiên
```

Architecture:

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

Responsibilities:

```text
Strategy       = WHAT to do
Behavior Model = HOW to do it naturally
Executor       = translate execution plan into CDP
```

Natural behavior không dựa vào random delay/jitter. Nó phải derive/learn từ human demonstrations và condition theo target/context/action.

---

# Development rules

1. GitHub là source of truth.
2. Đọc `STATUS.md` → `docs/PROJECT_JOURNAL.md` → source hiện tại trước khi sửa.
3. Cập nhật STATUS/JOURNAL sau milestone lớn hoặc bug/invariant khó.
4. Debug/auto-export adapters phải ghi rõ temporary.
5. Không tuyên bố browser-tested nếu chỉ có CI.
6. Recorder, Collector, Scenario Mode và Agent Runtime giữ boundary rõ ràng.
7. Không commit raw user session vào repo; regression fixture phải synthetic/minimal.
8. Trước Behavior Model, ưu tiên xác nhận Action Semantics bằng native V0.7 data thật.
