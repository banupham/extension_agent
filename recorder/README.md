# Browser Action Recorder V3.8 Rich Timing

## Mục tiêu

Scenario gốc vẫn deterministic, nhưng Recorder không còn nén mất dữ liệu thời gian và hành vi cần thiết cho bước tạo variant sau này.

## Exact waits

V3.7 từng clamp khoảng cách giữa hai event vào tối đa 5000 ms. V3.8 bỏ giới hạn này.

Khoảng nghỉ từ 1200 ms trở lên được xuất thành action riêng:

```js
{
  action: "wait",
  ms: 8420,
  delay: 0,
  timing: {
    recordedGapMs: 8420,
    kind: "idle",
    randomizable: true
  }
}
```

Các khoảng ngắn hơn vẫn được giữ ở `delay` của action kế tiếp.

Navigation do click/Enter tạo ra không còn làm reset timing anchor, vì vậy thời gian load/chờ sau click không bị mất.

## Rich action metadata

Mỗi action có thêm `timing` và `recorded`. Executor hiện tại có thể bỏ qua các field này; chúng dành cho diagnostics và variant generator.

`recorded` có thể chứa:
- `seq`, `atMs`, `gapFromPreviousMs`, `pageUrl`;
- target tag/text/selectors/rect/attributes;
- `pointerGesture` cho click;
- `editTrace` cho nhập/sửa text;
- `scrollTrace` cho từng scroll gesture;
- keyboard code/modifier metadata.

## Click

`clickRecorded` vẫn replay theo điểm tương đối `rx/ry` trong element, không thêm random offset vào scenario gốc.

Click còn lưu thời gian `pointerdown -> pointerup` và điểm bắt đầu/kết thúc để sau này có thể tạo variant click có kiểm soát.

## Text / keyboard

Semantic mode vẫn giữ nguyên:
- sửa/xóa trong field -> một `replaceText` cuối để replay không bị áp dụng Backspace/Delete hai lần;
- nhưng toàn bộ chuỗi edit được giữ trong `editTrace.changes` gồm timestamp, `inputType`, value, selectionStart/End;
- Backspace/Delete ngoài field vẫn là `pressKey`.

## Scroll

DOM scroll vẫn debounce 420 ms để một gesture không sinh hàng chục action.

Khác V3.7, exporter không gộp nhiều gesture `scrollTo` liên tiếp nữa. Mỗi gesture giữ action riêng và kèm `scrollTrace.samples` để variant generator có thể thay tốc độ/độ dài gesture sau này.

## Recording metadata

Scenario export có thêm `recordingMeta` gồm Recorder version, timing model, duration, source event count, exported action count và idle wait threshold.

Popup vẫn chỉ có 3 nút: Start / Stop / Export .js, và vẫn nhớ thư mục export đã chọn.
