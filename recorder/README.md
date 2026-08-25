# Browser Action Recorder V4.0 Detailed Input + Mouse Path

## Mục tiêu

Scenario gốc vẫn deterministic, nhưng Recorder giữ đủ dữ liệu gốc để replay sát thao tác và để Scenario Variants về sau có thể thay đổi timing/hành vi có kiểm soát.

## Exact waits

Khoảng nghỉ không bị clamp ở 5000 ms. Khoảng nghỉ từ 1200 ms trở lên được xuất thành action `wait` riêng; khoảng ngắn hơn nằm trong `delay` của action kế tiếp.

Navigation do click/Enter tạo ra không reset timing anchor, nên thời gian load/chờ sau thao tác vẫn được giữ.

## Click + mouse path

`clickRecorded` vẫn replay theo `rx/ry` trong element và không thêm random offset vào scenario gốc.

Recorder lưu `pointerGesture` gồm pointerdown/pointerup, thời gian giữ, pointer type, button và điểm đầu/cuối.

V4.0 lưu thêm đường di chuyển chuột trước click:

```js
mousePath: {
  samples: [
    { t, x, y, buttons }
  ],
  metrics: {
    startedAtMs,
    endedAtMs,
    durationMs,
    start: { x, y },
    end: { x, y },
    displacementX,
    displacementY,
    straightDistancePx,
    pathDistancePx,
    averageSpeedPxPerSec,
    peakSpeedPxPerSec,
    sampleCount,
    speedSamples: [
      { t, speedPxPerSec, distancePx, dtMs }
    ]
  }
}
```

Mouse samples được giữ trong cửa sổ gần click để tránh file scenario phình quá lớn.

## Text / keyboard — Detailed Input

V4.0 không còn mặc định biến cả phiên sửa input thành một `replaceText`.

Khi chuỗi chỉnh sửa có thể tái dựng chắc chắn từ bàn phím, Recorder lưu `textEditRecorded` với từng operation thực:

```js
editTrace: {
  initialValue: "abc",
  finalValue: "abxy",
  operations: [
    { kind: "type", text: "d", t: 1200 },
    { kind: "pressKey", key: "Backspace", t: 1390 },
    { kind: "pressKey", key: "Backspace", t: 1510 },
    { kind: "type", text: "x", t: 1650 },
    { kind: "type", text: "y", t: 1760 }
  ],
  summary: {
    backspaceCount: 2,
    deleteCount: 0,
    typedCharCount: 3,
    keyComboCount: 0,
    operationCount: 5
  }
}
```

Exporter biến chuỗi đó thành action thật:

```js
{ action: "type", text: "d", delay: ... }
{ action: "pressKey", key: "Backspace", delay: ... }
{ action: "pressKey", key: "Backspace", delay: ... }
{ action: "type", text: "x", delay: ... }
{ action: "type", text: "y", delay: ... }
```

Vì vậy số lần Backspace/Delete được replay đúng theo thao tác đã ghi thay vì chỉ áp final value.

Recorder vẫn giữ `initialValue`, `finalValue`, `changes[]`, selection/caret và timing để kiểm tra lại kết quả.

### Khi nào vẫn dùng replaceText

`replaceText` chỉ là fallback khi không thể suy ra chắc chắn chuỗi phím, ví dụ:

- paste;
- drag/drop text;
- IME/composition;
- browser autofill/replacement;
- undo/redo;
- thay đổi DOM/input không khớp chuỗi keyboard operation.

Metadata ghi rõ `reconstruction.mode` và `uncertainReasons` để biết vì sao fallback.

## Keyboard ngoài input

Recorder vẫn ghi `pressKey` và `keyCombo`, kèm `key`, `code`, `location`, modifier và repeat.

## Scroll / swipe gesture metrics

Một gesture scroll được gom đến khi trang ngừng scroll khoảng 420 ms. Scenario gốc vẫn dùng `scrollTo`, nhưng metadata giữ cả quỹ đạo viewport và raw wheel input.

`scrollTrace.metrics` gồm duration, displacement, straight/path distance, average/peak speed, direction, sourceHint, wheel totals và speed samples.

`sourceHint` chỉ là hint; Recorder không khẳng định mouse wheel hay touchpad khi browser không cung cấp đủ tín hiệu chắc chắn.

## Variant-ready data

V4.0 hiện giữ dữ liệu cho:

- idle/transition delay;
- mouse path duration/distance/speed;
- click hold duration;
- từng phím gõ/xóa và số lần Backspace/Delete;
- cadence giữa các keyboard operation;
- text initial/final state;
- scroll duration/distance/average speed/peak speed;
- wheel delta profile và speed profile.

Scenario gốc không tự random các metadata này. Chúng dành cho diagnostics và Scenario Variants.

## Popup / export

Popup vẫn chỉ có 3 nút Start / Stop / Export .js và vẫn nhớ thư mục export bằng File System Access API + IndexedDB.
