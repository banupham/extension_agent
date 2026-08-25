# Browser Action Recorder V3.9 Gesture Metrics

## Mục tiêu

Scenario gốc vẫn deterministic, nhưng Recorder giữ dữ liệu đủ chi tiết để phân tích và sinh variant sau này mà không phải đoán lại hành vi gốc.

## Exact waits

Khoảng nghỉ không còn bị clamp ở 5000 ms. Khoảng nghỉ từ 1200 ms trở lên được xuất thành action `wait` riêng; khoảng ngắn hơn vẫn nằm trong `delay` của action kế tiếp.

Navigation do click/Enter tạo ra không reset timing anchor, nên thời gian load/chờ sau thao tác vẫn được giữ.

## Click / pointer

`clickRecorded` vẫn replay theo `rx/ry` trong element và không thêm random offset vào scenario gốc.

Recorder lưu thêm `pointerGesture`: thời điểm pointerdown/pointerup, duration, pointer type, button, điểm bắt đầu/kết thúc và pressure khi trình duyệt cung cấp.

## Text / keyboard

Semantic mode vẫn giữ nguyên:
- sửa/xóa trong field -> một `replaceText` cuối;
- `editTrace.changes` giữ timeline chỉnh sửa gồm timestamp, inputType, value và selection;
- Backspace/Delete trong editable không được replay hai lần;
- Backspace/Delete ngoài editable vẫn là `pressKey`.

## Scroll / swipe gesture metrics

Một gesture scroll được gom cho đến khi trang ngừng scroll khoảng 420 ms. Mỗi gesture vẫn là một `scrollTo` deterministic, nhưng metadata hiện lưu cả quỹ đạo và raw wheel input.

`scrollTrace` gồm:

```js
{
  startedAtMs,
  endedAtMs,
  durationMs,
  samples: [
    { t, x, y }
  ],
  wheelSamples: [
    {
      t,
      deltaX,
      deltaY,
      deltaZ,
      deltaMode,
      clientX,
      clientY,
      ctrlKey,
      shiftKey,
      altKey,
      metaKey
    }
  ],
  metrics: {
    start: { x, y },
    end: { x, y },
    displacementX,
    displacementY,
    straightDistancePx,
    pathDistancePx,
    averageSpeedPxPerSec,
    peakSpeedPxPerSec,
    direction,
    sourceHint,
    sampleCount,
    wheelSampleCount,
    wheelTotalDeltaX,
    wheelTotalDeltaY,
    speedSamples: [
      { t, speedPxPerSec, distancePx, dtMs }
    ]
  }
}
```

### Ý nghĩa

- `durationMs`: thời gian trang thực sự di chuyển trong gesture.
- `displacementX/Y`: độ dịch chuyển từ đầu đến cuối.
- `straightDistancePx`: khoảng cách thẳng giữa điểm đầu/cuối.
- `pathDistancePx`: tổng quãng đường thực qua các sample.
- `averageSpeedPxPerSec`: tốc độ trung bình của viewport.
- `peakSpeedPxPerSec`: tốc độ lớn nhất đo được giữa hai sample liên tiếp.
- `direction`: up/down/left/right.
- `wheelSamples`: delta gốc từ `wheel` event để phân tích profile input.

`sourceHint` cố ý chỉ là hint. Browser không cung cấp cách đáng tin cậy để luôn phân biệt mouse wheel và touchpad. Recorder dùng các nhãn bảo thủ như `touch`, `wheel-pixel`, `wheel-line`, `wheel-page`, `pointer-scroll-or-scrollbar`, `unknown` thay vì gán nhãn chắc chắn sai.

## Variant-ready data

V3.9 có đủ dữ liệu để generator sau này thay đổi có kiểm soát:
- idle/transition delay;
- scroll duration;
- distance;
- average/peak speed;
- speed profile theo sample;
- wheel delta profile;
- direction;
- click hold duration;
- text edit cadence.

Scenario gốc không sử dụng metadata này để random. Metadata chỉ phục vụ diagnostics và Scenario Variants.

## Popup / export

Popup vẫn chỉ có 3 nút Start / Stop / Export .js và vẫn nhớ thư mục export đã chọn bằng File System Access API + IndexedDB.
