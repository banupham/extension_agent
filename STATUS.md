# STATUS — 2026-08-25

## Source of truth

Từ V3.10 trở đi repo GitHub này là source chính. Không yêu cầu tải ZIP thủ công nếu thay đổi đã commit lên repo.

Workflow:

```bat
git pull
cd control-center
npm install
START_CONTROL_CENTER.bat
```

`START_CONTROL_CENTER.bat` giữ mẫu ngắn đã chốt:

```bat
@echo off
cd /d "%~dp0"
call STOP_CONTROL_CENTER.bat >nul 2>&1
timeout /t 1 /nobreak >nul
start "Browser Debug Agent Control Center V3.10" /min node manager\control_center.js
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:8788
```

## Legacy package structure restored

Hai ZIP chuẩn được dùng làm baseline cấu trúc:

- `browser_debug_agent_control_center_v3_8_observable.zip`
- `browser_action_recorder_v3_6_keyboard_semantic.zip`

Source mới giữ lại đầy đủ các vị trí runtime chính của hai package cũ, tránh tình trạng repo chỉ có manifest/placeholder nhưng thiếu file chạy thật.

### Control Center hiện phải có

```text
control-center/
├─ ACTION_CONTRACT.json
├─ package.json
├─ README.md
├─ START_CONTROL_CENTER.bat
├─ STOP_CONTROL_CENTER.bat
├─ server/
│  └─ server.js
├─ manager/
│  ├─ control_center.js
│  ├─ public/
│  │  ├─ index.html
│  │  ├─ app.js
│  │  └─ style.css
│  └─ variants/
├─ extension/
│  └─ stealth-extension/
│     ├─ manifest.json
│     ├─ background.js
│     ├─ core.js
│     ├─ input.js
│     ├─ recorded_click.js
│     ├─ actions.js
│     └─ runtime.js
└─ script/
   └─ checks/
      ├─ run_check.js
      └─ device_behavior.js
```

`background.js` hiện là loader dùng `importScripts(...)`; các module nằm cùng thư mục. Đây là layout mở rộng so với ZIP cũ nhưng vẫn giữ đúng entrypoint cũ `background.js`, nên GPM/Chrome load từ chính thư mục `stealth-extension`.

### Recorder hiện phải có

```text
recorder/
├─ ACTION_CONTRACT.json
├─ README.md
├─ background.js
├─ content.js
├─ manifest.json
├─ popup.html
└─ popup.js
```

## Control Center V3.10 — Browser ↔ Scenario Assignment

Đã tích hợp trực tiếp vào runtime `manager/control_center.js` và UI:

- `all`: mọi browser × mọi scenario.
- `pair`: Chrome 1 → scenario A, Chrome 2 → scenario B, quay vòng nếu số lượng lệch.
- `random`: mỗi browser nhận ngẫu nhiên đúng 1 scenario đã tick.
- `manual`: tự chọn scenario cho từng browser.

Phân công độc lập với thực thi:

- `parallel`: browser khác nhau chạy song song.
- `sequential`: toàn bộ task chạy lần lượt.

Scheduler và `/api/v1/run` cũng nhận `assignmentMode` + `assignments`.

## Control Center V3.9 — Recorded Click

`clickRecorded` replay theo tọa độ tương đối trong element:

```text
x = rect.left + rect.width  * rx
y = rect.top  + rect.height * ry
```

Scenario Recorder gốc không random click offset.

## Recorder V3.7 — Recorded Click

- Click gắn vào clickable ancestor (`a`, `button`, role button/link...).
- Lưu `clientX/clientY`, viewport và `rx/ry`.
- Không ưu tiên ID có dấu hiệu generated/dynamic.
- Anchor có `href` duy nhất được thêm làm selector candidate.
- Scroll debounce 420 ms; exporter gộp `scrollTo` liên tiếp.
- Sửa text trong field → một `replaceText` cuối.
- Backspace/Delete trong field được phản ánh qua final value; ngoài field → `pressKey`.
- Navigation classifier nhận cả `click` và `clickRecorded`.
- Popup chỉ có Start / Stop / Export .js.
- Export nhớ thư mục đã chọn khi File System Access API cho phép.

## Runs & logs

Nguyên nhân gốc đã fix: `saveState()` từng thay live run object bằng clone. Worker cập nhật object cũ trong khi UI đọc clone `queued`.

Fix hiện tại: giữ object identity trong RAM, chỉ clone khi serialize state. Runtime có diagnostic events + watchdog cho queue.

## Đã đồng bộ trong lượt hiện tại

- [x] Khôi phục `control-center/server/server.js`.
- [x] Khôi phục `control-center/manager/control_center.js`.
- [x] Khôi phục `control-center/manager/public/index.html`.
- [x] Khôi phục `control-center/manager/public/app.js`.
- [x] Khôi phục `control-center/manager/public/style.css`.
- [x] Khôi phục `control-center/script/checks/device_behavior.js`.
- [x] Xác nhận `run_check.js` có `clickRecorded`, `scrollTo`, `scrollBy`, progress/summary events.
- [x] Đồng bộ Recorder V3.7 gồm manifest, content, background, popup.html, popup.js, contract và README.
- [x] Đồng bộ package metadata và action contract V3.10.

## Việc cần test tiếp trên máy thật

- [ ] `git pull`, load `control-center/extension/stealth-extension` trong GPM và xác nhận agent ONLINE.
- [ ] Start Control Center và xác nhận dashboard V3.10 load đủ UI.
- [ ] Test 2 browser + 2 scenario với `pair`.
- [ ] Test 3 browser + 2 scenario với `random`.
- [ ] Test `manual` assignment + scheduler.
- [ ] Record mới bằng Recorder V3.7 và test `clickRecorded` trên element lớn/lệch tâm.

## Phạm vi

Các thay đổi tập trung vào deterministic replay, correctness, scheduling, queue reliability và observability; không tối ưu theo feedback của bot detector.
