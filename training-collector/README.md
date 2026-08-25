# Training Collector V0.7.2 — Frame-Aware Stream Diagnostics

Observe-only Chrome MV3 extension để thu human browser demonstrations cho dataset/agent training.

Collector **không tự click/type/navigate** và không dùng `chrome.debugger` để điều khiển browser.

## Runtime hiện tại

```text
Physical Capture
├─ pointer move/down/up/cancel
├─ wheel / scroll position
├─ keyboard timing + operation class
├─ focus / visibility / idle / heartbeat
└─ capture-time targetRef correlation

Semantic Capture
├─ DOM click/focus/input/change/submit
├─ hover enter/dwell/leave raw facts
├─ rendered / inViewport / interactable
├─ selectorCandidates
├─ semantic snapshots
└─ 120 ms mutation bursts

V0.7.2
├─ all-frame raw capture
├─ frame-context facts
├─ frameId + documentId + pageInstanceId identity
├─ SPA route-change snapshots
└─ collector stream-health diagnostics
```

Raw schema: `0.7.2`  
Runtime/manifest: `0.7.2`

## Frame-aware capture

Content scripts chạy trong matching http/https frames với:

```json
{
  "all_frames": true,
  "match_about_blank": true,
  "match_origin_as_fallback": true
}
```

Mỗi frame có `pageInstanceId` riêng. Background bổ sung:

```text
tabId
windowId
frameId
documentId
documentLifecycle
```

Element identity phải hiểu theo composite context:

```text
tabId + frameId + pageInstanceId + elementRef
```

`x/y` của event trong iframe là frame-local client coordinates. `frame-context.coordinateSpace = frame-client` ghi rõ convention này.

Optional Task Episode hiện vẫn top-frame only để không trộn multi-frame state trước khi Agent Observation contract được nâng cấp. Continuous raw telemetry thì thu ở mọi matching frame.

## SPA route trace

Các trang như Google/YouTube có thể đổi route mà không reload document. V0.7.2 thêm:

```text
observer/route_trace.js
```

Khi `location.href` thay đổi:

```text
route-change
→ sanitized previous/current page
→ semantic-snapshot snapshotReason=route-change
```

Route detector dùng `popstate`, `hashchange` và polling 500 ms để bắt cả SPA `pushState/replaceState` mà content isolated world không nên giả định có thể patch an toàn.

Không lưu URL query values/hash content; semantic snapshot dùng privacy-sanitized page representation.

## Stream-health diagnostics

Native session trước đó từng cho thấy một đoạn Google Search gần như chỉ có `physical` source. V0.7.2 thêm direct diagnostic facts:

```text
collector-stream-start
collector-stream-health   // mỗi 10s
collector-stream-stop
```

Health record gồm:

```text
isTopFrame
readyState
visibilityState
viewport
module availability
cumulative sourceEventCounts
```

Mục tiêu là biết trực tiếp một frame có:

```text
physical
semantic
dom
hover
mutation
navigation
```

đang phát dữ liệu hay không, thay vì suy đoán từ raw sau khi test.

## Action semantics

### Hover

Raw chỉ giữ direct facts:

```text
dom-hover-enter
dom-hover-dwell
dom-hover-leave
```

`hover-preview` được derive offline bởi:

```text
training-collector/tools/build_action_semantics.js
```

Điều này cho phép thay thuật toán semantic segmentation mà không thu lại raw.

### Click target resolution

DOM click giữ đồng thời:

```text
targetRef          legacy/raw target
rawTargetRef       DOM event.target
resolvedTargetRef  best actionable interpretation
targetResolution   method + confidence
```

Resolver ưu tiên:

```text
composedPath actionable
→ elementFromPoint actionable
→ raw actionable ancestor
→ raw target
```

Không overwrite raw target.

## Timeline

```text
tsEpochMs  capture timestamp
pageSeq    order trong pageInstance
sourceSeq  order trong source stream
sessionSeq durable persistence order
```

`sessionSeq` không phải chronological truth. Mutation burst nhận page/source sequence lúc burst bắt đầu, không phải lúc flush 120 ms sau.

## Persistence / reliability

Raw store chính:

```text
RAW_BATCH + batchId
→ ACK/retry sender
→ background serialized append
→ IndexedDB trainingCollectorRawV06
   ├─ sessions
   ├─ chunks
   └─ batchReceipts
```

DB name V06 được giữ để tránh migration không cần thiết; schema event/session hiện là `0.7.2`.

Chunk size: 1000 events.

Reliability:

```text
batch receipt idempotency
chunk checksum FNV-1a
missing/checksum/metadata/sequence verification
status-indexed session recovery
```

Không tự delete raw session khi integrity fail.

Khi runtime schema thay đổi, active session schema cũ được đóng với `schema_upgrade_to_<version>` rồi session mới được tạo để tránh trộn schema trong cùng archive.

## Temporary automatic export

IndexedDB là persistence chính. Auto-download chỉ là development convenience.

Flow:

```text
Chrome session A
→ IndexedDB
→ Chrome đóng
→ startup sau infer/recover A closed
→ full integrity verify
→ offscreen CompressionStream(gzip)
→ chrome.downloads.download
→ chờ downloads.onChanged state=complete
→ mark autoExport.complete
```

File:

```text
Downloads/training-collector/training-collector-<sessionId>.raw.jsonl.gz
```

Popup có Recent Raw Sessions + autoExport status/error + Retry Auto Export.

## Analyzer

Analyzer đọc:

```text
legacy JSON
JSONL
JSONL.gz
```

Chạy:

```bat
node training-collector\tools\analyze_raw.js Downloads\training-collector\session.raw.jsonl.gz
```

Report gồm:

```text
event/source/tab distributions
frame/document/pageInstance coverage
per-frame source counts
route-change + semantic snapshot counts
stream-health + physical-only suspicion
pointer sampling gaps
physical↔semantic correlation
mutation records represented
sessionSeq continuity
timestamp backwards
privacy red flags
```

## Privacy boundary

Collector không thu/lưu:

- password values;
- cookies;
- Authorization/access/refresh tokens;
- localStorage/sessionStorage secret contents;
- clipboard contents;
- payment secrets;
- raw sensitive input values;
- printable keyboard actual character/code;
- URL query values/hash content;
- raw document title theo policy hiện tại.

Sensitive filtering phải xảy ra trước khi data nhạy cảm rời content script whenever possible.

## Files chính

```text
core/privacy.js
core/raw_session_store.js
core/indexeddb_chunk_store.js
core/reliable_sender.js
observer/semantic_observer.js
observer/mutation_trace.js
observer/hover_trace.js
observer/route_trace.js
correlation/physical_semantic_correlator.js
correlation/action_target_resolver.js
capture/physical_capture.js
capture/dom_capture.js
tools/analyze_raw.js
tools/build_action_semantics.js
background.js
content.js
popup.js
offscreen.js
```

## Validation V0.7.2

```text
1 git pull
2 chrome://extensions → Reload
3 refresh/reopen target pages so new content scripts inject
4 verify name: Training Collector V0.7.2 Frame-Aware Stream Diagnostics
5 browse normal top pages + an embedded player/iframe
6 include an SPA route change without full reload
7 do not manually export for normal test
8 close all Chrome → reopen
9 verify previous session auto-export
10 run analyze_raw.js on .raw.jsonl.gz
```

Expected new evidence:

```text
frame-context from top + accessible frames
frameId/documentId populated
collector-stream-health per pageInstance
semantic snapshot at document start
route-change + route semantic snapshot on SPA changes
DOM/hover/mutation events from interacted iframe when injection is permitted
```

CI syntax/contracts are not a substitute for native Chrome validation.
