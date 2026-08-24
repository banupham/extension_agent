# STATUS — 2026-08-25

## Extension runtime — restored

`control-center/extension/stealth-extension/` is no longer missing its service-worker runtime.

Current runtime layout:

```text
control-center/extension/stealth-extension/
├─ manifest.json
├─ background.js
├─ core.js
├─ input.js
├─ recorded_click.js
├─ actions.js
└─ runtime.js
```

`background.js` is now a small loader using `importScripts(...)`; the runtime is split into maintainable modules instead of one large file.

A GitHub Actions workflow was added at:

```text
.github/workflows/extension-syntax.yml
```

It runs `node --check` for every extension JavaScript runtime file on push/PR.

The obsolete `PUSH_IN_PROGRESS.md` and `README_RUNTIME_MISSING.md` markers were removed.

## Source of truth

Từ V3.10 trở đi ưu tiên repo GitHub này làm source chính. Không yêu cầu tải ZIP thủ công nếu thay đổi đã được commit lên repo.

Workflow người dùng:

```bat
git pull
cd control-center
npm install
START_CONTROL_CENTER.bat
```

`START_CONTROL_CENTER.bat` ưu tiên mẫu ngắn đã chốt:

```bat
@echo off
cd /d "%~dp0"
call STOP_CONTROL_CENTER.bat >nul 2>&1
timeout /t 1 /nobreak >nul
start "Browser Debug Agent Control Center V3.10" /min node manager\control_center.js
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:8788
```

## Control Center V3.10 — Browser ↔ Scenario Assignment

Yêu cầu mới: không chỉ chạy mọi scenario trên mọi browser. Cần chọn cách phân công scenario cho browser.

Các mode:

- `all`: mọi browser × mọi scenario.
- `pair`: Chrome 1 → scenario A, Chrome 2 → scenario B, sau đó quay vòng.
- `random`: mỗi browser nhận ngẫu nhiên đúng 1 scenario trong tập đã tick.
- `manual`: tự chọn scenario cho từng browser.

Cách phân công độc lập với cách thực thi:

- `parallel`: browser khác nhau chạy song song.
- `sequential`: toàn bộ task chạy lần lượt.

Logic thuần đã commit tại:

```text
control-center/manager/assignment.js
```

Tài liệu:

```text
docs/ASSIGNMENT_MODES.md
```

Random trong `assignmentMode=random` chỉ chọn **scenario nào giao cho browser nào**; không chỉnh nội dung scenario. Scenario Recorder vẫn deterministic.

## Control Center V3.9 — Recorded Click

Kế thừa fix queue/log V3.8 và thêm replay click deterministic.

### `clickRecorded`

Recorder lưu:

```js
{
  action: "clickRecorded",
  selectors: ["..."],
  texts: ["..."],
  point: { rx: 0.72, ry: 0.41 },
  fallback: {
    clientX: 481,
    clientY: 327,
    viewportWidth: 681,
    viewportHeight: 640
  }
}
```

Executor tìm lại element và tính:

```text
x = rect.left + rect.width  * rx
y = rect.top  + rect.height * ry
```

Không random click offset cho scenario gốc.

## Recorder V3.7 — Recorded Click

- Click gắn vào clickable ancestor (`a`, `button`, role button/link...).
- Lưu `clientX/clientY`, viewport và `rx/ry`.
- Không ưu tiên ID có dấu hiệu generated/dynamic.
- Anchor có `href` duy nhất được thêm làm selector candidate.
- Scroll debounce 420 ms và exporter gộp `scrollTo` liên tiếp.
- Sửa text trong field → một `replaceText` cuối.
- Backspace/Delete ngoài field → `pressKey`.
- Navigation classifier nhận cả `click` và `clickRecorded`, tránh `openUrl` dư.

## Runs & logs V3.8/V3.9

Nguyên nhân gốc đã fix là `saveState()` từng thay live run object bằng clone. Worker cập nhật object cũ trong khi UI đọc clone `queued`.

Fix: giữ object identity trong RAM, chỉ clone khi serialize JSON.

Smoke tests đã pass:

1. 1 browser + 1 scenario / parallel → `done 14/14`.
2. 1 browser + 2 scenario / sequential → cả hai `done 14/14`.

## Việc tiếp theo

- [ ] Tích hợp `buildAssignmentTasks()` vào runtime `manager/control_center.js` trên repo.
- [ ] Commit UI V3.10: dropdown `Phân công` + `Thực thi` + manual mapping per browser.
- [ ] Test 2 browser + 2 scenario với `pair`.
- [ ] Test 3 browser + 2 scenario với `random`.
- [ ] Test manual assignment và scheduler giữ nguyên mapping.
- [ ] Tiếp tục test `clickRecorded` với element lớn/lệch tâm.

## Không làm

Không tối ưu theo feedback của bot detector hoặc thêm cơ chế nhằm né anti-bot detection. Các sửa đổi tập trung vào deterministic replay, correctness, scheduling, queue reliability và observability.
