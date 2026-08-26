# STATUS — 2026-08-26

## Source of truth

GitHub `banupham/extension_agent` is the implementation source of truth.

Before code changes:

```text
STATUS.md
→ docs/PROJECT_JOURNAL.md
→ current source/tests on main
```

Detailed native evidence is kept in `docs/PROJECT_JOURNAL.md` and focused appendices, including:

```text
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_BROWSER_UI_OS.md
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_CDP_NATIVE.md
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_AGENT_CURSOR.md
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_KEYBOARD_FIDELITY.md
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_CLEAR_NATIVE.md
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_MOVETO_NATIVE.md
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

Native-PASS functional evidence:

```text
tab inventory / matching
human keyword → exact tabId
OBSERVE semantic targets
basic click + visible effect
OBSERVE AFTER / invalidation
vertical scroll
hover
moveTo
horizontal scroll
doubleClick
focus
typeText
replaceText
clear
pressKey
modifier-aware keyCombo at PAGE_CDP/page-listener level
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

Do not create a branch per bug.

Controlled local tests reuse:

```text
http://127.0.0.1:8091
```

Change page content/state instead of allocating new ports.

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

## Target freshness / geometry

Observation-bound refs use TTL 4s and latest-observation rules. A newer observation on the same tab invalidates the old one. Before target-dependent pointer dispatch, Runtime re-reads live geometry and compares it with observed geometry using a 2px tolerance; geometry change causes `target_geometry_changed`, invalidates the observation and rejects rather than silently retargeting. The guard is also re-run immediately before `mousePressed`.

## Settled post-action observation

One-action bridge `0.2.1` uses bounded semantic settling:

```text
observe immediately
→ poll every 80ms
→ minimum window 400ms
→ stop after semantic snapshot stable for >= 2 samples
→ maximum deadline 800ms
```

Native dynamic UI re-test captured `DYNAMIC READY` and `Dynamic Child` inside the same one-action result.

## Keyboard/input fidelity

Native evidence:

```text
typeText via Input.insertText
→ beforeinput / input
→ no keydown / keypress / keyup for inserted characters

replaceText
→ observation-bound pointer focus
→ Control+A via Input.dispatchKeyEvent produces keydown/keyup
→ replacement characters via Input.insertText produce beforeinput/input
→ OLD → NEW PASS

clear
→ observation-bound pointer focus
→ Control+A via Input.dispatchKeyEvent
→ Backspace via Input.dispatchKeyEvent
→ target OLD → empty
→ non-target Distractor KEEP → KEEP
→ PASS
```

Conclusion:

```text
Input.dispatchKeyEvent = key-like listener semantics
Input.insertText       = text insertion semantics
```

Visual text success is not proof of physical keyboard listener fidelity. Any future keydown/keyup-sensitive typing path should be a separate execution variant below Strategy.

## PAGE_CDP modifier boundary

Modifier-aware `keyCombo` is native PASS for webpage listeners. `Alt+ArrowLeft` delivered real modifier-aware CDP events to page JavaScript, but PAGE_CDP did not trigger Chrome/GPM browser-shell Back. Do not keep tuning PAGE_CDP to impersonate browser chrome shortcuts.

## Agent Cursor V0.1

Promoted to `main` after native PASS:

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
execution/outcome preserved                   PASS
```

Cursor readability refinement is presentation-only and must not alter real CDP timing.

## Pointer trajectory diversity

Repeated native `moveTo` tests reached the same semantic target successfully while producing visibly different pointer trajectories between runs. This is consistent with randomized target acquisition / path generation and the no-literal-trajectory-replay policy.

This is functional diversity evidence only; it is not a natural-behavior quality PASS.

---

# Browser UI / OS control — DEFERRED

Experimental work on `feat/agent-tab-context` proved:

```text
Win32 SendInput Alt+Left                    PASS with foreground/focus
Windows UI Automation + real mouse Back     PASS
Windows UI Automation + real mouse Forward  PASS
```

Current decision:

```text
DO NOT integrate BROWSER_UI_OS into Agent Runtime now.
Keep evidence/code for later advanced tasks.
Continue CDP/webpage validation on main.
```

Any future OS-control integration must require explicit consent before taking temporary control of the real Windows keyboard/mouse and must use an exclusive desktop-input lease.

---

# NEXT — `scrollIntoView` native validation

`scrollIntoView` already exists in Agent Action Contract and requires `targetRef`.

Test current implementation on `main` before modifying it.

Expected semantic behavior:

```text
OBSERVE target outside current viewport
→ scrollIntoView(targetRef)
→ target becomes visible / reachable
→ no click
→ no arbitrary selector/coordinate from Strategy
→ OBSERVE AFTER confirms target geometry in viewport
```

Because current metadata mentions DOM/Runtime-style primitives while the Runtime execution allowlist is intentionally narrow, this test may expose an existing implementation gap. Do not add or alter capability until native evidence confirms failure.

After `scrollIntoView`, continue existing actions such as:

```text
drag
selectOption / setChecked / submit / dismiss
multi-frame observation
```

No autonomous multi-step work yet.

---

# Known later fidelity/robustness gates

```text
focus primitive metadata cleanup
multi-frame Agent observation
physical-key-like text-entry variant only if a real task requires listener fidelity
pointer naturalness refinement
```

---

# Safety / privacy

CAPTCHA/human verification remains blocked; no automatic solve/bypass/blind retry. Never collect/train credential/password/cookie/token/clipboard/payment-secret content.
