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

## `replaceText` — initial NATIVE FAIL on `main`

Controlled precondition:

```text
focusedRef = e0
label = Replace Target
editable = true
input value = OLD
```

Semantic action:

```text
replaceText(targetRef=e0, text="NEW")
```

Initial planner behavior on `main` treated `replaceText` exactly like `typeText`:

```text
Input.insertText "N"
→ Input.insertText "E"
→ Input.insertText "W"
```

Native result:

```text
execution.ok = true
stepCount = resultCount = 3
expected value = NEW
actual value   = OLDNEW
after.title = VALUE OLDNEW EVENTS keyup,keydown,beforeinput,input,beforeinput,input,beforeinput,input
```

Classification:

```text
low-level insert dispatch succeeds      PASS
semantic replaceText behavior           FAIL
cause                                   planner appends; it never selects/replaces existing content
```

This was a native-confirmed implementation gap, so the fix was developed only on reusable branch `feat/agent-tab-context`.

Experimental fix:

```text
replaceText remains ONE semantic Agent Action
→ acquire focus on the observation-bound editable target using page pointer input
→ browser-native Control+A key sequence
→ Input.insertText replacement characters
```

The plan also rejects non-editable targets. Existing moving-target live-geometry protection remains applicable to the focus click. Modifier key description provides `KeyA` / Windows VK 65 for the Control+A sequence.

Contract/CI evidence for experimental head `dd661b0b0ac6bedf136de08e1e80e0f4563fc6c7`:

```text
JavaScript syntax                           PASS
Agent action + behavior contracts           PASS
CDP execution planner contract              PASS
CDP dispatcher contract                     PASS
one-action bridge contract                  PASS
full runtime-syntax workflow job            PASS
```

## `replaceText` — fixed and NATIVE PASS

Native re-test on `feat/agent-tab-context` used the same controlled page and semantic action:

```text
replaceText(targetRef=e0, text="NEW")
```

Observed plan:

```text
pointer trajectory to Replace Target
→ mousePressed / mouseReleased to acquire focus
→ rawKeyDown Control
→ rawKeyDown a { code:KeyA, windowsVirtualKeyCode:65, modifiers:2 }
→ keyUp a
→ keyUp Control
→ Input.insertText N
→ Input.insertText E
→ Input.insertText W
```

Native result:

```text
execution.ok = true
stepCount = resultCount = 20
before value = OLD
after value  = NEW
after.title = VALUE NEW EVENTS keydown,keydown,keyup,keyup,beforeinput,input,beforeinput,input,beforeinput,input
focusedRef remained e0
oneActionOnly = true
```

Classification:

```text
semantic OLD → NEW replacement             PASS
observation-bound target focus acquisition PASS
Control+A selection                         PASS
replacement insertion                       PASS
```

After native PASS + CI PASS, the planner/regression fix was selectively promoted to `main`; deferred Browser UI/OS work was not merged.

## Important keyboard event-fidelity observation

The same `replaceText` action demonstrates two distinct browser input mechanisms and therefore two distinct DOM-event signatures:

```text
Input.dispatchKeyEvent for Control+A
→ keydown / keydown / keyup / keyup

Input.insertText for N/E/W
→ beforeinput / input per inserted character
→ no keydown / keypress / keyup for those inserted characters
```

This confirms the earlier `typeText` fidelity result with stronger within-one-action evidence.

Engineering consequence:

```text
semantic keyboard action != one universal physical-key event model

Input.dispatchKeyEvent = key-like listener semantics
Input.insertText       = text insertion semantics
```

Do not infer physical keyboard fidelity merely because text is visually correct. If a future site/task requires keydown/keyup-sensitive text entry, implement/select a separate execution variant below Strategy rather than changing the semantic intent.

## Next existing capability to native-test

`clear` is already in Agent Action Contract and requires a targetRef. Test it on `main` before modifying implementation. Expected semantic behavior is to empty the selected editable target, not merely send an unbound key event to whichever element happens to be focused.
