# Training Collector V0.2 Architecture Foundation

Extension riêng cho human demonstration capture phục vụ dataset/agent training.

## Boundary

Collector là **observe-only**. Không tự click, type, navigate và không dùng `chrome.debugger` để điều khiển trang.

Collector V0.2 chuẩn hóa dữ liệu theo transition:

```text
Task
+ initialObservation
+ [ stateBefore -> normalizedAction -> stateAfter -> outcome ]
+ finalOutcome
```

## Architecture

```text
DOM / Browser page
  -> Privacy classifier
  -> Semantic Observer + stable element refs
  -> Human Action Normalizer
  -> Transition START(stateBefore + action)
  -> Transition END(stateAfter + outcome)
  -> Episode Builder
  -> chrome.storage.local
```

Các lớp hiện tại:

```text
core/privacy.js
core/action_normalizer.js
core/episode_builder.js
observer/semantic_observer.js
content.js
background.js
```

### Stable element ref

Trong một page instance, cùng một DOM Element giữ cùng `ref` thông qua `WeakMap`. Ref chỉ có ý nghĩa trong page instance đó; navigation/reload tạo `pageInstanceId` mới.

### Partial transitions

`TRANSITION_START` được gửi trước khi transition hoàn tất. Nếu click tạo navigation và content script biến mất trước `TRANSITION_END`, Episode vẫn giữ transition ở trạng thái `pending/partial` thay vì mất action.

### Privacy boundary

V0.2 không đọc cookie, local/session storage, Authorization header hay raw text value.

Element được phân loại nhạy cảm trước khi tạo observation/action. Password và metadata có dấu hiệu password/passcode/OTP/token/secret/CVV/card/authorization/session id bị loại khỏi semantic observations và không tạo keyboard/input transition.

Text interaction thông thường chỉ giữ metadata như operation, key class, inputType và length; không giữ ký tự/text người dùng đã nhập.

## Observation V0.2

Observation gồm:

- `schemaVersion`;
- `pageInstanceId`;
- URL/title;
- viewport/devicePixelRatio;
- scroll position;
- `focusedElementRef`;
- danh sách interactive element semantic với stable ref, tag, role, label, editable/enabled/visible, selector và rect.

## Action V0.2

Các action human capture hiện có:

- `click`;
- `key`;
- `text-key`;
- `text-change` fallback cho input không gắn với keydown gần nhất;
- `focus`;
- `scroll`.

Mỗi action dùng `targetRef` thay vì copy lại toàn bộ element.

## Episode V0.2

Mỗi transition có:

```js
{
  transitionId,
  status: 'pending' | 'complete',
  startedAtMs,
  endedAtMs,
  stateBefore,
  action,
  stateAfter,
  outcome: {
    actionSucceeded,
    partial
  }
}
```

## Test

`tests/architecture_contract.js` kiểm tra privacy classification, normalized action contract và begin/finish transition contract. GitHub CI chạy test này cùng syntax/manifest checks.

## Chưa làm ở V0.2

- DOM mutation-aware observation/diff;
- cross-navigation transition reconciliation;
- selector quality scoring;
- shadow DOM/iframe observer;
- richer accessibility semantics;
- task args privacy policy;
- dataset export/JSONL;
- dataset quality metrics;
- automatic goal/outcome inference.

Các phần này sẽ được map và test riêng thay vì nhồi vào content script.
