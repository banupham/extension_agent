# AGENT EXECUTION SURFACES

Status: production boundary on `main` after Agent consolidation, 2026-08-28.

Strategy chooses semantic **WHAT**. Execution policy chooses where/how the already-selected action is executed. `main` intentionally exposes only execution surfaces that do not own shared Windows desktop input.

## 1. PAGE_CDP

Purpose: webpage-renderer interaction.

Examples:

```text
click / doubleClick / hover / moveTo / drag
focus / typeText / replaceText / clear
scrollVertical / scrollHorizontal / scrollIntoView
forms / media / page-level keyboard
```

Primary mechanisms are allowlisted CDP primitives such as `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Input.insertText`, DOM/runtime focus helpers and narrow planners.

Properties:

```text
semantic targetRef
no raw selector/coordinate from Strategy
no Windows foreground requirement
no ownership of physical mouse/keyboard
supports follow-live target tracking below Strategy
```

## 2. BROWSER_NATIVE

Purpose: deterministic browser/tab/navigation control without interacting with visible browser chrome.

Default actions:

```text
navigate
back
forward
reload
switchTab
openNewTab
closeTab
```

Primary mechanisms:

```text
CDP Page domain
chrome.tabs.* / browser control-plane APIs
```

Tab lifecycle targeting is semantic. Strategy may use title/url match metadata; runtime resolves that to live tab identity internally. Raw `tabId` / `windowId` remain below Strategy.

## 3. Browser UI / OS is external to main Agent

The following subsystem is deliberately **not** an Agent execution surface on `main`:

```text
Browser UI / OS Control
→ Windows UI Automation
→ Win32 SendInput
→ real shared Windows pointer/keyboard ownership
→ visible browser chrome/tab-strip controls
```

Historical probes demonstrated feasibility, but this mechanism has a distinct consent/concurrency boundary and can seize shared desktop input. It therefore remains on the experimental branch:

```text
feat/agent-tab-context
```

`main` does not include the Browser UI/OS spike executables and `selectExecutionSurface(..., { browserUiRequired: true })` fails closed with:

```text
browser_ui_os_external_to_main_agent
```

There is no silent escalation from PAGE_CDP/BROWSER_NATIVE to OS input.

## 4. Main selection policy

```text
webpage semantic action
→ PAGE_CDP

browser/tab/navigation semantic action
→ BROWSER_NATIVE

request requiring visible browser chrome / physical Windows input
→ outside current main Agent boundary
```

Hard invariants:

```text
Strategy never emits selector / raw screen coordinates / CDP packet / HWND.
Strategy never emits raw tabId / windowId.
Execution policy does not change task intent.
No OS physical-input fallback exists in main Agent.
Outcome is verified after execution before bounded replan/recovery continues.
```

See `docs/MAIN_INTEGRATION_2026-08-28.md` for the selective merge manifest and `docs/TAB_LIFECYCLE_AGENT_INTEGRATION_2026-08-28.md` for browser-native tab lifecycle evidence.
