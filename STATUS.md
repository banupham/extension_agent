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
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_MEDIA_BATCH.md
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_MULTIFRAME_BATCH.md
docs/PROJECT_JOURNAL_APPENDIX_2026-08-26_TAB_LIFECYCLE_BATCH.md
```

---

# CURRENT FOCUS — functional matrix closed; Browser UI/OS shell re-test next

```text
A0 Agent/Behavior contracts        COMPLETE
A1 Action Window 0.1.4             COMPLETE
A2 Behavior Feature 0.2.0          COMPLETE
A3 Empirical baseline contract     READY
P0 Agent Runtime                   SCOPED FUNCTION MATRIX NATIVE PASS
A4 One-action bridge               SCOPED FUNCTION MATRIX NATIVE PASS
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
play
pause
mute
unmute
setVolume
seek
changePlaybackRate
switchTab
openNewTab
closeTab
same-origin iframe observation / semantic target binding
same-origin iframe PAGE_CDP click
stale-ref rejection after newer observation
moving-target live-geometry rejection before pointer click
drag destination live-geometry rejection before release
form/media target-state rejection when observed state changes
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

Media batch is **7/7 native PASS**:

```text
play
pause
mute
unmute
setVolume
seek
changePlaybackRate
```

`setVolume`, `seek`, and `changePlaybackRate` were first native-confirmed unsupported, then fixed together on `feat/agent-tab-context`, CI-passed, native re-tested, and selectively promoted to `main`. `setVolume` and `seek` use observed range state and held PAGE_CDP pointer travel; `changePlaybackRate` uses observed select-option semantics plus PAGE_CDP focus/keyboard selection. Naturalness remains a later Behavior-learning concern, not part of this functional gate.

Multi-frame same-origin batch is **2/2 native PASS**:

```text
observe Frame Action Target inside child iframe
click observation-bound Frame Action Target through PAGE_CDP
```

The existing top-document-only Observer first native-failed to discover the iframe target. The repair recursively observes visible same-origin frames, binds frame path internally, converts child rects to top-viewport coordinates, and re-resolves the bound frame for live geometry guards. Cross-origin/OOPIF support is not claimed by this gate.

Tab lifecycle batch is **3/3 native PASS**:

```text
switchTab
openNewTab
closeTab
```

All three first native-failed with `cdp_plan_unsupported:*`. They now use a browser-action envelope and `chrome.tabs.update/create/remove`; `cdpPlan = null`. Browser Context resolves the internal `tabId`; Strategy does not emit tab IDs or execution primitives. Post-action evidence is tab inventory before/after, and `closeTab` does not attempt to page-observe a tab after removal. Selective promotion to `main` commit `32190277ef9610bdf51aa4a0a855d639ce8068ea` passed main CI run `32972700448`.

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

Do not merge the whole experimental branch blindly. Selectively promote only native-proven code/tests. Browser UI/OS experiments remain isolated until explicitly promoted.

Controlled local webpage tests reuse one fixed surface:

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
→ PAGE_CDP PLAN or BROWSER ACTION ENVELOPE
→ AGENT RUNTIME EXTENSION      = dispatch + narrow runtime binding
→ CHROME
→ SETTLED PAGE OBSERVE or BROWSER-CONTEXT OBSERVE AFTER
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

Runtime dispatcher accepts PAGE_CDP plans:

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

## Browser-native tab lifecycle

```text
switchTab   → chrome.tabs.update(tabId, {active:true})
openNewTab  → chrome.tabs.create({url, active:true, windowId})
closeTab    → chrome.tabs.remove(tabId)
```

These do not use `EXECUTE_PLAN`, PAGE_CDP input, or Browser UI/OS. The one-action bridge records `beforeBrowserContext` and `afterBrowserContext`; the browser action is one semantic action and `cdpPlan = null`.

## Observation-bound target safety

Observation refs use TTL 4s and latest-observation rules. A newer observation invalidates the old one.

Target-dependent actions use narrow Runtime binding. Runtime re-reads live geometry and rejects `target_geometry_changed` instead of silently retargeting. Pointer actions re-check immediately before press where applicable. Drag additionally validates destination geometry before execution and immediately before release.

Observed state binding currently includes:

```text
checkbox/radio → inputType + checked
select         → selectedValue + selectedIndex + option metadata
range          → rangeValue + rangeMin + rangeMax + rangeStep
same-origin frame → internal framePath + top-viewport observed rect
```

No text/password input values are exposed for these features. If bound check/select/range state changes after OBSERVE, Runtime rejects `target_state_changed`.

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

## Media execution

```text
setVolume / seek
→ resolve requested value against observed range bounds
→ internal current/desired track points from observed rect
→ PAGE_CDP pointer acquire → down → held travel → up

changePlaybackRate
→ resolve requested option from observed select metadata
→ PAGE_CDP pointer acquire/focus
→ Input.dispatchKeyEvent Home / ArrowDown / Enter
```

Strategy still emits no selector, coordinate, frame path, raw CDP packet, or browser API packet.

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

Repeated pointer/scroll/drag/range tests provide functional diversity evidence only. Naturalness refinements remain Behavior-learning work after functional coverage is closed.

---

# Browser UI / OS control — EXPERIMENTAL, RE-TEST NEXT

Experimental evidence retained on `feat/agent-tab-context` includes Win32/Windows-UIA browser-shell control probes. It remains a separate execution surface and is not integrated into ordinary Runtime execution.

Previous exploratory evidence included browser Back/Forward via Win32 SendInput and UIA-discovered physical-style pointer interaction. The next gate is to re-test this surface after closing the scoped semantic action matrix.

Any test that sends real OS mouse/keyboard input requires explicit user consent immediately before input is sent and an exclusive desktop-input lease. Browser UI functional correctness and naturalness are separate gates; naturalness should be refined through Behavior learning rather than hand-tuned per functional test.

---

# NEXT — Browser UI/OS shell-control re-test

Start from the preserved experimental artifacts on `feat/agent-tab-context` and verify existing functionality before changing implementation.

Initial re-test scope:

```text
browser Back / Forward shell controls
UIA semantic discovery of browser toolbar controls
physical-style mouse trajectory → down → hold → up
```

Rules:

```text
no PAGE_CDP pretending to hit browser chrome
no teleport+click
no Runtime integration before evidence
explicit consent immediately before OS input
one exclusive desktop-input owner
```

After Browser UI/OS re-test, review the evidence and architecture before deciding whether to integrate that surface or proceed to A5 / Goal Checker + Replan. Autonomous multi-step remains out of scope.

---

# Known later fidelity / robustness gates

```text
cross-origin/OOPIF frame observation when a real task requires it
focus primitive metadata cleanup
physical-key-like text-entry variant only if a real task requires listener fidelity
pointer/scroll/drag/range naturalness refinement through Behavior learning
Browser UI/OS integration only after the shell-control re-test and explicit design review
```

---

# Safety / privacy

CAPTCHA/human verification remains blocked; no automatic solve/bypass/blind retry. Never collect/train credential/password/cookie/token/clipboard/payment-secret content.
