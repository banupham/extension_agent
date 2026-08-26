# STATUS — 2026-08-26

## Source of truth

GitHub `banupham/extension_agent` is the implementation source of truth.

Before code changes:

```text
STATUS.md
→ docs/PROJECT_JOURNAL.md / focused appendices
→ current source/tests on main
```

Recent focused evidence includes:

```text
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_CDP_NATIVE.md
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_AGENT_CURSOR.md
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_KEYBOARD_FIDELITY.md
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_CLEAR_NATIVE.md
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_MOVETO_NATIVE.md
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_SCROLLINTOVIEW_NATIVE.md
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_DRAG_BATCH.md
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_FORMS_BATCH.md
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_OBSERVATION_UI_BATCH.md
```

---

# CURRENT FOCUS — batch native validation of remaining existing Agent Actions

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

Functional Agent PASS != Brain-quality PASS != natural-behavior PASS.

## Native-PASS functional matrix

```text
tab inventory / matching
human keyword → exact tabId
OBSERVE semantic targets
basic click + visible effect
OBSERVE AFTER / invalidation
vertical scroll
horizontal scroll
scrollIntoView
hover
moveTo
doubleClick
drag with semantic source + destination refs
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
setChecked
selectOption
toggle
submit
dismiss
hoverAndObserve
waitAndObserve
stale-ref rejection after newer observation
moving-target live-geometry rejection before pointer click
drag destination live-geometry rejection before release
form target-state rejection when observed checkbox/select state changes
post-action settled semantic observation for delayed dynamic UI
Agent Cursor V0.1 pointer visualization + Observer isolation
```

Forms batch is **4/4 native PASS**:

```text
setChecked
selectOption
toggle
submit
```

`setChecked` and `selectOption` were first native-confirmed unsupported, then fixed on `feat/agent-tab-context`, CI-passed, native re-tested, and selectively promoted to `main`. Their PAGE_CDP pointer phases were also visually confirmed through Agent Cursor after reloading the Runtime extension.

Observation / UI batch is **3/3 native PASS**:

```text
dismiss
hoverAndObserve
waitAndObserve
```

`waitAndObserve` was first native-confirmed unsupported. It is now an observation-only action with a zero-input plan and bounded semantic polling. A deliberate ~5-second delayed semantic-change gate exposed the original 800ms deadline as too short; the dedicated wait budget is now 6000ms and native retest PASSed before deadline.

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

Reusable experiment branch:

```text
feat/agent-tab-context
```

Do not merge the whole experimental branch blindly. Selectively promote only native-proven code/tests. Browser UI/OS experiments remain deferred.

Controlled local tests reuse one fixed surface:

```text
http://127.0.0.1:8091
```

Batch test mode is allowed for speed, but each gate remains one semantic Agent Action followed by execution + observation. This is not autonomous multi-step.

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

Runtime dispatcher accepts:

```text
0.1.0
0.1.1
0.1.2
0.1.3
```

`0.1.3` is currently required by semantic drag and observation-only `waitAndObserve`. Other existing planners may still emit compatible earlier versions.

Allowlisted EXECUTE_PLAN methods remain:

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

## Observation-bound target safety

Observation refs use TTL 4s and latest-observation rules. A newer observation invalidates the old one.

Target-dependent actions use narrow Runtime binding. Runtime re-reads live geometry and rejects `target_geometry_changed` instead of silently retargeting. Pointer actions re-check immediately before press where applicable. Drag additionally validates destination geometry before execution and immediately before release.

Forms add narrow observed state binding:

```text
checkbox/radio → inputType + checked
select         → selectedValue + selectedIndex + option metadata
```

No text/password input values are exposed for this feature. If bound check/select state or option structure changes after OBSERVE, Runtime rejects `target_state_changed`.

## Forms execution

```text
setChecked
→ if state already equals requested value: no toggle
→ otherwise observation-bound PAGE_CDP click

selectOption
→ resolve requested semantic option from observed option metadata
→ PAGE_CDP pointer acquire/focus
→ Input.dispatchKeyEvent Home / ArrowDown / Enter
```

Strategy still emits no selector, coordinate, or raw CDP packet.

## Settled post-action observation

Ordinary one-action bridge `0.2.1` semantic settling remains:

```text
poll every 80ms
minimum window 400ms
semantic stability >= 2 samples
maximum deadline 800ms
```

`waitAndObserve` is intentionally different because waiting is the semantic action itself:

```text
plan steps = []
poll every 80ms
minimum window 400ms
require semantic change
semantic stability >= 2 samples
maximum deadline 6000ms
```

The 6000ms budget is execution policy below Strategy; the Agent Action does not encode test-page timing.

## Keyboard/input fidelity

```text
Input.dispatchKeyEvent = key-like listener semantics
Input.insertText       = text insertion semantics
```

`typeText` via `Input.insertText` provides `beforeinput/input`, not physical-key listener fidelity. Physical-key-like typing remains a future execution variant only if a real task requires it.

## Agent Cursor V0.1

PAGE_CDP `Input.dispatchMouseEvent` is the source of truth for the debug cursor mirror. The overlay is telemetry only, `pointer-events:none`, isolated from Observer, and must never change execution timing.

Repeated `moveTo` and other pointer tests show non-identical trajectories. This is functional diversity evidence, not natural-behavior quality PASS. Naturalness refinements remain Behavior-learning work.

---

# Browser UI / OS control — DEFERRED

Experimental evidence retained on `feat/agent-tab-context` includes Win32/Windows-UIA browser-shell control probes. Do not integrate BROWSER_UI_OS into Runtime during this PAGE_CDP functional phase.

Any future OS-control integration requires explicit user consent and an exclusive desktop-input lease.

---

# NEXT — Media batch

Run existing capabilities first on the fixed `8091` batch lab:

```text
play
pause
mute
unmute
setVolume
seek
changePlaybackRate
```

For every action:

```text
existing capability PASS → record evidence
existing capability FAIL → classify exact native gap
only then fix on feat/agent-tab-context
```

After Media, continue:

```text
multi-frame observation
tab lifecycle: switchTab / openNewTab / closeTab
```

No autonomous multi-step work yet.

---

# Known later fidelity / robustness gates

```text
focus primitive metadata cleanup
physical-key-like text-entry variant only if a real task requires listener fidelity
pointer/scroll/drag naturalness refinement through Behavior learning
Browser UI/OS integration when an actual shell-control task requires it
```

---

# Safety / privacy

CAPTCHA/human verification remains blocked; no automatic solve/bypass/blind retry. Never collect/train credential/password/cookie/token/clipboard/payment-secret content.
