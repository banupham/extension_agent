# STATUS — 2026-08-25

## Điểm bắt đầu cho phiên làm việc tiếp theo

Source chuẩn hiện tại nằm trong repo này. Không dùng ZIP cũ làm nguồn chính nếu repo đã có commit mới hơn.

### Control Center V3.9 Recorded Click

Kế thừa toàn bộ fix queue/log của V3.8 và thêm replay click deterministic.

#### `clickRecorded`

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

Executor tìm lại element và tính lại điểm click:

```text
x = rect.left + rect.width  * rx
y = rect.top  + rect.height * ry
```

Không dùng random click offset và không tự tạo random mouse path cho `clickRecorded`.

Fallback tọa độ viewport chỉ dùng khi selector/text không tìm thấy và viewport hiện tại gần giống viewport đã record.

### Recorder V3.7 Recorded Click

- Click được gắn vào clickable ancestor (`a`, `button`, role button/link...) thay vì node con bất kỳ.
- Lưu `clientX/clientY`, viewport và `rx/ry` theo rect element.
- ID có dấu hiệu generated/dynamic không còn được ưu tiên làm selector.
- Anchor có `href` duy nhất được thêm làm candidate selector.
- Scroll event debounce 420 ms.
- Exporter gộp các `scrollTo` liên tiếp, giữ đích cuối của cùng burst.
- Text/Backspace semantic giữ nguyên: sửa text trong field -> một `replaceText` cuối; Backspace/Delete độc lập ngoài field -> `pressKey`.

### Runs & logs V3.8/V3.9

Nguyên nhân gốc đã fix:

```js
state.runs = state.runs.map(r => ({ ...r }))
```

trong `saveState()` từng thay live object bằng clone khiến worker cập nhật object cũ trong khi UI đọc clone `queued`.

Fix giữ object identity trong RAM và chỉ clone khi serialize ra JSON.

Smoke tests trước đó đã pass:

1. 1 browser + 1 scenario / parallel -> `done 14/14`.
2. 1 browser + 2 scenario / sequential -> cả hai `done 14/14`.

### Việc cần test trên Windows/GPM

- [ ] Reload Stealth Executor 1.5.0 từ Control Center V3.9.
- [ ] Reload Recorder V3.7.
- [ ] Record click vào element lớn (video/card/link) ở vị trí lệch tâm; scenario phải xuất `clickRecorded` với `rx/ry` khác 0.5.
- [ ] Replay và kiểm tra click đúng vùng tương đối đã record.
- [ ] Record Google/YouTube và kiểm tra selector không còn phụ thuộc ID động dạng opaque.
- [ ] Record một scroll gesture dài; scenario không được sinh nhiều `scrollTo` gần như trùng nhau.
- [ ] Nếu Runs & logs vẫn sai, gửi event cuối trong `Log chẩn đoán / stdout`.

## Không làm trong nhánh hiện tại

Không tối ưu theo feedback của bot detector hoặc thêm hành vi nhằm né anti-bot detection. Các sửa đổi tập trung vào correctness, deterministic replay, queue reliability và observability.
