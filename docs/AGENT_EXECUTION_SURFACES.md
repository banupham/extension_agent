# AGENT EXECUTION SURFACES

Status: experimental architecture validated by native browser-UI probes on 2026-08-26.

This document defines where an Agent action may execute. It does not change the semantic Agent Action vocabulary: Strategy still chooses WHAT; execution policy chooses WHERE/HOW.

---

# 1. Core rule

```text
TASK
→ Browser Context / Observation
→ Strategy chooses semantic Agent Action = WHAT
→ Execution Policy chooses surface + variant
→ Behavior chooses HOW naturally inside that variant
→ Surface-specific Planner
→ Surface-specific Executor
→ Outcome observation / verification
```

Hard invariants:

```text
Strategy never emits selector / screen coordinate / CDP packet / HWND.
Execution surface selection must not change task intent.
UI Automation bounds and OS coordinates are internal execution data only.
Executor dispatches an already-selected variant; it does not choose strategy.
```

Use the lowest/least-exclusive surface that can correctly satisfy the semantic action. Do not escalate to OS control merely to imitate a user when a deterministic lower surface already satisfies the task.

---

# 2. Surface 1 — PAGE_CDP

Purpose: interaction inside webpage renderer/content.

Examples:

```text
click / doubleClick / hover
focus / typeText
scrollVertical / scrollHorizontal
page-level keyCombo
forms / media controls when represented by page semantics
```

Primary mechanisms:

```text
Input.dispatchMouseEvent
Input.dispatchKeyEvent
Input.insertText
```

Properties:

```text
exact tabId/frame context
no Windows foreground requirement
no ownership of physical mouse/keyboard
multiple tabs/browsers can be targeted independently by Agent runtime
OS cursor may remain stationary, therefore optional Agent Cursor overlay is telemetry only
```

Native evidence already shows page-level `Alt+ArrowLeft` can be delivered correctly to a page listener after modifier-aware keyCombo support; the same page-CDP events do not activate the browser-shell Back accelerator.

---

# 3. Surface 2 — BROWSER_NATIVE

Purpose: deterministic browser/tab/window/navigation control that does not require interaction with visible browser chrome.

Examples:

```text
back / forward history navigation
navigate / reload
list/switch tabs through browser control plane
open/close tab where Agent bridge supports it
```

Primary mechanisms:

```text
CDP Page domain
chrome.tabs.* / browser control-plane APIs
narrow runtime bindings where a result from one browser command is required by the next
```

Properties:

```text
semantic browser operation
exact browser/tab identity
no physical cursor ownership
no foreground requirement in the normal path
more deterministic than browser-toolbar clicking
can retain multi-browser/multi-tab concurrency
```

Native-validated example:

```text
back
Page.getNavigationHistory
→ Page.navigateToHistoryEntry(historyOffset=-1)

forward
Page.getNavigationHistory
→ Page.navigateToHistoryEntry(historyOffset=+1)
```

For a semantic `back`, this is currently the preferred default variant because it is deterministic and does not consume shared desktop input.

---

# 4. Surface 3 — BROWSER_UI_OS

Purpose: visible browser chrome / desktop interaction that lower browser/page surfaces cannot perform, or when an explicitly physical browser-UI execution variant is required.

Examples:

```text
browser Back / Forward toolbar buttons
address bar interaction
browser menus
extension toolbar controls
other Chromium/GPM chrome controls exposed through Windows UI Automation
```

Discovery:

```text
Windows UI Automation
→ semantic control name / role / enabled state
→ internal bounding rectangle
```

Physical execution:

```text
Win32 SendInput keyboard
or
GetCursorPos
→ multi-step physical mouse trajectory
→ LEFTDOWN
→ hold
→ LEFTUP
```

Do not hard-code screen coordinates when UI Automation can provide semantic control bounds.

## Mandatory control lease

`BROWSER_UI_OS` consumes shared Windows desktop input. It therefore requires an explicit exclusive control lease before execution.

Conceptual lease:

```text
surface = browser-ui-os
exclusiveInput = true
inputChannels = pointer | keyboard | both
targetWindow = resolved GPM/Chromium top-level window
consentRequired = true
leaseOwner = one Agent execution stream
```

Required flow:

```text
preflight explains target + mechanism + real OS input
→ user explicitly consents
→ acquire exclusive desktop-input lease
→ foreground the resolved browser window if required
→ discover target through UI Automation
→ execute physical input
→ verify outcome
→ release lease on success OR error
```

While the lease is held, the Agent must not dispatch another OS keyboard/mouse stream to a different browser/window. The user should also avoid using mouse/keyboard in another application during the short execution window.

Important concurrency rule:

```text
PAGE_CDP / BROWSER_NATIVE
→ can continue to model multiple browser/tab targets independently

BROWSER_UI_OS
→ one physical desktop-input owner at a time per Windows desktop/session
```

This does NOT mean the Agent can only manage one browser. It means only one browser/window can receive the physical shared mouse/keyboard stream at a given moment.

---

# 5. Native evidence for BROWSER_UI_OS

Controlled local surface stays on:

```text
http://127.0.0.1:8091
```

Test content/state changes; the port should not change for each test.

Observed boundary evidence:

```text
page-CDP modifier-aware Alt+Left
→ page listener receives Alt+Left                    PASS
→ browser-shell history navigation                  NOT triggered

Win32 SendInput Alt+Left with GPM foreground
→ browser Back                                      PASS

Windows UI Automation locate browser Back/Forward
+ Win32 physical pointer trajectory/down/up
→ Back                                               PASS
→ Forward                                            PASS
```

OS-keyboard variant has a foreground/focus constraint: the target GPM window must own the browser-level input path.

Pointer variant evidence:

```text
semantic control discovery = Windows.UIAutomation
visible real Windows cursor movement
multi-step curved trajectory
real LEFTDOWN / hold / LEFTUP
browser toolbar action succeeded
```

Human visual assessment of the current pointer probe: approximately 90% acceptable movement quality. The remaining ~10% naturalness is a Behavior-quality task, not a functional Browser-UI executor failure.

The current smoothstep/curve timing is validation scaffolding. It must not become a permanent hard-coded human model. Future naturalness work should sample context-conditioned timing/trajectory constraints from the Behavior dataset while preserving semantic target bounds, consent and the exclusive control lease.

---

# 6. Execution-surface selection policy

Default priority:

```text
1 PAGE_CDP       when the action is a webpage interaction
2 BROWSER_NATIVE when the intent is browser/tab/navigation control
3 BROWSER_UI_OS  only when visible browser chrome / OS input is required
```

Example — semantic action `back`:

```text
Agent Action: back

preferred default:
BROWSER_NATIVE / history-CDP

physical keyboard variant when explicitly justified:
BROWSER_UI_OS / Win32 SendInput Alt+Left

physical toolbar variant when explicitly justified:
BROWSER_UI_OS / UIA Back button + real Windows mouse click
```

All three variants preserve the same semantic intent. Strategy does not need to know which physical mechanism was selected.

Do not silently fall through multiple variants after an uncertain outcome. A failed/ambiguous execution should produce evidence for outcome checking/replanning rather than blindly issuing another physical variant.

---

# 7. Runtime integration direction

The native probes prove feasibility, but `BROWSER_UI_OS` is still an experimental harness and is not yet a first-class Agent Runtime surface.

Integration should add a surface planner/executor boundary rather than widening raw CDP or exposing arbitrary OS commands.

Target architecture:

```text
Agent Action
→ Execution Surface Policy
   ├─ PAGE_CDP
   │   → CDP Planner → Agent Runtime Extension
   ├─ BROWSER_NATIVE
   │   → Browser-native Planner → Agent Runtime/control plane
   └─ BROWSER_UI_OS
       → consent + exclusive control lease
       → UIA Observer
       → OS Behavior Plan
       → allowlisted Native Host / OS Executor
```

The OS executor should expose narrow allowlisted semantic operations/physical primitives only. Do not expose arbitrary PowerShell, arbitrary process execution, raw HWND manipulation or unrestricted OS scripting to Strategy.

---

# 8. Current next step

Before Agent Cursor observability work, formalize the execution-surface policy and control-lease contract around the already native-PASS browser-UI probes.

Then resume remaining functional/invariant gates and later Behavior-naturalness work separately.
