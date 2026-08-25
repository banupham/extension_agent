# STATUS — 2026-08-25

## Source of truth

GitHub `banupham/extension_agent` là source chính của dự án. Mỗi milestone kiến trúc/implementation quan trọng phải cập nhật file này để có thể tiếp tục từ trạng thái hiện tại mà không cần khảo sát lại từ đầu.

Workflow local thường dùng:

```bat
git pull
```

Deterministic Scenario Mode tiếp tục được giữ. Agent Mode và Training Collector phát triển song song, không thay thế scenario runner hiện tại.

## Ba sản phẩm tách biệt

```text
RECORDER
Human → deterministic Scenario

TRAINING COLLECTOR
Human → raw browser session + semantic/physical training data

AGENT
Task → Strategy → Action Contract → Behavior Policy → CDP Executor
```

## Training Collector hiện tại — V0.5 Compact Raw

Collector observe-only, không tự click/type/navigate và không dùng `chrome.debugger` để điều khiển trang.

Kiến trúc hiện tại:

```text
Browser Session
│
├─ Physical Capture
│  ├─ pointer trajectory
│  ├─ pointer down/up
│  ├─ wheel / scroll
│  ├─ keyboard timing + operation class
│  └─ idle/focus/visibility lifecycle
│
├─ Semantic DOM Capture
│  ├─ stable page-scoped element refs
│  ├─ role / label / selector candidates
│  ├─ rendered / inViewport / interactable
│  ├─ click/focus/input/change/submit
│  └─ state snapshots/diffs
│
├─ Physical ↔ Semantic Correlation
│  └─ targetRef at capture time
│
├─ Mutation Trace
│  └─ 120 ms compact mutation bursts
│
└─ Raw Session Store
   └─ chrome.storage.local chunks (development-stage only)
```

### V0.5 compact changes

- physical events giữ `targetRef`; descriptor chỉ xuất hiện lần đầu cần thiết;
- mutation được gom thành `dom-mutation-burst` 120 ms thay vì từng MutationRecord;
- visibility tách `rendered`, `inViewport`, `interactable`;
- selector có `selectorCandidates` + score;
- Task Episode ưu tiên state diff thay vì full snapshot lặp lại;
- `tsEpochMs` là capture time, `sessionSeq` chỉ là persistence order;
- chunk size tăng 250 → 500;
- manual debug export dùng `.raw.jsonl`;
- analyzer đọc V0.4 JSON và V0.5 JSONL.

### Kết quả thực nghiệm V0.4 dẫn tới V0.5

Một phiên thật ~29k events cho thấy:

- physical capture: tốt;
- pointer ↔ DOM correlation: ~100% trên pointer/wheel trong phiên thử;
- mutation chiếm quá nhiều dữ liệu ở V0.4;
- visibility cũ chưa phân biệt ngoài viewport;
- `sessionSeq` ổn về integrity nhưng không phải chronological truth;
- selector đơn lẻ thường quá chung.

Một phiên V0.4.1 khác có 17,719 events đã được convert thử sang V0.5-compatible JSONL:

```text
source events        17,719
converted events     11,755
source mutations      6,273
mutation bursts         309
source size           17.35 MB
converted size         9.33 MB
reduction              46.2%
```

Đây là compatibility conversion, không thay thế native V0.5 capture.

## Collector storage roadmap

`.json`, `.jsonl` và auto-download hiện tại chỉ là development/debug adapters phục vụ phân tích.

Không coi auto-export khi Chrome mở lại là storage architecture dài hạn.

Roadmap chính:

```text
V0.5
compact raw + JSONL debug export
↓
V0.6
IndexedDB ChunkStore
+ streaming export
+ gzip .jsonl.gz
+ checksum/recovery
+ retention/session index
↓
Dataset Pipeline
normalize / derive features
→ Parquet cho analytics/training
```

Raw collection không bake speed/acceleration/path distributions. Các feature này được derive offline để raw source có thể tái xử lý.

## Privacy boundary

Không thu/lưu:

- password values;
- cookies;
- localStorage/sessionStorage secrets;
- Authorization/access tokens;
- clipboard contents;
- payment secrets;
- raw printable keyboard characters/codes;
- raw input values;
- URL query values/hash content;
- raw document title.

Sensitive target phải bị loại ở content script trước khi dữ liệu rời page.

## Agent architecture hiện tại

Agent phải có đồng thời 3 năng lực:

```text
1. hiểu đúng vấn đề / mục tiêu
2. chọn đúng hành động
3. thực hiện hành động tự nhiên
```

Kiến trúc chuẩn:

```text
TASK
↓
OBSERVE
↓
UNDERSTAND / STRATEGY / PLANNER
↓
NORMALIZED ACTION CONTRACT
↓
NATURAL EXECUTION POLICY / BEHAVIOR MODEL
↓
CDP EXECUTOR
↓
CHROME
↓
OBSERVE stateAfter
↓
GOAL CHECKER
↓
repeat
```

### Trách nhiệm từng lớp

```text
Strategy = WHAT to do
Behavior Model = HOW to do it naturally
Executor = translate execution plan into CDP
```

Strategy không phát raw CDP và không quyết định chi tiết mouse path/timing vi mô.

Ví dụ Strategy:

```js
{
  action: "click",
  targetRef: "e17"
}
```

Behavior layer có thể quyết định dựa trên learned human data:

```text
pointer acquisition
→ velocity/deceleration profile
→ correction near target
→ hover timing
→ mouseDown hold
→ mouseUp
```

Không dùng cách tiếp cận `random delay everywhere` / `random jitter everywhere` làm nền tảng. Natural execution phải được học/ước lượng từ distribution của human demonstrations và condition theo target/context.

## Behavior learning data từ Collector

Collector là nguồn dữ liệu cho Natural Execution Policy.

Derived offline features dự kiến:

```text
pointer
- path shape
- velocity
- acceleration
- jerk
- curvature
- correction / overshoot
- hover pause
- click hold duration

keyboard
- key down/up duration
- inter-key interval
- typing burst
- pause distribution

scroll
- wheel burst
- delta distribution
- pause
- correction
```

Correlation cho phép học behavior conditioned on semantic target, ví dụ small button / large card / textbox có acquisition profile khác nhau.

## Execution Behavior Contract — planned

Không thay Action Contract hiện tại. Sẽ thêm contract riêng giữa normalized action và executor:

```text
Normalized Action
↓
Execution Behavior Contract
↓
CDP Executor
```

Contract này mô tả execution policy/profile, không chứa planning semantics và không làm Strategy phụ thuộc vào CDP.

## Agent Runtime one-action loop

```text
1 receive Task
2 validate
3 observe
4 redact
5 strategy.decide
6 validate Decision
7 behavior policy prepares execution
8 execute ONE action
9 observe after
10 goal/outcome check
11 append trajectory
12 repeat
```

Budgets bắt buộc:

- maxSteps
- maxDurationMs
- maxConsecutiveFailures
- maxReplans
- domain/navigation constraints nếu task yêu cầu

Terminal states:

```text
DONE
FAILED
BLOCKED
BUDGET_EXHAUSTED
CANCELLED
```

## Strategy hiện tại

`control-center/manager/strategy/` đã có Task/Observation/Decision/Outcome/Episode contracts và baseline strategy để smoke-test kiến trúc.

Baseline hiện chỉ là rules baseline, chưa phải trained/general planner.

Strategy chưa được nối trực tiếp vào manager production loop; integration chỉ thực hiện sau khi Observer + goal checker + one-action executor bridge ổn định.

## Agent Runtime extension

`control-center/extension/agent-runtime-extension/` là runtime thử nghiệm riêng, không thay deterministic executor hiện tại.

Backbone dùng `chrome.debugger`/CDP và normalized actions. Model/Strategy không được phát CDP trực tiếp.

## Recorder

Recorder V4 giữ nhiệm vụ Human → deterministic Scenario. Recorder và Training Collector là hai sản phẩm riêng; không gộp raw training telemetry vào deterministic scenario format.

## Việc tiếp theo

### Collector V0.5 validation

- thu native V0.5 browser session;
- so sánh V0.4 vs V0.5: file size, mutation count/burst count, correlation, pointer sampling, privacy/integrity;
- sửa tiếp compact representation nếu còn duplication;
- sau đó bắt đầu V0.6 IndexedDB ChunkStore.

### Agent natural execution

- định nghĩa Execution Behavior Contract;
- xây offline behavior feature extractor từ Collector raw;
- phân tách target acquisition / typing / scroll behavior;
- tạo baseline Behavior Policy từ empirical distributions;
- chỉ sau đó mới nối Behavior Policy vào Agent Runtime executor bridge.

## Nguyên tắc duy trì repo

1. GitHub là source of truth.
2. Sau milestone quan trọng phải cập nhật `STATUS.md`.
3. Quyết định kiến trúc dài hạn cập nhật `docs/AGENT_TRAINING_ARCHITECTURE.md` hoặc README module tương ứng.
4. Debug adapters tạm thời phải được ghi rõ là temporary, không để vô tình trở thành architecture chính.
5. Không tuyên bố browser-tested nếu chưa có test Chrome thật; CI và manual browser validation phải phân biệt rõ.
6. Deterministic Scenario Mode, Training Collector và Agent Runtime phải giữ boundary rõ ràng.
