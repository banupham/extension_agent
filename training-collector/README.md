# Training Collector V0.4 DOM Core + Physical/Semantic Correlation

Extension riêng cho human demonstration capture phục vụ dataset/agent training.

## Boundary

Collector là **observe-only**. Không tự click, type, navigate và không dùng `chrome.debugger` để điều khiển trang.

V0.4 có hai stream chạy song song trong cùng một Chrome browser session:

```text
Raw Physical Stream
+ Semantic DOM Stream
-> shared browserSessionId / pageInstanceId / elementRef
-> chunked raw persistence
-> raw JSON export
```

Optional Task Episode vẫn tồn tại như nhãn/segment; episode không bật/tắt raw capture.

## DOM Core V0.4

```text
observer/element_registry.js
observer/semantic_observer.js
capture/dom_capture.js
observer/mutation_trace.js
correlation/physical_semantic_correlator.js
```

### Element Registry

Một `WeakMap<Element, ref>` dùng chung là nguồn element identity trong một page instance. Cùng DOM element giữ cùng ref như `e17` cho snapshot, DOM interaction và physical correlation. Navigation/reload tạo `pageInstanceId` mới nên ref không được coi là global identity giữa hai document.

### Semantic Observer

Observation V0.4 giữ:

- `pageInstanceId`;
- page `origin + pathname`;
- chỉ tên query parameter, không giữ query value/hash content;
- title chỉ giữ length/empty metrics, không lưu title text;
- viewport/devicePixelRatio;
- scroll position;
- focused element ref;
- visible interactive elements với ref/tag/role/label/editable/enabled/selector/rect;
- registry assigned-count diagnostics.

Sensitive elements bị loại trước khi semantic data rời content script.

### Raw DOM Interaction Stream

Các event DOM raw hiện gồm:

```text
dom-click
dom-focus
dom-input
dom-change
dom-submit
```

`dom-input` chỉ giữ `inputType + length`; không giữ raw value. Select chỉ giữ selected index; checkbox/radio chỉ giữ checked state.

### Mutation Trace

Mutation trace không lưu text/HTML/value. Nó chỉ giữ structural/state facts:

- child added/removed counts và semantic descriptors khi an toàn;
- role/hidden/open/disabled/checked/selected;
- aria expanded/hidden/disabled/selected/checked/pressed.

Không theo dõi class/style ở V0.4 để tránh animation/render noise làm phình raw stream.

## Physical/Semantic Correlation

Physical events `pointer`, `wheel`, `keyboard` được correlate **ngay tại thời điểm capture**, không đợi đến batch flush.

Ví dụ:

```js
{
  type: 'pointer',
  phase: 'down',
  tsEpochMs: 123456.1,
  x: 500,
  y: 320,
  semanticTarget: {
    elementRef: 'e17',
    tag: 'button',
    role: 'button',
    label: 'Search',
    selector: '#search',
    rect: {...}
  }
}
```

Nếu element dưới pointer/focus là sensitive thì `semanticTarget` không được gắn.

## Raw physical data

Collector giữ raw browser samples, không bake feature engineering vào source:

- pointer move/down/up/cancel + coalesced samples khi có;
- client/screen coordinates, movement delta, button/buttons, pressure, pointer type;
- wheel delta X/Y/Z + deltaMode;
- scroll positions;
- keyboard down/up timing + operation class;
- printable key chỉ giữ class `printable`, không giữ ký tự/code;
- focus/blur/visibility;
- heartbeat;
- `idle-gap` marker cho physical gap >= 500 ms.

Speed, acceleration, path distance, curvature, pause distributions và gesture segmentation được tính offline sau.

## Browser session + persistence

Một lần Chrome mở là một browser raw session. Background ghi chunk 250 event vào `chrome.storage.local` và gắn:

```text
rawVersion
captureSource
sessionSeq
tabId
windowId
frameId
pageInstanceId
```

Ghi raw từ nhiều tab được serialize qua một write chain để tránh hai tab ghi đè sequence/chunk của nhau.

Khi Chrome đóng, extension cũng dừng. Lần Chrome mở sau, active session cũ chưa finalize sẽ thành `closed-inferred`, `endedAt` dùng `lastSeenAt` cuối đã persist.

## Privacy boundary

Collector không đọc/lưu:

- password value;
- cookie;
- localStorage/sessionStorage content;
- Authorization/token secret;
- clipboard content;
- raw text value của input;
- printable character/code trong raw keyboard stream;
- URL query values/hash content;
- raw document title.

## Offline analysis loop

Sau khi export raw JSON:

```bat
node training-collector\tools\analyze_raw.js path\to\session.raw.json
```

Analyzer báo:

- total/duration/event type distribution;
- capture source distribution;
- per-tab event counts;
- pointer sampling gap p50/p90/p99/max;
- physical->semantic correlation coverage;
- DOM/mutation counts;
- sessionSeq discontinuity;
- timestamp-backwards count;
- simple privacy red flags.

Đây là vòng cải thiện chính:

```text
Collect real Chrome session
-> Export raw JSON
-> Analyze raw
-> inspect anomalies/coverage/noise/privacy
-> adjust Collector
-> repeat
```

## Test thủ công V0.4

1. `git pull`.
2. Reload unpacked `training-collector/` ở `chrome://extensions`.
3. Nên đóng/mở lại Chrome để có browser session mới dùng schema V0.4.
4. Mở một trang http/https bình thường.
5. Di chuột chậm/nhanh, nghỉ vài giây, hover/click nhiều element, scroll, focus và gõ vào field không nhạy cảm, mở tab thứ hai và thao tác tiếp.
6. Popup -> `Preview Raw` để kiểm nhanh.
7. Popup -> `Export Raw JSON`.
8. Chạy offline analyzer hoặc gửi file `.raw.json` để review dữ liệu thực tế.

Trong raw output nên thấy song song:

```text
captureSource=physical -> pointer/wheel/keyboard/idle...
captureSource=dom      -> dom-click/dom-focus/dom-input...
captureSource=mutation -> dom-mutation...
captureSource=semantic -> semantic-snapshot
```

Pointer/wheel/keyboard trên element an toàn nên có `semanticTarget.elementRef`; DOM event trên cùng element nên dùng cùng ref trong cùng `pageInstanceId`.

## Files V0.4

```text
core/privacy.js
core/action_normalizer.js
core/episode_builder.js
core/raw_session_store.js
observer/element_registry.js
observer/semantic_observer.js
observer/mutation_trace.js
correlation/physical_semantic_correlator.js
capture/physical_capture.js
capture/dom_capture.js
tools/analyze_raw.js
content.js
background.js
popup.html
popup.js
tests/architecture_contract.js
tests/raw_session_contract.js
tests/raw_analysis_contract.js
```

## Chưa làm sau V0.4

- deep Shadow DOM observer;
- iframe semantic identity/correlation beyond current content-script frame behavior;
- selector candidate scoring/fallback set;
- hover semantic transition stream;
- scroll-container identity instead of page-only scroll position;
- retry journal khi RAW_BATCH delivery thất bại;
- streaming export cho session rất lớn;
- session retention/cleanup UI;
- cross-navigation episode reconciliation;
- derived feature pipeline / dataset JSONL conversion.

Các phần này sẽ được ưu tiên dựa trên dữ liệu raw thật từ vòng manual test V0.4.
