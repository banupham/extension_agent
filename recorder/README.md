# Browser Action Recorder V3.7 Recorded Click

## Mục tiêu

Scenario gốc phải deterministic: ghi thế nào thì phát lại đúng mục tiêu và đúng điểm click tương đối trong element.

## Click

Recorder không còn xuất `clickFirstMatch + offset` cho click đã ghi.

Nó xuất:

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

`rx/ry` là vị trí click tương đối bên trong element.

Khi replay, executor:
1. tìm element;
2. lấy rect hiện tại;
3. tính lại x/y từ rx/ry;
4. click đúng điểm đó;
5. không thêm offset/random point.

Recorder ưu tiên clickable ancestor (`a`, `button`, role button/link...) thay vì node con mà con trỏ vô tình chạm vào.

Các ID có dấu hiệu generated/dynamic sẽ không được ưu tiên làm selector.

## Scroll

DOM `scroll` event được debounce 420 ms. Exporter cũng gộp các `scrollTo` liên tiếp và chỉ giữ đích cuối của cùng burst.

## Text / keyboard

Giữ nguyên semantic mode:
- sửa/xóa text trong field -> một `replaceText` cuối;
- Backspace/Delete ngoài text field -> `pressKey`;
- popup: Start / Stop / Export .js.
