# Packages

Thư mục này mô phỏng cách các bản ZIP trước đây được đóng gói để dễ tìm trên GitHub.

## Control Center

- `browser_debug_agent_control_center_v3_10_assignment/`
  - package hiện tại của Control Center
  - source thực tế: [`../../control-center/`](../../control-center/)

## Recorder

- `browser_action_recorder_v3_7_recorded_click/`
  - package hiện tại của Browser Action Recorder
  - source thực tế: [`../../recorder/`](../../recorder/)

## Quy ước

`packages/` chỉ là mục lục theo kiểu ZIP/release. Source chạy thực tế chỉ duy trì một bản trong `control-center/` và `recorder/` để tránh code bị nhân đôi và lệch phiên bản.

Khi có phiên bản mới, tạo thêm một thư mục package tương ứng và cập nhật `CURRENT.md`.
