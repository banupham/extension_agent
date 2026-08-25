# Training Collector V0.1

Extension riêng cho human demonstration capture phục vụ dataset/agent training.

## Boundary

Collector là **observe-only**. V0.1 không tự click, type, navigate hay dùng `chrome.debugger`.

Thu sơ bộ:
- task/episode lifecycle;
- semantic interactive element snapshot;
- click target metadata;
- keyboard operation class;
- text length/change metadata;
- scroll position;
- final outcome do người dùng đánh dấu.

Không thu raw password, cookie, local/session storage, Authorization/token hay raw text value. Field nhạy cảm được đánh dấu `sensitive` và label bị redacted.

## Output model hiện tại

V0.1 mới là skeleton. Episode được giữ trong `chrome.storage.local`:

```text
Task
+ initialObservation
+ interaction events
+ finalOutcome
```

Giai đoạn tiếp theo sẽ chuẩn hóa thành:

```text
state_before -> action -> state_after -> outcome
```

với Privacy Redactor chạy trước khi ghi dataset.
