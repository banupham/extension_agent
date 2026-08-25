# Agent CDP Executor Gap Map

## Purpose

Track the gap between the semantic Agent Action Contract and the current experimental Agent Runtime Extension.

This is not a request to collapse Strategy into automation primitives.

```text
Brain / Strategy
→ Agent Action + targetRef
→ Behavior Policy
→ CDP Plan
→ Executor
```

The deterministic `ACTION_CONTRACT.json` remains separate.

## Current runtime reality

`control-center/extension/agent-runtime-extension/background.js` currently executes only a small subset directly:

```text
openUrl  → Page.navigate
pressKey → Input.dispatchKeyEvent
type     → Input.insertText
```

The Agent semantic contract is much wider. Runtime expansion should follow the priorities below.

## P0 — required before meaningful Agent practice

### 1. Observation target registry

Most important missing capability.

```text
Observation
→ observationId
→ targetRef
→ tab/frame/document context
→ current rect / semantic descriptor
→ resolvable CDP node/runtime handle
```

The Brain must be able to say:

```json
{"type":"click","targetRef":"e17"}
```

without emitting selector or coordinates. Executor/CDP planner owns resolution from `targetRef` to the current browser-native target.

Refs are observation/page scoped; stale refs must fail explicitly and trigger re-observation rather than silently clicking old coordinates.

### 2. Pointer primitive

Needed actions:

```text
moveTo
hover
click
doubleClick
```

CDP:

```text
Input.dispatchMouseEvent(mouseMoved)
Input.dispatchMouseEvent(mousePressed)
Input.dispatchMouseEvent(mouseReleased)
```

Behavior Policy supplies trajectory/timing; Executor only dispatches the plan.

### 3. Scroll primitive

Needed:

```text
scrollVertical
scrollHorizontal
```

CDP `mouseWheel` with deltaY/deltaX. Keep horizontal and vertical behavior families separate because human demonstrations show different burst structures.

### 4. Focus + text execution

Needed:

```text
focus
typeText
replaceText
clear
pressKey
keyCombo
```

Task/Strategy supplies intended text. Human training data supplies timing/rhythm only; never reconstruct human credential/printable content.

### 5. Basic navigation

Needed:

```text
navigate
back
forward
reload
```

Use `Page.navigate`, navigation history and `Page.reload`.

## P1 — required for richer real-world tasks

```text
drag
scrollIntoView
selectOption
setChecked
toggle
submit
dismiss
switchTab
openNewTab
closeTab
waitAndObserve
hoverAndObserve
```

`drag` is especially important for sliders, seek bars and volume controls and now has a derived Action Window family from human pointer down→move→up data.

`dismiss`, `toggle`, play/pause/mute/unmute should normally compile to semantic target actions rather than each becoming a new low-level CDP mechanism.

## P2 — candidates; do not add to core contract without evidence

Potential future semantic actions:

```text
contextClick
pressAndHold
openLinkInNewTab
selectText
uploadFile
```

Notes:

- `contextClick` / `pressAndHold`: add only after demonstrations or concrete Agent tasks require them.
- `openLinkInNewTab`: may compile to modifier-click or tab+navigate; avoid duplicate semantics prematurely.
- `uploadFile`: requires explicit user/task authorization and a safe file contract; do not infer local file paths.
- clipboard content is not a training signal and should not be introduced to bypass the privacy boundary.

## Media actions are semantic compositions

```text
play / pause / mute / unmute
→ identify semantic control
→ pointer-click behavior
→ CDP mouse plan

setVolume / seek
→ identify slider
→ pointer-drag behavior
→ CDP mouse plan
```

Do not add site-specific YouTube/TikTok executor methods.

## Failure contract

Executor must distinguish:

```text
stale_target_ref
target_not_interactable
target_out_of_view
frame_unavailable
cdp_dispatch_failed
navigation_interrupted
```

A stale/failed target should cause re-observation/replan, not blind retries.

## Build order

```text
A1 derive clean human Action Windows
→ A2 behavior features
→ A3 empirical behavior baseline
→ P0 executor expansion
→ A4 one-action Agent bridge
```

P0 target registry can be designed before A4, but Behavior/Strategy boundaries must remain unchanged.
