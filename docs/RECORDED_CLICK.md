# Recorded Click Contract

## Mục tiêu

Scenario gốc do Recorder tạo phải phát lại đúng mục tiêu và đúng vị trí click tương đối trong element, thay vì tìm element rồi click gần tâm với offset ngẫu nhiên.

## Action

```js
{
  action: "clickRecorded",
  selectors: ["a[href=\"/watch?v=...\"]"],
  texts: ["youtube"],
  point: {
    rx: 0.72,
    ry: 0.41
  },
  fallback: {
    clientX: 481,
    clientY: 327,
    viewportWidth: 681,
    viewportHeight: 640
  },
  delay: 2579
}
```

`rx` và `ry` là tọa độ tương đối trong rect của element lúc record:

```text
rx = (clientX - rect.left) / rect.width
ry = (clientY - rect.top)  / rect.height
```

## Replay

Executor tìm lại element bằng selector/text rồi tính:

```text
x = rect.left + rect.width  * rx
y = rect.top  + rect.height * ry
```

`clickRecorded` không thêm random offset và không tự tạo random mouse path. Nó chỉ đưa pointer tới tọa độ tính được rồi gửi mousePressed/mouseReleased.

Nếu không tìm thấy target, fallback `clientX/clientY` chỉ được dùng khi viewport hiện tại gần giống viewport lúc record (sai khác tối đa khoảng 5% hoặc 12 px).

## Selector

Recorder V3.7:

- ưu tiên clickable ancestor (`a`, `button`, `input`, role button/link...);
- không ưu tiên ID có dấu hiệu generated/dynamic;
- thêm `href` duy nhất cho anchor;
- vẫn giữ nhiều selector candidates để replay có fallback.

## Scroll

Scroll recording dùng vị trí tuyệt đối `scrollTo`. DOM scroll events được debounce 420 ms và các `scrollTo` liên tiếp được gộp về đích cuối của cùng burst.

## Deterministic vs Variant

- Scenario do Recorder export: deterministic.
- Scenario Variant: nơi dành cho timing/random robustness variation.
