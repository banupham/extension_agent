# extension_agent

> **Trạng thái tiếp quản:** Repository này hiện đang được tiếp quản để tiếp tục phát triển, rà soát các phần đang dang dở và triển khai các giai đoạn tiếp theo.

Local Chrome/GPM automation framework gồm các phần chính:

- `control-center/`: broker WebSocket, dashboard, deterministic runner và Agent runtime/strategy work.
- `recorder/`: Browser Action Recorder để ghi workflow và export scenario `.js` deterministic.
- `training-collector/`: observe-only physical + semantic human demonstration capture cho dataset/behavior learning.

## Bắt đầu khi quay lại dự án sau một khoảng thời gian

Đọc theo thứ tự:

```text
1. STATUS.md
   → version/milestone hiện tại + việc tiếp theo

2. docs/PROJECT_JOURNAL.md
   → code lookup map + invariants + dependency + quyết định kiến trúc + lịch sử kỹ thuật

3. source files được journal chỉ ra
   → luôn fetch/đọc code hiện tại trước khi sửa
```

`docs/PROJECT_JOURNAL.md` là persistent engineering memory của dự án. Khi cần sửa một khu vực như pointer capture, IndexedDB, auto-export, Strategy, Behavior Model, Recorder..., journal chỉ ra những file nào cần đọc cùng và test nào liên quan để không phải khảo sát lại toàn repo từ đầu.

## Tìm theo kiểu ZIP cũ

Nếu bạn quen với tên các file ZIP mình từng gửi, vào:

```text
packages/
```

Hiện có:

```text
packages/
├─ CURRENT.md
├─ browser_debug_agent_control_center_v3_10_assignment/
└─ browser_action_recorder_v3_7_recorded_click/
```

Mỗi thư mục package có cây thư mục giống gói ZIP cũ và chỉ rõ source thật nằm ở đâu.

- Control Center source thật: `control-center/`
- Recorder source thật: `recorder/`

Không nhân đôi runtime source vào `packages/` để tránh hai bản code bị lệch nhau.

## Source of truth

Ưu tiên repo GitHub này. Khi có bản mới, dùng:

```bat
git pull
```

thay vì tải ZIP thủ công.

Trạng thái version hiện tại không nên suy từ phần lịch sử trong README này; xem `STATUS.md` để lấy milestone mới nhất.

## Cài Control Center

```bat
git clone https://github.com/banupham/extension_agent.git
cd extension_agent\control-center
npm install
START_CONTROL_CENTER.bat
```

Dashboard:

```text
http://127.0.0.1:8788
```

Load/reload Stealth Executor tại:

```text
control-center/extension/stealth-extension
```

trong `chrome://extensions` của Chrome/GPM cần điều khiển.

## START_CONTROL_CENTER.bat

Mẫu launcher ưu tiên:

```bat
@echo off
cd /d "%~dp0"
call STOP_CONTROL_CENTER.bat >nul 2>&1
timeout /t 1 /nobreak >nul
start "Browser Debug Agent Control Center V3.10" /min node manager\control_center.js
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:8788
```

## V3.10 — Phân công Browser ↔ Scenario

Phân công và thực thi là 2 lựa chọn độc lập.

Phân công:

- `all`: mọi browser × mọi scenario.
- `pair`: Chrome 1 → A, Chrome 2 → B, quay vòng nếu cần.
- `random`: mỗi browser nhận ngẫu nhiên 1 scenario đã chọn.
- `manual`: tự gán scenario cho từng browser.

Thực thi:

- `parallel`: song song giữa browser.
- `sequential`: chạy lần lượt toàn bộ task.

Logic phân công nằm tại:

```text
control-center/manager/assignment.js
```

Xem thêm [docs/ASSIGNMENT_MODES.md](docs/ASSIGNMENT_MODES.md).

## Recorder scenario

Scenario gốc do Recorder tạo là deterministic:

- `clickRecorded` lưu điểm tương đối `rx/ry` trong element;
- `scrollTo` lưu vị trí tuyệt đối và được coalesce theo gesture;
- text edit được gộp thành final-value semantic.

Random chỉ được áp dụng khi chủ động tạo Scenario Variant hoặc chọn **random assignment**; random assignment chỉ chọn scenario cho browser, không sửa nội dung scenario.

## Tài liệu theo dõi

- [STATUS.md](STATUS.md): trạng thái công việc hiện tại và điểm tiếp tục.
- [docs/PROJECT_JOURNAL.md](docs/PROJECT_JOURNAL.md): persistent engineering memory, code lookup map và invariants.
- [CHANGELOG.md](CHANGELOG.md): lịch sử thay đổi.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): kiến trúc.
- [docs/AGENT_TRAINING_ARCHITECTURE.md](docs/AGENT_TRAINING_ARCHITECTURE.md): Agent/Training architecture.
- [docs/KEYBOARD.md](docs/KEYBOARD.md): keyboard/Backspace.
- [docs/RECORDED_CLICK.md](docs/RECORDED_CLICK.md): click deterministic.
- [docs/ASSIGNMENT_MODES.md](docs/ASSIGNMENT_MODES.md): phân công browser/scenario.
