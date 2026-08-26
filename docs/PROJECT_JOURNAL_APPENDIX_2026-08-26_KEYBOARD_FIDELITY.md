# PROJECT JOURNAL APPENDIX — Keyboard / text-input fidelity

Date: 2026-08-26
Branch: `main`

## `typeText` via `Input.insertText` — functional PASS, physical-key listener fidelity not provided

Controlled surface: `http://127.0.0.1:8091`

The test page focused one editable input and recorded these DOM events:

```text
keydown
keypress
beforeinput
input
keyup
```

Precondition observation:

```text
focusedRef = e0
label = Typing Target
editable = true
```

Semantic Agent action:

```text
typeText("A")
→ behaviorFamily = keyboard-text
→ CDP plan = one Input.insertText { text:"A" }
→ execution.ok = true
→ stepCount = resultCount = 1
```

Native page result:

```text
after.title = EVENTS beforeinput,input
```

No `keydown`, `keypress`, or `keyup` listener event was emitted by the current `Input.insertText` execution variant.

Classification:

```text
typeText functional text insertion        PASS
focused-input targeting/context           PASS
beforeinput/input fidelity                PASS
physical-key DOM listener fidelity        NOT PROVIDED by Input.insertText
```

This is not classified as a functional failure of the existing `typeText` action. Do not replace or modify this execution path merely to satisfy the fidelity experiment. If a task later requires physical-key-like listener semantics, that should be a separate execution variant below Strategy rather than changing the semantic `typeText` intent.

## Next existing capability to native-test

`replaceText` is already present in Agent Action Contract and currently shares the `keyboard-text` planner family with `typeText`.

Native-test it on `main` before modifying implementation. The expected semantic behavior is replacement of an existing input value, not simple append. If the current implementation appends instead of replacing, classify that as a native-confirmed implementation gap and only then fix it on `feat/agent-tab-context`.
