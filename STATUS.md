# STATUS — 2026-08-25

## Điểm bắt đầu cho phiên làm việc tiếp theo

Source chuẩn hiện tại nằm trong repo này. Không dùng các ZIP cũ làm nguồn chính nếu repo đã có commit mới hơn.

### Control Center V3.8

Đã sửa nguyên nhân gốc của `Runs & logs` bị treo ở **ĐANG CHỜ** dù browser thực tế đã chạy xong.

Nguyên nhân:

```js
state.runs = state.runs.map(r => ({ ...r }))
```

trong `saveState()` đã thay toàn bộ live run objects bằng clone mới. Worker tiếp tục cập nhật object cũ, trong khi UI đọc clone vẫn còn `queued`.

Fix:

- `saveState()` không thay `state.runs` nữa.
- Chỉ tạo bản clone khi serialize ra `state_v3.json`.
- Giữ nguyên object identity trong RAM suốt vòng đời run.

### Queue/worker

- Bỏ boolean worker flag dễ stale.
- Dùng `workerPromises: Map<agentId, Promise>` làm nguồn sự thật về worker đang hoạt động.
- Watchdog có diagnostic event nếu task queued không có worker.
- Mỗi run lưu tối đa 80 diagnostic events.
- Dashboard hiển thị diagnostic + stdout trong từng run card.
- Có thêm global `Manager diagnostics`.

### Smoke tests đã chạy

Fake extension agent qua broker thật:

1. **1 browser + 1 scenario / parallel**
   - plan: 14 steps
   - progress: 14/14
   - final status: `done`

2. **1 browser + 2 scenario / sequential**
   - run-1: `done 14/14`
   - run-2: `done 14/14`

### Keyboard

`Backspace` đã được map trong executor:

```text
key=Backspace
code=Backspace
VK=8
```

Các phím hỗ trợ được ghi trong `ACTION_CONTRACT.json` và `docs/KEYBOARD.md`.

Lưu ý: Recorder deterministic/semantic có thể không xuất `pressKey("Backspace")` khi Backspace chỉ dùng để sửa text trong field; nó có thể gộp thành giá trị cuối. Đây là hành vi Recorder, không phải executor thiếu mapping.

### Scroll

Contract hiện tại:

- `scrollTo`: vị trí tuyệt đối, Recorder dùng action này.
- `scrollBy`: delta tương đối.
- `scroll`: legacy compatibility.

Scroll dọc dùng wheel theo trục Y tại tọa độ cố định, không random điểm wheel. Randomness chỉ dành cho variant do người dùng chủ động tạo.

## Việc cần test trên máy Windows/GPM thực tế

- [ ] Reload Stealth Executor từ source V3.8.
- [ ] Start Control Center và kiểm tra badge `Manager v3.8`.
- [ ] Chạy 1 browser + 1 scenario; card phải chuyển `ĐANG CHẠY` rồi `HOÀN TẤT`.
- [ ] Nếu không chuyển, mở `Log chẩn đoán / stdout` và gửi chuỗi event cuối cùng.
- [ ] Kiểm tra scenario có `pressKey("Backspace")` ở trường hợp Backspace là action độc lập.
- [ ] Kiểm tra Recorder V3.5 export `scrollTo` và replay scroll dọc không giật.

## Không làm trong nhánh hiện tại

Không tối ưu theo feedback của bot detector hoặc thêm hành vi nhằm né anti-bot detection. Các sửa đổi tập trung vào correctness, deterministic replay, queue reliability và observability.
