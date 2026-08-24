# extension_agent

Local Chrome/GPM automation framework gồm 2 phần:

- `control-center/`: broker WebSocket, dashboard, runner và Stealth Executor extension.
- `recorder/`: Browser Action Recorder để ghi workflow và export scenario `.js` deterministic.

## Bản hiện tại

- Control Center: **V3.9 Recorded Click**
- Stealth Executor: **1.5.0**
- Recorder: **V3.7 Recorded Click**

## Cài Control Center

```bat
cd control-center
npm install
START_CONTROL_CENTER.bat
```

Dashboard: `http://127.0.0.1:8788`

Load/reload extension tại:

```text
control-center/extension/stealth-extension
```

trong `chrome://extensions` của Chrome/GPM cần điều khiển.

## Cài Recorder

Load unpacked thư mục:

```text
recorder/
```

Recorder có 3 nút: **Start / Stop / Export .js**.

## Nguyên tắc scenario

Scenario gốc do Recorder tạo là deterministic. Click đã ghi dùng `clickRecorded`: lưu điểm tương đối `rx/ry` trong element và phát lại đúng điểm đó, không random offset. Scroll dùng `scrollTo` tuyệt đối và được gộp theo gesture/burst. Random chỉ được áp dụng khi chủ động tạo Scenario Variant.

## Tài liệu theo dõi

- [STATUS.md](STATUS.md): trạng thái công việc hiện tại và điểm tiếp tục.
- [CHANGELOG.md](CHANGELOG.md): lịch sử thay đổi.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): kiến trúc.
- [docs/KEYBOARD.md](docs/KEYBOARD.md): keyboard/Backspace.
- [docs/RECORDED_CLICK.md](docs/RECORDED_CLICK.md): contract click deterministic.
