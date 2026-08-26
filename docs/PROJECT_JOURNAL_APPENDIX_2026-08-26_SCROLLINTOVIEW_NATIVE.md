# PROJECT JOURNAL APPENDIX — 2026-08-26 — scrollIntoView native evidence

## Native evidence

Controlled page: `http://127.0.0.1:8091/`

Initial observation exposed an offscreen semantic target:

```text
label = Far Target
viewport.height = 640
rect.y = 1466.4375
```

Initial `main` execution failed before dispatch:

```text
scrollIntoView(targetRef=e0)
→ cdp_plan_unsupported:scrollIntoView
```

This isolated the gap to the CDP planner; Observer offscreen-target discovery was already working.

## Repair

Implemented on reusable branch `feat/agent-tab-context`:

```text
scrollIntoView(targetRef)
→ use observed target rect + viewport center
→ compute required x/y wheel delta
→ split into bounded weighted Input.dispatchMouseEvent(mouseWheel) events
→ no click
```

Metadata was aligned to the actual primitive:

```text
Input.dispatchMouseEvent(mouseWheel)
```

The Runtime target guard was also extended so `scrollIntoView` remains observation-bound and validates live geometry before executing the target-derived plan.

## Native re-tests

Normal-path re-test:

```text
execution.ok = true
page scroll.y increased
Far Target became visible inside the viewport
after.title = SCROLLINTOVIEW PASS
no mousePressed / mouseReleased
```

After adding the observation-bound Runtime guard, the same native test still PASSed.

Human visual assessment of the current scrolling motion: functional behavior is good; naturalness is roughly ~80% and is intentionally left for Behavior learning/refinement rather than hand-tuning this gate.

## Promotion

Selective promotion to `main`:

```text
commit = 3efdc3e984c01a59b2afeb9c528331f2556d43ad
runtime-syntax run = 32950694941
conclusion = SUCCESS
```

Only the proven planner, primitive metadata, regression and Runtime target guard were promoted; deferred Browser UI/OS experiments remain outside `main` runtime integration.

## Decision

```text
scrollIntoView functional native gate = PASS
scrollIntoView naturalness gate        = NOT CLAIMED
NEXT                                   = drag native validation
```
