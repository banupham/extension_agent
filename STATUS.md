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

## Baseline được dùng để rebuild

Không dùng code GitHub bị lệch làm gốc. Hai ZIP cũ được dùng làm baseline cấu trúc/runtime:

- `browser_debug_agent_control_center_v3_8_observable.zip`
- `browser_action_recorder_v3_6_keyboard_semantic.zip`

Sau đó áp lại các thay đổi mới nhất từ lịch sử phát triển lên baseline này.

## Cấu trúc chuẩn hiện tại

### Control Center

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
│     └─ background.js
└─ script/
   └─ checks/
      ├─ run_check.js
      └─ device_behavior.js
```

Stealth Executor đã quay lại đúng layout cũ: `manifest.json + background.js` monolithic. Các module tách thử nghiệm `core.js`, `input.js`, `actions.js`, `recorded_click.js`, `runtime.js` đã xóa để tránh lệch source/runtime.

### Recorder

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

## Các tối ưu bắt buộc phải giữ

### Runs & Logs / queue

- `saveState()` không được thay live run object bằng clone; chỉ clone khi serialize ra JSON.
- Có diagnostic events theo run: `run_created`, enqueue, worker start/dequeue, child spawn, plan/progress/summary, finalize, child exit.
- Queue theo browser dùng worker state có thể recover/watchdog; sequential queue độc lập.
- Khi runner nhận `summary`, UI chốt `done/failed` ngay, không chờ wrapper Node treo.
- Run `queued/running` còn sót sau restart được đánh dấu `interrupted`.

### Action contract / executor

Executor + `run_check.js` hỗ trợ đồng bộ:

- Navigation: `openUrl`, `reload`, `goBack`, `goForward`, `waitForUrl`.
- Pointer: `click`, `clickSelector`, `clickFirstMatch`, `clickRecorded`, `doubleClickSelector`, `hoverSelector`, `moveMouse`, `dragAndDrop`, `scroll`, `scrollTo`, `scrollBy`.
- Keyboard: `type`, `replaceText`, `clearInput`, `pressKey`, `keyCombo`.
- Form: `focusSelector`, `selectOption`, `setChecked`.
- Inspection/lifecycle: `getElementPosition`, `getActiveTab`, `getElementText`, `getPageInfo`, `listTabs`, `getCapabilities`, `detach`.

Keyboard giữ mapping chuẩn đã sửa: digit dùng `DigitN`, punctuation theo physical key US, Shift modifier bit = `8`, `keyUp` không gửi `text`; Backspace = VK 8.

### Deterministic recorded scenario

Scenario gốc từ Recorder phải phát lại cứng; random chỉ thuộc Scenario Variants.

`clickRecorded` lưu:

```js
{
  selectors: [...],
  texts: [...],
  point: { rx, ry },
  fallback: { clientX, clientY, viewportWidth, viewportHeight }
}
```

Executor tìm lại element và tính:

```text
x = rect.left + rect.width  * rx
y = rect.top  + rect.height * ry
```

Không thêm random offset hoặc random mouse path cho `clickRecorded`.

### Scroll

- Recorder debounce scroll ~420 ms và xuất vị trí tuyệt đối `scrollTo`.
- Các snapshot scroll liên tiếp được gộp về đích cuối.
- Scroll dọc replay bằng CDP `mouseWheel` ở tọa độ cố định, `deltaX = 0`, không jitter/random destination.
- Horizontal/mixed scroll mới dùng cả X/Y; vẫn giữ đích scenario chính xác.

### Recorder semantic

- Phiên ghi gắn với tab và tiếp tục qua reload/navigation.
- Document mới gọi `contentReady` để khôi phục trạng thái recording.
- Sửa/gõ/xóa trong input được gộp thành một `replaceText` final value.
- Backspace/Delete trong editable không xuất thêm `pressKey`; ngoài editable vẫn ghi phím riêng.
- Click ưu tiên clickable ancestor; loại ID có dấu hiệu dynamic; ưu tiên semantic attrs và unique href.
- Popup chỉ có 3 nút: Start / Stop / Export .js.
- Export nhớ thư mục bằng File System Access API + IndexedDB; chỉ hỏi lại khi quyền không còn hợp lệ.

## Yêu cầu mới nhất — Browser ↔ Scenario assignment

Phân công và cách thực thi là hai lớp độc lập.

Assignment modes:

- `all`: mọi browser × mọi scenario.
- `pair`: Chrome 1 → scenario A, Chrome 2 → scenario B; quay vòng nếu số lượng lệch.
- `random`: mỗi browser nhận ngẫu nhiên đúng 1 scenario đã tick.
- `manual`: dropdown chọn scenario riêng cho từng browser.

Execution modes:

- `parallel`: browser khác nhau chạy song song.
- `sequential`: toàn bộ task chạy lần lượt.

Scheduler và `/api/v1/run` phải truyền `assignmentMode` + `assignments`.

## Đã sửa trong lượt rebuild này

- [x] Đối chiếu lại baseline V3.8/V3.6 thay vì tiếp tục vá code GitHub bị lệch.
- [x] Khôi phục Recorder V3.7: tab persistence, semantic input, clickRecorded, scroll coalesce, remembered export directory.
- [x] Khôi phục Stealth Executor thành `background.js` monolithic và xóa các module split thử nghiệm.
- [x] Khôi phục action mapping gồm Backspace, keyCombo, clickRecorded, scrollTo/scrollBy.
- [x] Giữ Runs & Logs root fix và assignment modes trong `manager/control_center.js`.
- [x] Giữ START_CONTROL_CENTER.bat đúng mẫu đã chốt.
- [x] Cập nhật GitHub Actions syntax check theo cấu trúc mới.

## Test tiếp trên máy thật

- [ ] `git pull` rồi reload Stealth Executor từ `control-center/extension/stealth-extension`.
- [ ] Reload Recorder từ `recorder/`.
- [ ] Xác nhận agent ONLINE và active tab/URL cập nhật khi đổi tab/navigation.
- [ ] Test 1 browser + 1 scenario: Runs & Logs phải `queued → running → done`.
- [ ] Test 2 browser + 2 scenario với `pair`.
- [ ] Test 3 browser + 2 scenario với `random`.
- [ ] Test `manual` assignment.
- [ ] Record scenario mới, kiểm tra click lệch tâm replay đúng `rx/ry`.
- [ ] Test sửa text bằng Backspace rồi replay chỉ có final `replaceText`.
- [ ] Test scroll dọc dài không còn giật lên/xuống do snapshot/delta contract.

## Phạm vi

Các thay đổi tập trung vào deterministic replay, correctness, scheduling, queue reliability và observability; không tối ưu theo feedback của bot detector.
