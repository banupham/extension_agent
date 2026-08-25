# Strategy Module

Module này là lớp quyết định cho Agent Mode. Nó tách biệt khỏi deterministic Scenario Mode và chưa được nối trực tiếp vào queue/executor ở milestone hiện tại.

## Vai trò

Input:

```text
Task + Observation + History
```

Output:

```text
Decision
```

Strategy không tự thao tác Chrome. Nó chỉ sinh một action hợp lệ theo executor action contract hoặc trả trạng thái terminal.

## Files

```text
strategy/
├─ index.js               # public entrypoint
├─ contracts.js           # Task/Observation/Decision/Outcome/Episode contracts
├─ baseline_strategy.js   # rule baseline để test runtime/contracts
└─ README.md
```

## Usage

```js
const { createStrategy } = require('./strategy');

const strategy = createStrategy({ provider: 'baseline' });

const decision = await strategy.decide({
  task: {
    taskId: 'demo-1',
    type: 'web_search',
    instruction: 'Search for OpenAI',
    args: { query: 'OpenAI' }
  },
  observation: {
    url: 'https://www.google.com/',
    interactiveElements: [
      {
        id: 'e1',
        tag: 'textarea',
        role: 'combobox',
        label: 'Search',
        selector: 'textarea[name=q]',
        visible: true,
        enabled: true,
        editable: true
      }
    ]
  },
  history: []
});
```

## Decision contract

```js
{
  status: 'act' | 'done' | 'blocked' | 'failed',
  action: {...} | null,
  targetRef: null,
  confidence: 0.0,
  reasonCode: 'short_machine_readable_label',
  expectedOutcome: {},
  recovery: {},
  metadata: {}
}
```

`reasonCode` chỉ là nhãn diagnostics/training; không lưu private reasoning/chain-of-thought.

## Baseline provider

Baseline hiện chỉ nhằm chứng minh flow contract. Với `web_search`, nó có thể tạo chuỗi:

```text
focus search input
→ type task.args.query
→ Enter
→ wait for observer/goal signal
```

Đây không phải planner cuối cùng và không được dùng làm bằng chứng rằng agent đã generalize.

## Provider roadmap

```text
baseline
→ retrieval
→ trained-policy
→ candidate-ranker
→ planner-model
```

Mọi provider phải dùng cùng contracts để Control Center và executor không phụ thuộc model cụ thể.

## Integration rule

Chưa require module này trong `control_center.js` cho tới khi hoàn thành:

1. Observer contract + privacy redaction.
2. one-action executor bridge.
3. Agent Runtime budgets.
4. offline contract tests.
5. goal checker.

Sau đó mới thêm Agent Mode API/UI.

Kiến trúc tổng thể và milestones xem `docs/AGENT_TRAINING_ARCHITECTURE.md`.
