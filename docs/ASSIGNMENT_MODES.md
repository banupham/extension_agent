# V3.10 — Browser ↔ Scenario Assignment

Control Center tách 2 khái niệm độc lập:

## 1. Phân công scenario

### `all` — Mọi browser × mọi scenario

Ví dụ 2 browser + 2 scenario:

```text
Chrome 1 → A
Chrome 1 → B
Chrome 2 → A
Chrome 2 → B
```

Đây là hành vi cũ.

### `pair` — Ghép theo thứ tự

```text
Chrome 1 → A
Chrome 2 → B
Chrome 3 → A
Chrome 4 → B
```

Nếu số browser lớn hơn số scenario thì scenario được quay vòng.

### `random` — Ngẫu nhiên 1 scenario / browser

Mỗi browser nhận đúng 1 scenario trong danh sách đã tick.

```text
Chrome 1 → B
Chrome 2 → B
Chrome 3 → A
```

Random chỉ nằm ở bước **phân công**. Nội dung scenario vẫn deterministic.

### `manual` — Tự gán từng browser

UI hiển thị dropdown cho từng browser đã tick:

```text
GPM 5213  → device_behavior.js
GPM 6466  → th-m-i.scenario.js
GPM 6942  → device_behavior__variant_01.js
```

## 2. Cách thực thi

Sau khi tạo ra danh sách task ở trên:

- `parallel`: browser khác nhau chạy đồng thời; mỗi browser vẫn dùng queue riêng để tránh tranh debugger.
- `sequential`: toàn bộ task chạy lần lượt.

## Module

Logic thuần nằm tại:

```text
control-center/manager/assignment.js
```

Hàm chính:

```js
buildAssignmentTasks({
  agentIds,
  scenarioIds,
  assignmentMode,
  assignments,
  tracePlan,
  timingProfile
})
```

## Quy tắc

Scenario do Recorder tạo không bị random hóa bởi module này. Random timing/robustness chỉ thuộc Scenario Variants khi người dùng chủ động tạo variant.
