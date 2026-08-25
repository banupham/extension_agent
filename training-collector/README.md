# Training Collector V0.3 Raw Browser Session

Extension riêng cho human demonstration capture phục vụ dataset/agent training.

## Boundary

Collector là **observe-only**. Không tự click, type, navigate và không dùng `chrome.debugger` để điều khiển trang.

V0.3 có hai lớp dữ liệu độc lập:

```text
Browser Session Raw Capture   <- luôn chạy trong Chrome session
Optional Task Episode         <- nhãn/segment semantic nằm bên trong raw session
```

Raw capture bắt đầu tự động khi extension/browser session hoạt động trên trang `http/https` và tiếp tục xuyên suốt các tab hợp lệ cho đến khi Chrome session kết thúc.

## Browser-session model

```text
Chrome opens
  -> browserSessionId
  -> content pages HELLO
  -> raw event batches
  -> chunked chrome.storage.local persistence
  -> heartbeat / lastSeenAt
Chrome closes
  -> extension process also stops
Next Chrome start
  -> previous active session is finalized as closed-inferred
  -> endedAt uses the last persisted lastSeenAt
  -> new browserSessionId is created
```

Chrome extension không thể chạy code sau khi toàn bộ Chrome process đã thoát. Vì vậy session end được suy ra từ `lastSeenAt` của dữ liệu đã flush trước khi browser đóng.

## Raw physical data V0.3

Collector lưu raw event samples, không aggregate speed/path ở bước thu thập.

Các nhóm hiện tại:

- pointer move/down/up/cancel;
- browser coalesced pointer samples khi API có sẵn;
- client/screen coordinates, movement delta, button/buttons, pressure, pointer type;
- raw wheel delta X/Y/Z và deltaMode;
- raw scroll position samples;
- keyboard down/up timing và operation class;
- printable keyboard event chỉ giữ class `printable`, không giữ ký tự/code để tránh tái tạo text;
- window focus/blur;
- document visibility;
- heartbeat;
- explicit `idle-gap` marker khi khoảng cách giữa hai physical activities >= 500 ms.

Tốc độ, acceleration, path distance, pause distribution và gesture segmentation được tính sau từ raw timestamps/samples, không được bake vào raw collector.

## Raw event ordering

Background gắn thêm:

```text
sessionSeq
browserSessionId (ở session metadata)
tabId
windowId
frameId
pageInstanceId
```

Dữ liệu được ghi theo chunk 250 event để tránh giữ cả browser session trong RAM.

## Privacy boundary

Collector không đọc/lưu:

- password value;
- cookie;
- localStorage/sessionStorage content;
- Authorization/token secret;
- clipboard content;
- raw text value của input;
- printable character/code trong raw keyboard stream.

Sensitive input/keyboard targets được bỏ qua. Raw pointer trajectory không chứa DOM text/value của element bên dưới con trỏ.

Raw page context chỉ gắn `origin + pathname`; query/hash không được đưa vào physical event stream.

## Semantic task episode

V0.2 transition architecture vẫn được giữ cho task labels:

```text
Task
+ initialObservation
+ [ stateBefore -> normalizedAction -> stateAfter -> outcome ]
+ finalOutcome
```

Episode không bật/tắt raw physical capture. Nó chỉ đánh dấu một đoạn phục vụ demonstration/task training.

## Files

```text
core/privacy.js
core/action_normalizer.js
core/episode_builder.js
core/raw_session_store.js
observer/semantic_observer.js
capture/physical_capture.js
content.js
background.js
popup.html
popup.js
tests/architecture_contract.js
tests/raw_session_contract.js
```

## Xem dữ liệu thử

Sau khi load/reload unpacked extension:

1. mở một trang `http/https` bình thường;
2. di chuột, dừng một lúc, click, scroll, gõ vào field không nhạy cảm;
3. mở popup Collector;
4. `Preview Raw` để xem 80 event cuối;
5. `Export Raw JSON` để tải toàn bộ raw data của browser session hiện tại.

File export có dạng:

```js
{
  exportVersion: '0.3.0',
  exportedAt: '...',
  session: {
    sessionId: 'browser-...',
    startedAt: '...',
    lastSeenAt: '...',
    eventCount: 1234,
    chunkCount: 5,
    privacy: {...}
  },
  events: [
    { sessionSeq: 1, type: 'pointer', phase: 'move', tsEpochMs: 0, x: 0, y: 0, ... },
    { sessionSeq: 2, type: 'idle-gap', durationMs: 900, ... },
    { sessionSeq: 3, type: 'wheel', deltaY: 100, ... }
  ]
}
```

## Chưa làm sau V0.3

- browser-tested validation trên Chrome thật cho raw session/export;
- retry journal nếu một RAW_BATCH gửi background thất bại;
- streaming export cho session cực lớn;
- storage retention/cleanup UI;
- cross-navigation episode reconciliation;
- shadow DOM/iframe semantic observer sâu;
- dataset conversion/JSONL;
- derived physical feature pipeline (speed/acceleration/path/pause distributions).

Các phần derived sẽ nằm ngoài raw collector để raw source luôn có thể được xử lý lại bằng thuật toán mới.
