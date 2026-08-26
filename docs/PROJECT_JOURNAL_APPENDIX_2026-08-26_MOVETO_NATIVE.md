# PROJECT JOURNAL APPENDIX — 2026-08-26 — moveTo native validation

## Scope

Controlled PAGE_CDP functional validation of existing semantic action:

```text
moveTo(targetRef)
```

No new capability was added for this test.

Controlled surface reused:

```text
http://127.0.0.1:8091
```

The page exposed a semantic button target and listeners that marked success on `mouseenter` / `mousemove`, while marking failure on `mousedown`, `mouseup` or `click`.

## Native result

Human repeated the same `moveTo` action multiple times and reported complete PASS.

Observed behavior:

```text
semantic target resolution            PASS
PAGE_CDP mouseMoved trajectory        PASS
arrival inside target                 PASS
page mouse-enter/move listener        PASS
no mousePressed                       PASS
no mouseReleased                      PASS
no click                              PASS
Agent Cursor mirrors trajectory       PASS
```

The user additionally repeated the test several times and observed that trajectories were not identical between runs while each run still reached the intended target successfully.

## Interpretation

The current planner uses randomized target acquisition / pointer-path generation rather than literal trajectory replay. Therefore repeated runs may vary in path and final interior point while preserving the semantic action and hit-box constraints.

This is positive functional evidence for trajectory diversity, but it is **not** by itself a natural-behavior quality PASS. Naturalness remains a separate Behavior milestone.

Invariant remains:

```text
Strategy chooses WHAT: moveTo(targetRef)
Behavior/Planner chooses HOW: one allowed pointer trajectory
Executor dispatches only
```

Agent Cursor is mirror-only telemetry and does not create or modify the pointer trajectory.

## Status

```text
moveTo native functional validation = PASS
```

Next existing PAGE_CDP capability to validate:

```text
scrollIntoView
```
