# Agent Boundary Conditions

Tài liệu này ghi các trạng thái UI/environment mà Agent phải coi là **boundary / blocked condition**, không phải lỗi execution thông thường cần retry mù quáng.

## CAPTCHA / human-verification challenge

CAPTCHA hoặc human-verification có thể xuất hiện tự nhiên sau nhiều lần test, navigation hoặc interaction. Đây không mặc định là lỗi của Collector/Agent.

Khi Observer phát hiện challenge đáng tin cậy:

```text
current action/task
→ observe challenge / human verification
→ Decision.status = blocked
→ reasonCode = human_verification_required
→ không cố tự giải hoặc vượt challenge
→ không lặp click/reload vô hạn
→ re-evaluate task constraints/history
→ nếu có route hợp lệ khác: replan sang route/trang/task khác
→ nếu không: dừng task và báo blocked
```

Agent có thể tiếp tục công việc khác một cách bình thường nếu mục tiêu cho phép, ví dụ chuyển sang nguồn/trang khác hoặc bước khác không phụ thuộc challenge. Việc chuyển hướng phải phục vụ task, không phải nhằm né/bypass challenge.

## Strategy / Behavior / Executor boundary

```text
Observer
→ detects boundary signal

Strategy
→ quyết định blocked / alternate valid route

Behavior Model
→ không sinh thao tác để vượt challenge

Executor
→ chỉ thực thi normalized action hợp lệ do Strategy chọn
```

CAPTCHA state không được biến thành một special low-level CDP bypass path.

## Dataset implication

Training Collector vẫn có thể ghi raw interaction/state quanh challenge để học:

```text
approach
hover
focus
click
frame/state transition
```

nhưng dataset label phải phân biệt:

```text
human_verification_encountered
blocked
abandoned/replanned
```

với task/action failure thông thường.

Nếu challenge nằm trong iframe, Collector cần frame-aware observation để hiểu đúng target/state; mục tiêu là quan sát UI đầy đủ, không phải tự động giải challenge.
