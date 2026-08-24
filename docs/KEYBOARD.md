# Keyboard mapping

Executor mapping hiện tại gồm:

| Key | code | Windows VK |
|---|---|---:|
| Enter | Enter | 13 |
| Tab | Tab | 9 |
| Escape | Escape | 27 |
| Backspace | Backspace | 8 |
| Delete | Delete | 46 |
| ArrowLeft | ArrowLeft | 37 |
| ArrowUp | ArrowUp | 38 |
| ArrowRight | ArrowRight | 39 |
| ArrowDown | ArrowDown | 40 |
| Home | Home | 36 |
| End | End | 35 |
| PageUp | PageUp | 33 |
| PageDown | PageDown | 34 |
| Insert | Insert | 45 |
| Space | Space | 32 |
| F1–F12 | F1–F12 | 112–123 |

## Backspace và Recorder

Executor **có** Backspace.

Nếu scenario chứa:

```js
{ action: 'pressKey', key: 'Backspace', delay: 120 }
```

runner map sang extension và extension phát CDP keyDown/keyUp với `VK=8`.

Recorder deterministic/semantic biểu diễn việc chỉnh text bằng giá trị cuối cùng. Vì vậy Backspace/Delete bên trong input/textarea/contenteditable được gộp vào `replaceText` cuối cùng để tránh replay hai lần cùng một chỉnh sửa. Backspace/Delete ngoài vùng editable vẫn được ghi thành `pressKey`.
