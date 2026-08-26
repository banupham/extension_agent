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

`pressKey` native evidence on `main`:

```text
Input.dispatchKeyEvent keyDown Enter
→ Input.dispatchKeyEvent keyUp Enter
execution.ok = true
stepCount = resultCount = 2
before.title = PressKey Test
after.title  = PRESSKEY PASS
```

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

`navigate` native evidence on `main`:

```text
Page.navigate → http://127.0.0.1:8091/target
execution.ok = true
stepCount = resultCount = 1
before.url/title = / / Navigate Start
after.url/title  = /target / NAVIGATE PASS
```

Additional external HTTPS smoke navigation reached the requested URL with `execution.ok = true`. This is navigation evidence only; it is NOT evidence of stealth, bot-detection bypass, or platform acceptance.

`reload` native evidence on `main`:

```text
Page.reload { ignoreCache:false }
execution.ok = true
stepCount = resultCount = 1
observationInvalidated = true
before.url/title = /reload / Reload 1
after.url/title  = /reload / Reload 2
```

`stale-ref` native evidence on `main`:

```text
OBSERVE #1 → semantic click action → Behavior → CDP plan
OBSERVE #2 injected before execute
execute with observationId #1
→ stale_observation
→ no pointer event dispatched
browser remained NOT CLICKED
```

`moving-target` current Runtime behavior:

```text
resolve observation-bound target
→ read live element geometry immediately before target-dependent dispatch
→ compare observed/live rect with 2px tolerance
→ re-check before mousePressed
→ if geometry changed: target_geometry_changed
→ invalidate observation
→ REJECT; do not silent-retarget
```

Native re-test:

```text
target moved x=40 → x=380
expected = target_geometry_changed
actual   = target_geometry_changed
neither old-position trap nor moved target was clicked
```

One-action bridge `0.2.1` bounded semantic settling:

```text
observe immediately after execution
→ poll every 80ms
→ minimum observation window 400ms
→ stop after semantic snapshot is stable for >= 2 samples
→ maximum deadline 800ms
```

Native dynamic-outcome re-test:

```text
bridgeVersion = 0.2.1
execution.ok = true
after.title = DYNAMIC READY
after.interactiveElements includes Dynamic Child
postActionObservation.mode = settled
samples = 6
waitedMs = 400
semanticChanged = true
stableSamples = 3
deadlineReached = false
oneActionOnly = true
```

Agent Cursor V0.1 is promoted to `main` after native PASS:

```text
PAGE_CDP Input.dispatchMouseEvent = source of truth
→ fire-and-forget mirror telemetry
→ viewport-sized closed-Shadow-DOM overlay
→ pointer-events:none
```

Native gates:

```text
hover AGENT cursor visualization              PASS
click AGENT · DOWN / AGENT · UP               PASS
physical Windows pointer remains independent  PASS
Observer does not expose overlay as target     PASS
click execution preserved                     PASS
settled Dynamic Child outcome preserved        PASS
```

Any cursor readability refinement is presentation-only and must not alter real CDP timing.

Known later fidelity/robustness gates:

```text
Input.insertText physical-key/listener fidelity
focus primitive metadata cleanup
multi-frame Agent observation
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

# NEXT — Input.insertText listener fidelity

Test the existing `typeText` implementation without adding a new capability.

Question to answer empirically:

```text
Input.insertText
→ input/beforeinput events only?
→ or keydown/keypress/keyup too?
```

This is a fidelity classification gate, not a typing-success gate: visual text insertion already PASSes.

After this, continue:

```text
focus primitive metadata cleanup
multi-frame Agent observation
then remaining P1 actions as useful
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
