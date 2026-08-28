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

## Agent Mode — trạng thái sau hợp nhất main

Agent production trên `main` hiện có đầy đủ các khối đã được xác nhận trước khi hợp nhất:

```text
Task / Mission
→ semantic mission + goal resolution
→ learned Strategy / recovery / self-experience
→ 35-action Agent Action Contract
→ Behavior policy
→ PAGE_CDP hoặc BROWSER_NATIVE
→ observe-after
→ Goal Checker / Semantic Effect / Outcome Controller
→ Episode Budget / bounded replan
```

Các năng lực đã nằm trong cơ thể Agent trên `main` gồm:

- semantic Strategy + model loading/training pipeline;
- mission/subgoal, world state, recovery và bounded replan;
- pointer/keyboard/scroll/form/media semantic actions;
- target tracking `follow-live` cho mục tiêu di chuyển;
- browser-native `switchTab`, `openNewTab`, `closeTab` với semantic tab targeting;
- Goal Checker, semantic effect evaluation và outcome feedback;
- continuous-learning pipeline có privacy/noise filtering và explicit human approval.

## Execution surface boundary

`main` chỉ cho phép hai execution surface:

```text
PAGE_CDP
BROWSER_NATIVE
```

Subsystem sau **cố ý ở ngoài cơ thể Agent production**:

```text
Browser UI / OS Control
→ Windows UI Automation
→ Win32 SendInput
→ physical Windows pointer/keyboard ownership
→ browser chrome/tab-strip UI
```

Các probe/spike của subsystem này được giữ trên branch `feat/agent-tab-context` làm bằng chứng thử nghiệm, nhưng `main` không có route execution `browser-ui-os` và không chứa các spike executable của nó.

Xem:

- `docs/MAIN_INTEGRATION_2026-08-28.md`
- `docs/AGENT_EXECUTION_SURFACES.md`
- `docs/TAB_LIFECYCLE_AGENT_INTEGRATION_2026-08-28.md`
- repository `STATUS.md`

## Chạy

```bat
npm install
START_CONTROL_CENTER.bat
```

Dashboard: `http://127.0.0.1:8788`
