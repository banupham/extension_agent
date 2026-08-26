# Browser Debug Agent Control Center V3.10 Assignment Modes

Kế thừa V3.8 Observable Queue Fix, V3.9 Recorded Click và bổ sung phân công browser ↔ scenario.

## Cấu trúc chuẩn

Cấu trúc repo giữ tương thích với gói ZIP V3.8:

- `server/server.js`
- `manager/control_center.js`
- `manager/public/{index.html,app.js,style.css}`
- `extension/stealth-extension/{manifest.json,background.js}`
- `script/checks/{run_check.js,device_behavior.js}`
- `START_CONTROL_CENTER.bat`, `STOP_CONTROL_CENTER.bat`

## Assignment modes

- `all`: mọi browser × mọi scenario
- `pair`: ghép browser/scenario theo thứ tự, quay vòng khi cần
- `random`: mỗi browser nhận ngẫu nhiên 1 scenario đã chọn
- `manual`: tự gán 1 scenario cho từng browser

Scenario recorder gốc vẫn deterministic; random assignment chỉ chọn scenario, không thay đổi nội dung scenario.

## Agent Mode engineering state

Agent Runtime / one-action execution has closed the scoped 35-action functional matrix. A5 post-action control is now available as separate, bounded contracts:

```text
one semantic action
→ settled observe after
→ A5.1 Goal Checker
→ A5.2 Outcome Controller
→ A5.3 Episode Budget Guard
```

Relevant files:

```text
GOAL_CHECKER_CONTRACT.json
OUTCOME_CONTROL_CONTRACT.json
EPISODE_BUDGET_CONTRACT.json
manager/goal/goal_checker.js
manager/goal/outcome_controller.js
manager/goal/episode_budget.js
```

A5.1/A5.2 have controlled native PASS evidence and A5.3 has contract/budget PASS evidence. The next milestone is **A5.4 explicit one-step replan orchestration**. Autonomous multi-step remains disabled/not started.

Experimental Browser UI/OS control and `targetTracking=follow-live` remain isolated on `feat/agent-tab-context`; they are not ordinary `main` Runtime execution.

See repository `STATUS.md` and `docs/A5_NATIVE_VALIDATION_2026-08-26.md` for current evidence and boundaries.

## Chạy

```bat
npm install
START_CONTROL_CENTER.bat
```

Dashboard: `http://127.0.0.1:8788`
