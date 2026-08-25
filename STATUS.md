# STATUS — 2026-08-25

## Source of truth

GitHub `banupham/extension_agent` là source chính. Workflow local:

```bat
git pull
cd control-center
npm install
START_CONTROL_CENTER.bat
```

Deterministic Scenario Mode hiện tại tiếp tục được giữ ổn định. Agent Mode được phát triển như một lớp mới, không thay thế scenario runner.

## Cấu trúc chính hiện tại

```text
control-center/
├─ ACTION_CONTRACT.json
├─ package.json
├─ START_CONTROL_CENTER.bat
├─ STOP_CONTROL_CENTER.bat
├─ server/server.js
├─ manager/control_center.js
├─ manager/public/{index.html,app.js,style.css}
├─ manager/strategy/
│  ├─ index.js
│  ├─ contracts.js
│  ├─ baseline_strategy.js
│  └─ README.md
├─ extension/stealth-extension/{manifest.json,background.js}
└─ script/checks/
   ├─ run_check.js
   ├─ device_behavior.js
   └─ strategy_contract.js

recorder/
├─ ACTION_CONTRACT.json
├─ README.md
├─ background.js
├─ content.js
├─ manifest.json
├─ popup.html
└─ popup.js

docs/
└─ AGENT_TRAINING_ARCHITECTURE.md
```

## Control Center V3.10

Queue/Runs & Logs, browser↔scenario assignment (`all`, `pair`, `random`, `manual`) và execution (`parallel`, `sequential`) giữ nguyên. `manager/control_center.js` chưa require Strategy module; integration chỉ thực hiện sau khi Observer + goal checker + executor bridge được test độc lập.

## Executor / deterministic scenario

Executor + `run_check.js` giữ action contract hiện tại gồm navigation, pointer, keyboard, form, wait và inspection/lifecycle actions. `clickRecorded` vẫn deterministic theo selector + `rx/ry`; scroll deterministic giữ destination chính xác.

## Recorder V4.0 Detailed Input + Mouse Path

Recorder hiện tập trung vào interaction fidelity và dữ liệu demonstration phong phú.

### Timing

- exact waits không clamp 5000 ms;
- gap dài được xuất thành `wait`;
- giữ event sequence/timestamp/gap/page URL;
- navigation do click/Enter không làm mất timing phía sau.

### Click / mouse

- `clickRecorded` giữ selectors/text/attributes/rect;
- relative click point `rx/ry`;
- viewport fallback;
- pointerdown→pointerup duration;
- mouse path trước click với samples `{t,x,y}`;
- mouse path metrics: duration, displacement, path distance, average/peak speed.

### Detailed text input

`replaceText` không còn là mặc định cho mọi editable field.

Khi chuỗi thao tác tái dựng chắc chắn, Recorder giữ operations thực:

- `type`;
- `pressKey Backspace` đúng số lần;
- `pressKey Delete` đúng số lần;
- Enter/Tab;
- `keyCombo`.

`editTrace.summary` có các count như `backspaceCount`, `deleteCount`, `typedCharCount`, `operationCount`. Đồng thời giữ `initialValue`, `finalValue`, timeline changes và timing operations.

Fallback `replaceText` chỉ dùng cho các trường hợp khó tái dựng chắc chắn như paste/autofill/IME/composition/DOM replacement; metadata phải ghi reconstruction mode/reason.

### Scroll / gesture

Mỗi gesture có:

- started/ended/duration;
- viewport samples;
- raw wheel samples;
- displacement/path distance;
- average/peak speed;
- direction;
- wheel delta totals;
- speed samples;
- conservative sourceHint.

## Agent Strategy — milestone M0

Đã thêm module mới:

```text
control-center/manager/strategy/
```

Contract chuẩn:

```text
Task
Observation
Decision
Outcome
Episode
```

Runtime đích:

```text
TASK
→ OBSERVE
→ STRATEGY.decide()
→ EXECUTE one action
→ OBSERVE stateAfter
→ GOAL CHECK
→ append trajectory
→ repeat
```

Strategy không tự thao tác Chrome. Nó chỉ trả một action hợp lệ theo executor action contract hoặc trạng thái `done/blocked/failed`.

Baseline provider hiện chỉ dùng để kiểm chứng contracts và vòng action cho một task đơn giản `web_search`; đây chưa phải planner/model cuối cùng.

Kiến trúc đầy đủ xem `docs/AGENT_TRAINING_ARCHITECTURE.md`.

## Chuẩn dữ liệu training định hướng

Đơn vị demonstration chuẩn sẽ là:

```text
TASK
STATE_BEFORE
ACTION
STATE_AFTER
OUTCOME
```

Episode gồm nhiều step và final outcome. Recorder raw interaction chỉ là nguồn telemetry; không train trực tiếp từ raw log chưa ghép task/state/outcome.

Privacy mặc định loại trừ password, cookie, token, authorization header, clipboard content, payment secrets và raw sensitive form values trước khi dataset được ghi.

## Roadmap tiếp theo

### M1 Observer

- semantic interactive-element snapshot;
- focused element;
- URL/title/viewport/scroll;
- stable element refs;
- privacy redaction;
- fixtures/offline tests.

### M2 Training Capture

- gắn Task vào recording session;
- stateBefore/action/stateAfter;
- outcome labels;
- Episode JSON export;
- privacy exclusion tests.

### M3 Agent Runtime

- one-action executor bridge;
- observe→decide→execute→observe loop;
- budgets/recovery;
- live trajectory diagnostics;
- goal checker.

### M4 Dataset Pipeline

- schema validator;
- sanitizer/redactor;
- quality scoring;
- train/validation/test split;
- dataset statistics.

### M5+ Strategy learning

```text
baseline rules
→ demonstration retrieval
→ trained action policy
→ candidate ranking/value model
→ goal-directed planner + re-planning
```

## CI

GitHub Actions syntax workflow kiểm tra executor, manager, Recorder và Strategy module. CI còn chạy `strategy_contract.js` để xác nhận baseline sequence + contracts.

## Test gần nhất cần làm

1. Pull + reload Recorder V4.0 và xác nhận detailed Backspace/Delete + mouse path trên máy thật.
2. Chạy/đọc `strategy_contract.js` để xác nhận Strategy module không ảnh hưởng manager hiện tại.
3. Bắt đầu M1 Observer bằng fixtures trước, chưa nối vào browser runtime ngay.
4. Khi Observer contract ổn mới map Recorder → Training Capture.
5. Sau M1/M2 mới tích hợp Agent Mode vào Control Center.

## Phạm vi

Hướng phát triển tập trung vào browser interaction capture, deterministic automation, goal-directed task planning, training-data quality, privacy redaction, correctness, observability và testability.
