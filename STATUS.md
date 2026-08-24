# STATUS — 2026-08-25

## Source of truth

GitHub `banupham/extension_agent` là source chính. Không dùng ZIP làm source phát triển nữa.

```bat
git pull
cd control-center
npm install
START_CONTROL_CENTER.bat
```

`START_CONTROL_CENTER.bat` giữ mẫu ngắn đã chốt và chỉ đổi version title khi cần.

## Baseline rebuild

Cấu trúc/runtime được rebuild từ hai package cũ đã xác nhận ổn:

- `browser_debug_agent_control_center_v3_8_observable.zip`
- `browser_action_recorder_v3_6_keyboard_semantic.zip`

Sau đó áp lại toàn bộ thay đổi mới hơn từ lịch sử phát triển.

## Cấu trúc chuẩn

```text
control-center/
├─ ACTION_CONTRACT.json
├─ package.json
├─ START_CONTROL_CENTER.bat
├─ STOP_CONTROL_CENTER.bat
├─ server/server.js
├─ manager/control_center.js
├─ manager/public/{index.html,app.js,style.css}
├─ extension/stealth-extension/{manifest.json,background.js}
└─ script/checks/{run_check.js,device_behavior.js}

recorder/
├─ ACTION_CONTRACT.json
├─ README.md
├─ background.js
├─ content.js
├─ manifest.json
├─ popup.html
└─ popup.js
```

Stealth Executor giữ layout monolithic `manifest.json + background.js` như package cũ.

## Control Center V3.10

### Queue / Runs & Logs

- `saveState()` không thay live run object bằng clone; clone chỉ dùng khi serialize JSON.
- Có diagnostics theo run, worker queue, watchdog và finalize ngay khi runner phát `summary`.
- Run `queued/running` còn sót sau restart được đánh dấu `interrupted`.

### Browser ↔ Scenario assignment

Assignment và execution là hai lớp độc lập.

Assignment:
- `all`: mọi browser × mọi scenario.
- `pair`: browser 1 → scenario A, browser 2 → scenario B, quay vòng nếu lệch số lượng.
- `random`: mỗi browser nhận ngẫu nhiên 1 scenario đã chọn.
- `manual`: tự chọn scenario cho từng browser.

Execution:
- `parallel`: browser khác nhau chạy song song.
- `sequential`: toàn bộ task chạy lần lượt.

Scheduler và `/api/v1/run` truyền `assignmentMode` + `assignments`.

## Executor / action contract

Executor + `run_check.js` phải đồng bộ các nhóm action:

- Navigation: `openUrl`, `reload`, `goBack`, `goForward`, `waitForUrl`.
- Pointer: `click`, `clickSelector`, `clickFirstMatch`, `clickRecorded`, `doubleClickSelector`, `hoverSelector`, `moveMouse`, `dragAndDrop`, `scroll`, `scrollTo`, `scrollBy`.
- Keyboard: `type`, `replaceText`, `clearInput`, `pressKey`, `keyCombo`.
- Form: `focusSelector`, `selectOption`, `setChecked`.
- Wait: `wait`, `waitForSelector`, `waitForUrl`.
- Inspection/lifecycle: `getElementPosition`, `getActiveTab`, `getElementText`, `getPageInfo`, `listTabs`, `getCapabilities`, `detach`.

Keyboard giữ mapping physical-key đã sửa; Backspace = VK 8, Shift modifier bit = 8, `keyUp` không gửi text.

## Deterministic clickRecorded

Scenario gốc không random điểm click.

Recorder lưu selectors/text, `rx/ry`, fallback viewport. Executor tìm lại element và tính:

```text
x = rect.left + rect.width  * rx
y = rect.top  + rect.height * ry
```

## Recorder V3.8 Rich Timing — hiện tại

Mục tiêu của V3.8 là giữ replay deterministic nhưng không làm mất dữ liệu cần cho timing/variant generator.

### Exact waits

V3.7 có lỗi exporter clamp khoảng cách giữa event vào tối đa 5000 ms. V3.8 bỏ clamp này.

- Gap >= 1200 ms được xuất thành action `wait` riêng với đúng số ms đã ghi.
- Gap ngắn hơn giữ ở `delay` action kế tiếp.
- Navigation do click/Enter tạo ra không làm reset timing anchor; vì vậy thời gian load/chờ sau click không bị mất.
- Scenario có `timing.recordedGapMs`, `timing.kind` và `timing.randomizable`.

### Rich metadata

Background gắn cho event:
- `seq`;
- `t`;
- `recordedAtEpoch`;
- `gapFromPreviousMs`;
- `pageUrl`.

Scenario có `recordingMeta` gồm recorder version, timing model, recording duration, source event count, exported action count và wait threshold.

### Click trace

`clickRecorded` vẫn deterministic theo `rx/ry`, đồng thời lưu `pointerGesture`:
- pointer type/button;
- pointerdown/start point;
- pointerup/end point;
- duration pointerdown → pointerup.

### Text edit trace

Semantic replay vẫn là một `replaceText` cuối để không replay Backspace/Delete hai lần.

Nhưng V3.8 giữ thêm `editTrace`:
- thời điểm bắt đầu/kết thúc edit;
- duration;
- từng input change;
- `inputType`;
- value/length;
- selectionStart/selectionEnd.

Dữ liệu này dùng cho variant generator sau này mà không làm scenario gốc mất tính deterministic.

### Scroll trace

Một DOM scroll burst vẫn debounce 420 ms để không tạo hàng chục action.

V3.8 **không gộp nhiều gesture scroll riêng biệt thành một `scrollTo` nữa**. Mỗi gesture giữ action riêng và có `scrollTrace.samples` gồm timestamp + x/y của gesture.

### Recorder UI/export

- Popup vẫn đúng 3 nút: Start / Stop / Export .js.
- Export vẫn nhớ thư mục qua File System Access API + IndexedDB.
- Recording gắn với tab và tiếp tục qua reload/navigation.

## GitHub CI

Workflow `.github/workflows/extension-syntax.yml` chạy `node --check` cho:

- executor `background.js`;
- manager/backend/UI;
- broker/server;
- `run_check.js`, `device_behavior.js`;
- Recorder `background.js`, `content.js`, `popup.js`.

## Test tiếp trên máy thật

- [ ] `git pull` và reload Recorder V3.8.
- [ ] Record: Start → chờ 8–10 giây → click. Scenario phải có `wait` khoảng 8–10 giây, không còn 5000 ms.
- [ ] Click → navigation → chờ trang load → action tiếp theo. Gap sau click phải còn đủ.
- [ ] Nhập text, Backspace, sửa text, Tab/blur. Replay chỉ dùng final `replaceText`, nhưng scenario phải có `recorded.editTrace`.
- [ ] Thực hiện hai scroll gesture riêng. Scenario phải có hai `scrollTo` riêng, mỗi action có `recorded.scrollTrace`.
- [ ] Click lệch tâm. Replay phải tiếp tục dùng đúng `rx/ry`.
- [ ] Sau khi xác nhận V3.8 ổn, nâng Scenario Variants để dùng `timing`, `pointerGesture`, `editTrace`, `scrollTrace` thay vì chỉ jitter `delay`.

## Phạm vi

Các thay đổi tập trung vào deterministic replay, correctness, timing fidelity, scenario richness, scheduling, queue reliability và observability.
