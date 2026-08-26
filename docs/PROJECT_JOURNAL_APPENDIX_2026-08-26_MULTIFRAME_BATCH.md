# PROJECT JOURNAL APPENDIX — 2026-08-26 — MULTI-FRAME BATCH

## Gate

Fixed local surface: `http://127.0.0.1:8091/`.

The existing Observer was native-tested before implementation changes. Initial result:

```text
multi-frame observe = FAIL
Frame Action Target not found
```

This confirmed an implementation gap: the Runtime Observer only evaluated the top document and did not include interactive elements inside the same-origin child iframe.

## Repair on reusable experiment branch

Implemented on `feat/agent-tab-context` only after the native failure.

The repair keeps the architecture boundary intact:

```text
Strategy → semantic target only
Observer/Runtime → recursive same-origin frame discovery + internal frame binding
Planner → page coordinates derived below Strategy
Executor → PAGE_CDP dispatch
```

Key behavior:

- recursively observes visible same-origin `iframe` / `frame` documents, bounded by depth and target-count limits;
- preserves internal `framePath` / frame metadata in the target registry while exposing only safe public frame depth metadata;
- converts child-frame element rectangles into top-viewport PAGE_CDP coordinates;
- live target revalidation resolves the element again through its bound frame path before pointer execution;
- cross-origin / OOPIF coverage is not claimed by this gate.

The batch lab exposes `Frame Action Target` in `/frame`; after click, the child-frame semantic label becomes `FRAME CLICK PASS` so settled observation can capture the visible semantic outcome.

## Native retest

After reloading Agent Runtime V0.2 and the batch lab:

```text
multi-frame observe = PASS
multi-frame click   = PASS
```

Observed requirements were satisfied:

```text
Frame Action Target discovered inside frame
frameDepth = 1
PAGE_CDP pointer reaches iframe target
execution.ok = true
child-frame semantic outcome = FRAME CLICK PASS
```

This is functional evidence for the same-origin iframe baseline only.

## Promotion

Selective promotion to `main`:

```text
606ba790fc060dc9e681e910b11aa503d1fc3d89
feat(agent): promote native-passed multi-frame observation
```

Promoted only:

```text
control-center/extension/agent-runtime-extension/background.js
control-center/extension/agent-runtime-extension/target_registry.js
control-center/script/checks/agent_runtime_target_registry.js
```

The experimental batch lab and deferred Browser UI/OS artifacts were not promoted.

Main CI run:

```text
32968743451
runtime-syntax
SUCCESS
```

## Result

```text
multi-frame same-origin observation = NATIVE PASS
multi-frame same-origin click        = NATIVE PASS
```

NEXT functional group:

```text
tab lifecycle
→ switchTab
→ openNewTab
→ closeTab
```

Naturalness remains separate Behavior-learning work and is not part of this functional gate. Autonomous multi-step remains out of scope.
