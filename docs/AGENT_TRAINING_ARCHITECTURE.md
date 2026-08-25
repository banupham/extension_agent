# Agent Training Architecture — Roadmap

## 1. Mục tiêu

Hệ thống tiến từ deterministic browser automation sang goal-directed browser agent nhưng vẫn giữ Scenario Mode ổn định.

Agent cuối cùng phải đồng thời có ba năng lực:

```text
1. hiểu đúng task / trạng thái / vấn đề
2. chọn đúng next action
3. thực thi action theo hành vi tự nhiên, ổn định và phù hợp context
```

Runtime đích:

```text
TASK
↓
OBSERVE current browser state
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
repeat until DONE / FAILED / budget exhausted
```

Scenario deterministic, Recorder, Training Collector và Agent Runtime là các boundary riêng; chúng có thể chia sẻ contract/dataset nhưng không gộp trách nhiệm.

## 2. Boundary trách nhiệm

```text
Strategy       = WHAT to do
Behavior Model = HOW to do it naturally
Executor       = translate execution instructions into CDP
```

Strategy/Planner không được phát raw CDP.

Ví dụ Strategy chỉ cần trả:

```js
{
  action: "click",
  targetRef: "e17"
}
```

Strategy không quyết định trực tiếp quỹ đạo chuột chi tiết, số ms hover, mouse-down hold hoặc từng CDP packet.

Behavior layer nhận normalized action + semantic target/context và tạo execution profile.

## 3. Core contracts

### 3.1 Task

```js
{
  taskId,
  type,
  instruction,
  args: {},
  successCriteria: [],
  constraints: {},
  metadata: {}
}
```

Task mô tả goal, không hard-code chuỗi click.

### 3.2 Observation

Observation là semantic browser state đã privacy-redact, không phải DOM dump thô.

```js
{
  observationId,
  capturedAt,
  url,
  title,
  viewport: {},
  scroll: {},
  focusedElement: null,
  interactiveElements: [],
  pageSignals: {},
  privacy: { redacted: true }
}
```

Semantic elements cần stable page-scoped refs và các state như role/label, selector candidates, rendered/inViewport/interactable, editable/enabled, rect và relevant state.

### 3.3 Decision

```js
{
  contractVersion,
  status: "act" | "done" | "blocked" | "failed",
  action: {...} | null,
  targetRef,
  confidence,
  reasonCode,
  expectedOutcome: {},
  recovery: {},
  metadata: {}
}
```

Không lưu chain-of-thought. `reasonCode` là diagnostic/training label ngắn.

### 3.4 Outcome

```js
{
  actionSucceeded,
  taskSucceeded,
  progress,
  evidence: [],
  errorCode,
  metadata: {}
}
```

### 3.5 Episode

```js
{
  contractVersion,
  episodeId,
  task,
  environment,
  steps,
  finalOutcome,
  recorderMeta
}
```

## 4. Execution Behavior Contract

Action Contract hiện tại vẫn là semantic normalized action contract. Không nhồi natural behavior fields trực tiếp vào Strategy Decision.

Thêm một contract riêng ở execution layer:

```text
Decision.action
↓
Execution Behavior Contract
↓
CDP Executor
```

Phiên bản đầu dự kiến:

```js
{
  behaviorVersion: "0.1",
  actionId: "a17",
  action: "click",
  targetRef: "e17",
  pointer: {
    profile: "learned",
    targetAcquisition: "adaptive"
  },
  timing: {
    profile: "learned"
  },
  keyboard: null,
  scroll: null,
  metadata: {}
}
```

Contract không cần chứa toàn bộ sampled trajectory nếu execution policy có thể sinh nó runtime; mục tiêu là giữ boundary sạch giữa planner và executor.

## 5. Natural execution không phải randomization

Không dùng nền tảng:

```text
random delay everywhere
random jitter everywhere
```

Natural execution phải xuất phát từ human demonstration distributions và phụ thuộc context/target.

Ví dụ click execution:

```text
current pointer position
→ target acquisition path
→ velocity/deceleration profile
→ corrections near target nếu distribution phù hợp
→ hover/acquisition pause
→ mouseDown
→ hold duration
→ mouseUp
```

Typing:

```text
focus acquisition
→ initial pause
→ key timing rhythm
→ burst/pause structure
→ editing operations
```

Scroll:

```text
wheel burst
→ delta/time profile
→ pause
→ optional correction
```

Mục tiêu là correctness + fidelity, không phải bot-evasion heuristics.

## 6. Training Collector là nguồn Behavior Learning

Training Collector chạy song song với Agent Runtime và thu hai raw stream đồng bộ:

```text
RAW PHYSICAL
pointer / wheel / keyboard timing / idle / scroll
+
SEMANTIC DOM
stable element refs / role / selector / rect / state / action / mutation
↓
CORRELATION
physical ↔ targetRef
```

Raw capture không bake derived speed/acceleration/path/pause distributions.

Derived offline behavior features dự kiến:

### Pointer

- path shape;
- duration/distance;
- velocity profile;
- acceleration / jerk;
- curvature;
- overshoot/correction;
- target acquisition slowdown;
- hover/acquisition pause;
- mouse down→up duration.

### Keyboard

- keyDown→keyUp duration;
- inter-key intervals;
- typing bursts;
- pauses;
- Backspace/Delete/Tab/Enter operation timing.

### Scroll

- wheel burst duration;
- delta distribution;
- velocity profile;
- pauses;
- correction/settling behavior.

Semantic correlation cho phép condition behavior theo target/context, ví dụ small button, large card và textbox có acquisition/timing distributions khác nhau.

## 7. Collector raw storage/dataset architecture

Current development direction:

```text
V0.5 Compact Raw
→ targetRef instead of repeated semanticTarget
→ mutation burst
→ state diff
→ JSONL debug export

V0.6
→ IndexedDB ChunkStore
→ streaming export
→ gzip .jsonl.gz
→ recovery/checksum/retention

Dataset Pipeline
→ validate/redact
→ derive features
→ episodes/behavior samples
→ Parquet for analytics/training
```

Debug auto-export/manual download không phải storage architecture dài hạn.

## 8. Agent Runtime one-action loop

```text
1. receive Task
2. validate Task
3. observe state
4. privacy redact
5. strategy.decide(task, state, history)
6. validate Decision
7. Behavior Policy prepares execution contract
8. Executor executes ONE normalized action
9. observe stateAfter
10. evaluate Outcome / Goal
11. append trajectory
12. repeat
```

Budgets:

- maxSteps;
- maxDurationMs;
- maxConsecutiveFailures;
- maxReplans;
- domain/navigation constraints.

Terminal states:

```text
DONE
FAILED
BLOCKED
BUDGET_EXHAUSTED
CANCELLED
```

## 9. Strategy learning roadmap

```text
Rule/heuristic baseline
↓
Demonstration retrieval
↓
Behavior cloning / action prediction
↓
Candidate ranking / value model
↓
Goal-directed planner + replanning
```

Strategy quality được đánh giá bằng task progress/success, không chỉ action classification accuracy.

## 10. Natural Behavior learning roadmap

Behavior learning là roadmap riêng nhưng dùng cùng demonstrations.

```text
Raw Collector Session
↓
Physical/Semantic Correlation
↓
Feature Extractor
↓
Behavior Dataset
↓
Empirical Distribution Baseline
↓
Context-conditioned Behavior Model
↓
Execution Behavior Contract
↓
Executor
```

### Phase N0 — Feature extraction

- pointer segments quanh action target;
- hover/acquisition windows;
- click hold distributions;
- key timing/bursts;
- wheel/scroll bursts.

### Phase N1 — Empirical baseline

Không train model phức tạp ngay. Fit distributions theo action/target context và sample từ distributions có constraints.

### Phase N2 — Context-conditioned policy

Condition theo:

```text
action type
current pointer position
target rect/size
target semantic role
editable state
scroll state
recent interaction history
```

### Phase N3 — Learned trajectory/timing policy

Chỉ sau khi có dataset đủ và offline metrics rõ mới thử learned trajectory/timing model.

## 11. Evaluation

Agent phải được đo trên ba trục riêng:

```text
Task Understanding / Planning
→ goal success / progress / recovery

Action Correctness
→ đúng target + đúng normalized action

Execution Fidelity
→ trajectory/timing distributions so với held-out human demonstrations
```

Natural execution không được phép làm giảm task correctness.

## 12. Privacy

Không thu/lưu:

- password/credential values;
- cookies;
- access/refresh tokens;
- Authorization headers;
- clipboard content;
- payment secrets;
- local/session storage secrets;
- raw sensitive form text;
- printable key content trong raw physical stream.

Sensitive filtering phải xảy ra trước khi data rời content script.

## 13. Module boundaries hiện tại

```text
control-center/manager/strategy/
  Task/Observation/Decision/Outcome contracts
  baseline strategy

control-center/extension/agent-runtime-extension/
  experimental normalized-action → CDP runtime

training-collector/
  physical + semantic human demonstration telemetry

recorder/
  deterministic Scenario generation
```

Strategy chưa được nối trực tiếp vào production manager loop cho tới khi Observer + goal checker + one-action executor bridge được kiểm chứng.

## 14. Milestones tiếp theo

### Collector

- native V0.5 validation bằng dữ liệu Chrome thật;
- so V0.4/V0.5 về size, mutation reduction, correlation và integrity;
- V0.6 IndexedDB ChunkStore + streaming gzip archive.

### Agent

- định nghĩa `Execution Behavior Contract v0.1` trong code;
- behavior feature extractor offline;
- empirical natural timing/pointer baseline;
- one-action Agent Runtime bridge;
- goal checker + trajectory diagnostics;
- sau đó mới nối trained/retrieval Strategy.

## 15. Nguyên tắc phát triển

1. Contract trước, implementation sau.
2. Strategy/Planner chỉ quyết định WHAT.
3. Natural Behavior Policy quyết định HOW naturally.
4. Executor là nơi duy nhất dịch normalized execution thành CDP.
5. Không train trực tiếp từ raw telemetry chưa qua correlation/validation.
6. Raw Collector giữ dữ liệu nguyên thủy; derived features nằm ngoài raw capture.
7. Privacy boundary ở nguồn capture.
8. Deterministic Scenario Mode không bị thay thế bởi Agent Mode.
9. Mỗi milestone cần CI/offline tests; browser manual validation được ghi riêng.
10. GitHub `STATUS.md` phải được cập nhật thường xuyên để giữ project continuity.
