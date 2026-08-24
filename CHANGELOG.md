# CHANGELOG

## V3.10 — Browser ↔ Scenario Assignment

- Chuyển workflow phát hành sang GitHub-first; ưu tiên `git pull`, không yêu cầu tải ZIP thủ công.
- `START_CONTROL_CENTER.bat` dùng mẫu launcher ngắn đã thống nhất.
- Thêm `STOP_CONTROL_CENTER.bat`.
- Thêm module `control-center/manager/assignment.js`.
- Bổ sung 4 assignment mode:
  - `all`: mọi browser × mọi scenario;
  - `pair`: ghép browser/scenario theo thứ tự và quay vòng;
  - `random`: mỗi browser nhận ngẫu nhiên 1 scenario;
  - `manual`: tự gán scenario cho từng browser.
- Tách assignment khỏi execution mode (`parallel` / `sequential`).
- Random assignment chỉ chọn scenario, không thay đổi nội dung deterministic scenario.
- Thêm `docs/ASSIGNMENT_MODES.md`.

## V3.9 — Recorded Click

- Thêm action `clickRecorded`.
- Recorder lưu `rx/ry` tương đối trong element cùng fallback viewport.
- Executor tính lại điểm click từ rect hiện tại, không random click offset.
- Recorder ưu tiên clickable ancestor và tránh ID có dấu hiệu generated/dynamic.
- Thêm anchor `href` unique làm selector candidate.
- Coalesce scroll gesture/burst.
- Sửa navigation classifier để nhận cả `click` và `clickRecorded`.

## V3.8 — Observable Queue Fix

- Tìm ra root cause Runs & logs đứng `queued`: `saveState()` từng clone và thay live run object trong RAM.
- Giữ object identity trong RAM, chỉ clone khi serialize JSON.
- Thêm diagnostic lifecycle cho run.
- Smoke test:
  - 1 browser + 1 scenario / parallel → done;
  - 1 browser + 2 scenario / sequential → cả hai done.

## Recorder V3.6/V3.7

- Keyboard semantic: Backspace/Delete trong text field được gộp vào final-value `replaceText`; ngoài field vẫn là `pressKey`.
- Recorded click deterministic.
- Scroll debounce và coalescing.
- Popup giữ 3 nút Start / Stop / Export .js.
