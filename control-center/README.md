# Browser Debug Agent Control Center V3.10 Assignment Modes

Kế thừa V3.8 Observable Queue Fix, V3.9 Recorded Click và bổ sung phân công browser ↔ scenario.

## Cấu trúc chuẩn

Cấu trúc repo giữ tương thích với gói ZIP V3.8:

- `server/server.js`
- `manager/control_center.js`
- `manager/public/{index.html,app.js,style.css}`
- `extension/stealth-extension/{manifest.json,background.js}`
- `script/checks/{run_check.js,device_behavior.js}`
- `START_CONTROL_CENTER.bat`, `STOP_CONTROL_CENTER.bat`

## Assignment modes

- `all`: mọi browser × mọi scenario
- `pair`: ghép browser/scenario theo thứ tự, quay vòng khi cần
- `random`: mỗi browser nhận ngẫu nhiên 1 scenario đã chọn
- `manual`: tự gán 1 scenario cho từng browser

Scenario recorder gốc vẫn deterministic; random assignment chỉ chọn scenario, không thay đổi nội dung scenario.

## Chạy

```bat
npm install
START_CONTROL_CENTER.bat
```

Dashboard: `http://127.0.0.1:8788`
