# Agent Runtime Extension V0.1

Extension riêng cho goal-directed Agent runtime.

## Boundary

Agent Runtime là **act/observe runtime**, không thu human training dataset.

Luồng chuẩn:

```text
Task
-> Observer
-> Strategy / Planner
-> Normalized Action Contract
-> CDP Executor
-> Chrome
-> Observation mới
-> Goal Checker
```

V0.1 mới là skeleton độc lập, chưa thay `stealth-extension` hiện tại.

## CDP backbone

V0.1 hỗ trợ sơ bộ:
- attach/detach active tab bằng `chrome.debugger`;
- semantic observation bằng `Runtime.evaluate`;
- `openUrl` -> `Page.navigate`;
- `pressKey` -> `Input.dispatchKeyEvent`;
- `type` -> `Input.insertText`.

Các action còn lại sẽ được map từ Action Contract hiện có sau khi Observer/Strategy contract ổn định.

## Nguyên tắc

Strategy không sinh raw CDP command. Strategy sinh normalized action; Runtime Extension chịu trách nhiệm chuyển action thành CDP.
