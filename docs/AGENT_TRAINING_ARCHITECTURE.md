# Agent Training Architecture — Roadmap

## 1. Mục tiêu

Hệ thống tiến từ deterministic browser automation sang goal-directed browser agent.

Input runtime mong muốn:

```text
TASK
  ↓
OBSERVE current browser state
  ↓
STRATEGY / PLANNER chooses next action
  ↓
EXECUTOR performs action
  ↓
OBSERVE new state
  ↓
GOAL CHECKER evaluates progress / completion
  ↓
repeat until DONE / FAILED / budget exhausted
```

Scenario deterministic hiện tại vẫn được giữ nguyên. Agent Mode là lớp mới chạy song song, không thay thế Recorder/Scenario Mode.

---

## 2. Nguyên tắc chuẩn hoá

### 2.1 Task contract

Task phải mô tả mục tiêu, không mô tả chuỗi click cứng.

```js
{
  taskId: "...",
  type: "web_search",
  instruction: "Search Google for OpenAI",
  args: { query: "OpenAI" },
  successCriteria: [...],
  constraints: {...}
}
```

### 2.2 Observation contract

Observer tạo semantic state thay vì screenshot/DOM dump thuần túy.

```js
{
  url,
  title,
  viewport,
  scroll,
  focusedElement,
  interactiveElements: [
    {
      id,
      tag,
      role,
      label,
      text,
      editable,
      enabled,
      visible,
      checked,
      selected,
      rect,
      selectors
    }
  ]
}
```

Không đưa password, cookie, token, authorization header hoặc secret storage vào observation.

### 2.3 Action contract

Strategy chỉ được sinh action nằm trong action contract executor hiện tại:

- navigation: `openUrl`, `reload`, `goBack`, `goForward`, `waitForUrl`
- pointer: `clickRecorded`, `click`, `clickSelector`, `clickFirstMatch`, `doubleClickSelector`, `hoverSelector`, `moveMouse`, `dragAndDrop`, `scroll`, `scrollTo`, `scrollBy`
- keyboard: `type`, `replaceText`, `clearInput`, `pressKey`, `keyCombo`
- forms: `focusSelector`, `selectOption`, `setChecked`
- wait: `wait`, `waitForSelector`, `waitForUrl`
- inspection: `getElementPosition`, `getActiveTab`, `getElementText`, `getPageInfo`, `listTabs`, `getCapabilities`

### 2.4 Decision contract

```js
{
  status: "act" | "done" | "blocked" | "failed",
  action: {...} | null,
  targetRef: "element-id" | null,
  confidence: 0.0,
  reasonCode: "...",
  expectedOutcome: {...},
  recovery: {...}
}
```

`reasonCode` là label ngắn phục vụ diagnostics/training. Không lưu chain-of-thought.

### 2.5 Outcome contract

Mỗi step phải biết action có thành công hay không và task đã hoàn tất chưa.

```js
{
  actionSucceeded: true,
  taskSucceeded: false,
  progress: 0.6,
  evidence: [...],
  errorCode: null
}
```

---

## 3. Kiến trúc dữ liệu từ Recorder đến training

```text
Recorder V4 interaction telemetry
       ↓
Training Capture
       ↓
Privacy Redaction
       ↓
Episode Builder
       ↓
Dataset Validator
       ↓
Dataset Split
 train / validation / test
       ↓
Training / Retrieval Index
       ↓
Strategy Provider
       ↓
Agent Runtime
```

### 3.1 Recorder

Recorder giữ interaction fidelity:

- exact waits
- click target + rx/ry
- mouse path
- pointer hold
- detailed keyboard operations
- Backspace/Delete count
- scroll/wheel metrics
- navigation timing

Recorder không chịu trách nhiệm suy luận goal.

### 3.2 Training Capture

Lớp mới sẽ ghép Recorder event với:

```text
TASK
STATE_BEFORE
ACTION
STATE_AFTER
OUTCOME
```

Đây là đơn vị demonstration chuẩn.

### 3.3 Privacy Redaction

Mặc định không lưu:

- password / credential fields
- cookie
- access/refresh token
- Authorization header
- clipboard content
- payment-card/secret values
- raw sensitive form text

Với text analytics có thể chỉ lưu:

```js
{
  typedCharCount,
  backspaceCount,
  deleteCount,
  keyIntervalsMs,
  finalLength
}
```

Task datasets có nội dung semantic cần thiết phải được cung cấp riêng hoặc đã được kiểm soát/redact.

### 3.4 Episode format

```js
{
  episodeId,
  task,
  environment,
  steps: [
    {
      index,
      stateBefore,
      action,
      stateAfter,
      outcome,
      interactionMeta
    }
  ],
  finalOutcome,
  recorderMeta
}
```

---

## 4. Hướng huấn luyện

Không bắt đầu bằng model phức tạp. Phát triển theo tầng để có baseline đo được.

### Phase A — Rule/heuristic baseline

Mục tiêu: kiểm chứng contracts + runtime loop.

Ví dụ `web_search`:

```text
searchbox visible → focus/type
query present → Enter
results visible → done
```

### Phase B — Demonstration retrieval

Tìm episode/step gần nhất theo:

```text
task type + URL/domain + semantic state
```

Sau đó dùng action mẫu làm candidate.

### Phase C — Behavior cloning / action prediction

Training samples:

```text
(task + stateBefore) -> action
```

Đánh giá bằng action accuracy và task success rate, không chỉ loss.

### Phase D — Candidate ranking / value model

Sinh nhiều action candidate rồi xếp hạng theo xác suất tạo progress/success.

### Phase E — Planner policy

Planner có thể tạo subgoal và re-plan sau mỗi observation.

Model không được tự gọi browser trực tiếp; mọi action phải đi qua Strategy contract và Executor contract.

---

## 5. Agent Runtime chuẩn

```text
1. receive Task
2. validate Task
3. observe state
4. redact state
5. strategy.decide(task, state, history)
6. validate Decision
7. execute one action
8. observe stateAfter
9. evaluate outcome / goal
10. append trajectory step
11. repeat
```

Runtime budgets bắt buộc:

- maxSteps
- maxDurationMs
- maxConsecutiveFailures
- maxReplans
- domain/navigation constraints nếu task yêu cầu

Agent dừng với một trong:

```text
DONE
FAILED
BLOCKED
BUDGET_EXHAUSTED
CANCELLED
```

---

## 6. Module Strategy mới

Vị trí:

```text
control-center/manager/strategy/
├─ index.js
├─ contracts.js
├─ baseline_strategy.js
└─ README.md
```

Strategy không phụ thuộc trực tiếp vào UI hay queue manager.

Interface:

```js
const strategy = createStrategy({ provider });
const decision = await strategy.decide({ task, observation, history });
```

Provider roadmap:

```text
baseline
retrieval
trained-policy
planner-model
```

Tất cả provider phải trả cùng Decision contract.

---

## 7. Mapping với code hiện tại

### Recorder

Hiện tại:

```text
interaction capture
```

Sẽ thêm sau:

```text
Training Capture Mode
stateBefore/stateAfter hooks
privacy-redacted episode export
```

### Stealth Executor

Giữ vai trò Action Executor. Không chứa planning policy.

### run_check.js

Giữ deterministic scenario runner.

Agent Runtime sẽ tái sử dụng cùng action contract nhưng gọi từng action theo vòng observe/decide/execute.

### Control Center

Sau khi Strategy contract ổn sẽ thêm Agent Mode:

```text
Task input
Browser selection
Strategy provider
Budgets
Live trajectory
Goal status
```

Queue/scheduling hiện tại vẫn được tái sử dụng ở mức job.

---

## 8. Kế hoạch phát triển / test

### M0 — Architecture + contracts

- [x] vẽ kiến trúc end-to-end
- [x] tạo Strategy module skeleton
- [x] định nghĩa Task/Observation/Decision/Outcome/Episode contracts
- [ ] contract smoke test trong CI

### M1 — Observer

- [ ] semantic interactive-element snapshot
- [ ] focused element
- [ ] URL/title/viewport/scroll
- [ ] stable element refs
- [ ] privacy redaction
- [ ] observer fixtures/tests

### M2 — Training Capture

- [ ] gắn Task vào recording session
- [ ] stateBefore/action/stateAfter
- [ ] outcome labels
- [ ] Episode JSON export
- [ ] password/credential exclusion tests

### M3 — Baseline Strategy Runtime

- [ ] Agent Runtime loop
- [ ] one-action-at-a-time executor bridge
- [ ] baseline rules for a small task set
- [ ] budgets/recovery
- [ ] live trajectory diagnostics

### M4 — Dataset pipeline

- [ ] schema validator
- [ ] sanitizer/redactor
- [ ] episode quality scoring
- [ ] train/validation/test split by task/domain/session
- [ ] dataset statistics

### M5 — Retrieval Strategy

- [ ] semantic state fingerprint
- [ ] nearest demonstrations
- [ ] candidate action ranking baseline

### M6 — Trained policy

- [ ] training export format
- [ ] action prediction model
- [ ] offline evaluation
- [ ] shadow-mode evaluation before browser execution

### M7 — Goal-directed Planner

- [ ] subgoal representation
- [ ] progress model
- [ ] re-planning
- [ ] recovery from changed UI
- [ ] multi-step benchmark

---

## 9. Benchmark đầu tiên

Không bắt đầu bằng web phức tạp. Bộ benchmark ban đầu:

```text
B1: open a known URL
B2: locate and focus a semantic input
B3: type requested text
B4: submit with Enter/button
B5: verify resulting state
B6: recover from one dismissible overlay
B7: scroll to locate a target
```

Sau khi B1-B7 ổn mới map thành task tổng hợp kiểu:

```text
"Open Google and search for <query>"
```

Success phải được đo bằng state/outcome, không đo bằng việc agent đã phát đủ số action.

---

## 10. Nguyên tắc phát triển tiếp theo

1. Contract trước, implementation sau.
2. Observer/goal checker quan trọng ngang planner.
3. Không train trực tiếp từ raw Recorder log chưa ghép state/task/outcome.
4. Deterministic Scenario Mode và Agent Mode tách biệt.
5. Mọi provider dùng chung action contract.
6. Privacy redaction xảy ra trước khi ghi dataset training.
7. Mỗi milestone phải có fixture + offline test trước khi chạy browser thật.
