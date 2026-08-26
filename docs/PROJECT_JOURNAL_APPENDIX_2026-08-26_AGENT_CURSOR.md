# PROJECT JOURNAL APPENDIX — Agent Cursor Debug Overlay

Date: 2026-08-26
Status: FUNCTIONAL NATIVE PASS / CI PASS ON EXPERIMENTAL BRANCH / PROMOTED TO MAIN

## Purpose

Expose the PAGE_CDP pointer trajectory for debugging without moving the real Windows pointer and without changing Agent intent, target selection, Behavior timing, CDP coordinates, or execution result.

Invariant:

```text
Input.dispatchMouseEvent = source of truth
→ mirror telemetry only
→ Agent Cursor overlay

Overlay never:
- generates input
- chooses or retargets a target
- changes coordinates
- changes delays / trajectory
- participates in Brain / Behavior / replan
```

## Implementation

Agent Runtime manifest uses:

```text
agent_runtime_debug_background.js
→ installs agent_cursor_mirror.js
→ imports background.js unchanged
```

Only successful `Input.dispatchMouseEvent` events of type `mouseMoved`, `mousePressed`, and `mouseReleased` are mirrored. Delivery is fire-and-forget through `queueMicrotask` + `chrome.tabs.sendMessage`; execution never waits for debug rendering.

`agent_cursor_overlay.js` is a top-frame content script for HTTP/HTTPS. It renders a non-interactive viewport-sized host with closed Shadow DOM and `pointer-events:none`. It does not listen to physical user mouse events.

The first native attempt rendered nothing because a 0x0 host combined with paint containment clipped the cursor. The fix changed the host to `inset:0`, `100vw × 100vh` and removed paint containment.

## Native evidence

```text
hover trajectory visualization                         PASS
click DOWN / UP visualization                          PASS
physical Windows pointer remains independent           PASS
Observer isolation                                     PASS
click execution preserved                              PASS
settled semantic outcome capture preserved             PASS
```

Hover native evidence:

```text
action = hover
Input.dispatchMouseEvent trajectory
execution.ok = true
stepCount = resultCount = 11
visible AGENT cursor rendered on Open Dynamic Panel
```

Observer isolation evidence:

```text
Agent Cursor visibly rendered
→ agentObserve interactiveElements still contained only real page controls
→ overlay host/AGENT label did not become a semantic target
```

Click native evidence:

```text
11 x mouseMoved
→ mousePressed
→ mouseReleased
execution.ok = true
stepCount = resultCount = 13
AGENT · DOWN visible
AGENT · UP visible
after.title = DYNAMIC READY
Dynamic Child included in after.interactiveElements
```

The DOWN/UP visual transition is intentionally fast because it mirrors current real CDP timing. Do not increase actual mouse hold merely for debug readability; any future readability refinement must be presentation-only.

## Promotion decision

Agent Cursor V0.1 is functional debug observability, not execution authority. After native PASS it was promoted selectively to `main`. Browser UI/OS experimental Runtime integration remains deferred and was not promoted with this work.
