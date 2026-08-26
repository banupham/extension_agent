# STATUS — 2026-08-26

## Source of truth

GitHub `banupham/extension_agent` is the implementation source of truth.

Before code changes:

```text
STATUS.md
→ docs/PROJECT_JOURNAL.md
→ current source/tests on main
```

Detailed historical/native evidence lives in `docs/PROJECT_JOURNAL.md` plus focused appendices:

```text
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_BROWSER_UI_OS.md
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_CDP_NATIVE.md
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_AGENT_CURSOR.md
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_KEYBOARD_FIDELITY.md
```

---

# CURRENT FOCUS — finish existing CDP / webpage native validation

```text
A0 Agent/Behavior contracts        COMPLETE
A1 Action Window 0.1.4             COMPLETE
A2 Behavior Feature 0.2.0          COMPLETE
A3 Empirical baseline contract     READY
P0 Agent Runtime                   CORE FUNCTION MATRIX NATIVE PASS
A4 One-action bridge               CORE FUNCTION MATRIX NATIVE PASS
A5 Goal Checker + Replan           NOT STARTED
Autonomous multi-step              NOT STARTED
```

Collector V0.8 transport/capture gate is complete and only needs stability/regression support.

Native-PASS functional evidence already established:

```text
tab inventory / matching
human keyword → exact tabId
OBSERVE semantic targets
basic click + visible effect
OBSERVE AFTER / invalidation
vertical scroll
hover
horizontal scroll
doubleClick
focus
typeText
replaceText
pressKey
modifier-aware keyCombo at PAGE_CDP/page listener level
navigate
reload
back history-CDP
forward history-CDP
stale-ref rejection after newer observation
moving-target live-geometry rejection before pointer click
post-action settled semantic observation for delayed dynamic UI
Agent Cursor V0.1 hover/click visualization + Observer isolation
```

Functional Agent PASS != Brain-quality PASS != natural-behavior PASS.

---

# Development / branch rule

Test existing functionality on `main` first.

```text
main
→ native test existing function
→ PASS: record evidence and continue
→ FAIL due implementation: use reusable experiment branch
→ fix + contract/CI + native re-test
→ merge only native-PASS fix
```

Reusable experiment branch only:

```text
feat/agent-tab-context
```

Do not create a new branch per bug.

Future controlled local tests should reuse one base surface:

```text
http://127.0.0.1:8091
```

Change test page content/state instead of allocating a new port for each test.

---

# Current execution boundary

```text
TASK
→ BROWSER CONTEXT / TAB INVENTORY
→ OBSERVER
→ STRATEGY / BRAIN
→ AGENT ACTION CONTRACT        = WHAT
→ EXECUTION BEHAVIOR CONTRACT = HOW naturally / allowed variant
→ CDP EXECUTION PLAN           = exact page/browser-native plan
→ AGENT RUNTIME EXTENSION      = dispatch + narrow runtime binding
→ CHROME
→ SETTLED OBSERVE AFTER
→ GOAL CHECK / REPLAN
```

Hard invariant:

```text
Strategy does NOT emit selector / coordinate / CDP packet.
Behavior does NOT choose task intent.
Executor does NOT choose strategy.
```

`tabId` remains internal execution identity.

---

# CDP / Runtime baseline

Planner emits:

```text
cdpPlanVersion = 0.1.2
```

Runtime dispatcher accepts:

```text
0.1.0
0.1.1
0.1.2
```

Allowlisted EXECUTE_PLAN methods:

```text
Input.dispatchMouseEvent
Input.dispatchKeyEvent
Input.insertText
Page.navigate
Page.reload
Page.getNavigationHistory
Page.navigateToHistoryEntry
```

No arbitrary raw-CDP tunnel from Brain.

Keyboard/input fidelity evidence:

```text
typeText via Input.insertText
→ beforeinput / input
→ no keydown / keypress / keyup for inserted characters

replaceText
→ observation-bound pointer focus
→ Control+A via Input.dispatchKeyEvent produces keydown/keyup
→ replacement characters via Input.insertText produce beforeinput/input
→ OLD → NEW native PASS
```

Conclusion:

```text
Input.dispatchKeyEvent = key-like listener semantics
Input.insertText       = text insertion semantics
```

Do not treat visual text success as proof of physical keyboard listener fidelity. A future keydown/keyup-sensitive typing path should be a separate execution variant below Strategy.

Modifier-aware `keyCombo` evidence promoted to `main`:

```text
Alt+ArrowLeft PAGE_CDP plan:
rawKeyDown Alt
→ rawKeyDown ArrowLeft modifiers=Alt
→ keyUp ArrowLeft
→ keyUp Alt

page JavaScript listener received Alt+ArrowLeft = PASS
```

Boundary evidence:

```text
PAGE_CDP Input.dispatchKeyEvent can deliver modifier combinations to webpage listeners.
It did NOT trigger Chrome/GPM browser-shell Back/Forward accelerators.
Do not keep tuning PAGE_CDP to impersonate browser chrome shortcuts.
```

`navigate`, `reload`, stale-ref rejection, moving-target live-geometry guard, post-action settled observation and Agent Cursor V0.1 are all native PASS on `main`; detailed evidence is kept in the appendices listed above.

Agent Cursor V0.1 invariant:

```text
PAGE_CDP Input.dispatchMouseEvent = source of truth
→ fire-and-forget mirror telemetry
→ viewport-sized closed-Shadow-DOM overlay
→ pointer-events:none
```

Any cursor readability refinement is presentation-only and must not alter real CDP timing.

Known later fidelity/robustness gates:

```text
focus primitive metadata cleanup
multi-frame Agent observation
physical-key-like text-entry variant only if a real task requires listener fidelity
```

---

# Browser UI / OS control — DEFERRED

Experimental work on `feat/agent-tab-context` proved that browser chrome can be controlled through Windows-level mechanisms:

```text
Win32 SendInput Alt+Left                    PASS with foreground/focus
Windows UI Automation + real mouse Back     PASS
Windows UI Automation + real mouse Forward  PASS
```

Current decision:

```text
DO NOT integrate BROWSER_UI_OS into Agent Runtime now.
Keep the experimental evidence/code for later advanced tasks.
Continue CDP/webpage functional/fidelity validation on main.
```

Any future OS-control integration must require explicit consent before taking temporary control of the real Windows keyboard/mouse and must use an exclusive desktop-input lease.

---

# NEXT — clear action native validation

`clear` already exists in Agent Action Contract and requires `targetRef`.

Test current implementation on `main` before modifying it.

Expected semantic behavior:

```text
editable target with value OLD
→ semantic clear(targetRef)
→ selected target becomes empty
```

The test must verify the action clears the observation-bound target rather than depending on whichever element happens to be focused.

After `clear`, continue existing actions such as:

```text
moveTo
scrollIntoView
drag
form controls
multi-frame observation
```

No autonomous multi-step work yet.

---

# P1 / later

```text
drag / slider / seek
scrollIntoView
selectOption / setChecked / submit / dismiss
tab lifecycle through Agent bridge
hoverAndObserve / waitAndObserve policy
multi-frame targets
pointer naturalness refinement
BROWSER_UI_OS Runtime/Native-Host integration
```

---

# Safety / privacy

CAPTCHA/human verification remains blocked; no automatic solve/bypass/blind retry. Never collect/train credential/password/cookie/token/clipboard/payment-secret content.
