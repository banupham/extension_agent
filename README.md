# extension_agent

Local Chrome/GPM automation framework gồm 2 phần:

- `control-center/`: broker WebSocket, dashboard, runner và Stealth Executor extension.
- `recorder/`: Browser Action Recorder để ghi workflow và export scenario `.js` deterministic.

## Bản hiện tại

- Control Center: **V3.8 Observable Queue Fix**
- Stealth Executor extension: source trong `control-center/extension/stealth-extension/`
- Recorder: **V3.5 Deterministic**

## Cài Control Center

```bat
cd control-center
npm install
START_CONTROL_CENTER.bat
```

Dashboard: `http://127.0.0.1:8788`

Sau đó load/reload extension tại:

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

Scenario do Recorder tạo là deterministic: lưu workflow/timing/scroll đã ghi. Random chỉ được áp dụng khi chủ động tạo Scenario Variant từ Control Center.

## Tài liệu theo dõi

- [STATUS.md](STATUS.md): trạng thái công việc hiện tại, bug đã fix, bug cần test tiếp.
- [CHANGELOG.md](CHANGELOG.md): lịch sử thay đổi quan trọng.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): kiến trúc và luồng dữ liệu.
- [docs/KEYBOARD.md](docs/KEYBOARD.md): mapping keyboard/Backspace và lưu ý Recorder.
