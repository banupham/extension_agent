# Training Collector V0.5 Compact Raw

Extension observe-only cho human demonstration capture phục vụ dataset/agent training.

## Mục tiêu V0.5

V0.5 được điều chỉnh dựa trên phiên raw thực tế ~29k events của V0.4. Các vấn đề chính được xử lý:

- semantic target bị lặp trên từng pointer/wheel sample;
- DOM mutation chiếm phần lớn raw stream;
- `visible` trước đây không phân biệt rendered với nằm trong viewport;
- selector đơn lẻ thường quá chung;
- task episode lặp full semantic observation;
- JSON debug export không phù hợp cho session dài.

## Kiến trúc runtime

```text
Physical Capture -----------\
                             -> targetRef correlation -> Raw Session
Semantic DOM Capture -------/
Mutation Observer -> 120ms mutation bursts
Semantic Observer -> full page-instance snapshot anchor
Optional Task Episode -> initial full observation + state diffs
```

Collector không tự click/type/navigate và không dùng `chrome.debugger` để điều khiển trang.

## Compact target correlation

V0.4 có thể lặp cả semantic descriptor trên mỗi mouse sample. V0.5 chuyển sang:

```js
{
  type: 'pointer',
  x: 100,
  y: 200,
  targetRef: 'e17'
}
```

Descriptor đầy đủ chỉ được gắn lần đầu ref đó xuất hiện trong stream tương ứng:

```js
{
  type: 'pointer',
  targetRef: 'e17',
  targetDescriptor: {
    elementRef: 'e17',
    tag: 'button',
    role: 'button',
    label: 'Search',
    selector: '#search',
    selectorCandidates: [...],
    rect: {...},
    rendered: true,
    inViewport: true,
    interactable: true
  }
}
```

Những sample tiếp theo chỉ giữ `targetRef`.

## Visibility / interactability

Semantic element tách rõ:

```text
rendered      -> có layout và không display/visibility/opacity hidden
inViewport    -> rect giao với viewport hiện tại
interactable  -> rendered + inViewport + enabled + pointer-events hợp lệ
```

Field `visible` vẫn được giữ tạm để compatibility và hiện tương đương `rendered`.

## Selector candidates

Mỗi element có danh sách selector candidate có score thay vì chỉ một selector:

```text
id       1.00
data-testid 0.98
name     0.90
role     0.65
tag      0.20
```

`selector` hiện là candidate score cao nhất; `selectorCandidates` giữ fallback set.

## Mutation burst

V0.4 ghi từng MutationRecord, dẫn tới mutation có thể chiếm gần toàn bộ file. V0.5 gom mutation theo burst 120 ms:

```js
{
  type: 'dom-mutation-burst',
  windowMs: 120,
  recordCount: 35,
  addedCount: 4,
  removedCount: 2,
  attributes: {
    'aria-expanded': 2,
    hidden: 4
  },
  targetRefs: [...],
  addedRefs: [...],
  removedRefs: [...]
}
```

Không lưu innerHTML/textContent/value.

## State diff cho Task Episode

Episode V0.5 dùng:

```text
initialObservation = full snapshot một lần
transition 1 -> stateBeforeDiff / stateAfterDiff
transition 2 -> stateBeforeDiff / stateAfterDiff
...
```

Diff hiện tập trung vào:

- focused element ref;
- scroll x/y;
- added/removed element refs;
- rendered/inViewport/interactable/enabled;
- rect thay đổi.

Nếu page instance thay đổi hoặc không thể diff an toàn, transition có thể fallback về full snapshot.

## Timeline

Hai thứ tự được phân biệt rõ:

```text
tsEpochMs  = thời điểm event xảy ra/capture
sessionSeq = thứ tự background persist event
```

Do nhiều source flush batch khác nhau, `sessionSeq` không được coi là chronological truth. Khi dựng trajectory offline, ưu tiên `tsEpochMs`, sau đó `tPageMs`, rồi `sessionSeq` làm tie-breaker.

## Chunk persistence

V0.5 hiện vẫn dùng `chrome.storage.local` như development-stage raw store nhưng tăng chunk từ 250 lên 500 events để giảm metadata/chunk overhead.

Đây **không phải storage architecture cuối cùng**. Hướng tiếp theo V0.6 là IndexedDB ChunkStore + recovery/retention + streaming export.

## Export format trong giai đoạn phát triển

Manual popup export chuyển sang JSONL/NDJSON:

```text
{"recordType":"session", ...}
{"recordType":"event", ...}
{"recordType":"event", ...}
...
```

File:

```text
*.raw.jsonl
```

JSONL giúp đọc theo stream và không cần parse một JSON array lớn. Gzip `.jsonl.gz` dự kiến ở V0.6 cùng streaming export.

Auto-export JSON của previous session vẫn chỉ là **development/debug adapter tạm thời**, không phải phương thức lưu chính dài hạn.

## Analyzer

Analyzer đọc cả raw JSON V0.4 cũ và raw JSONL V0.5:

```bat
node training-collector\tools\analyze_raw.js path\to\session.raw.jsonl
```

Report gồm:

- total events / duration;
- event/source/tab distribution;
- pointer sampling gaps;
- physical -> semantic correlation coverage;
- mutation burst count và số raw MutationRecord đại diện;
- sessionSeq discontinuity;
- capture timestamp backwards theo persistence order;
- privacy red flags.

## Privacy boundary

Collector không đọc/lưu:

- password value;
- cookie;
- localStorage/sessionStorage content;
- Authorization/token secret;
- clipboard content;
- raw text value của input;
- printable character/code trong keyboard raw stream;
- URL query values/hash content;
- raw document title.

Sensitive targets bị loại trước khi semantic data rời content script.

## Test V0.5

1. `git pull`.
2. Reload unpacked `training-collector/` ở `chrome://extensions`.
3. Đóng/mở Chrome để bắt đầu browser session mới dùng schema V0.5.
4. Thực hiện phiên thao tác tương tự V0.4: pointer chậm/nhanh/nghỉ, hover/click, wheel/scroll, focus/input, đổi tab.
5. Popup -> `Manual Export JSONL`.
6. Chạy analyzer hoặc gửi `.raw.jsonl` để so sánh với V0.4.

Các số nên so sánh trực tiếp:

```text
file size
raw event count
mutation event count
mutation represented record count
correlation coverage
pointer sampling distribution
privacy red flags
```

## Files chính

```text
core/privacy.js
core/action_normalizer.js
core/state_diff.js
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
```

## V0.6 dự kiến

```text
IndexedDB ChunkStore
-> streaming JSONL export
-> gzip .jsonl.gz
-> chunk checksum/recovery
-> storage retention
-> session index
```

Sau đó dataset pipeline mới chuyển cleaned/normalized data sang Parquet cho analytics/training. Raw archive vẫn giữ khả năng tái xử lý bằng thuật toán mới.
