# PROJECT JOURNAL APPENDIX — `clear` native validation

Date: 2026-08-26
Branch: `main`
Controlled surface: `http://127.0.0.1:8091`

## Initial native failure on `main`

Precondition:

```text
Clear Target = e0, editable=true, value=OLD
Distractor   = e1, editable=true, value=KEEP
focusedRef   = e1
```

Semantic action:

```text
clear(targetRef=e0)
```

Initial result:

```text
invalid_cdp_plan_steps
```

Classification:

```text
semantic target binding existed       PASS
planner produced no clear steps       FAIL
wrong focused Distractor modified     NO
```

This was a native-confirmed implementation gap, so the fix was developed on the reusable experimental branch only.

## Experimental fix

`clear` remains one semantic Agent Action and is bound to its observation target:

```text
clear(targetRef=e0)
→ pointer trajectory + click to acquire e0
→ Control+A through Input.dispatchKeyEvent
→ Backspace rawKeyDown / keyUp
```

The plan rejects non-editable targets. It does not depend on whichever element was previously focused, and it does not use `Input.insertText("")`.

Regression/CI on `feat/agent-tab-context`:

```text
JavaScript syntax                      PASS
Agent action + behavior contract       PASS
CDP execution planner contract         PASS
CDP dispatcher contract                PASS
one-action bridge contract             PASS
full runtime-syntax workflow           PASS
```

## Native re-test — PASS

Pre-action observation:

```text
focusedRef = e1
Clear Target = e0
Distractor = e1
```

Observed plan:

```text
11 mouseMoved trajectory events
→ mousePressed / mouseReleased on e0
→ rawKeyDown Control
→ rawKeyDown a { code:KeyA, VK=65, modifiers=2 }
→ keyUp a
→ keyUp Control
→ rawKeyDown Backspace { code:Backspace, VK=8 }
→ keyUp Backspace
```

Execution result:

```text
execution.ok = true
stepCount = resultCount = 19
observationInvalidated = true
```

Post-action evidence:

```text
after.title = TARGET= | DISTRACTOR=KEEP
focusedRef = e0
agentPointer is on the Clear Target
```

Classification:

```text
observation-bound focus acquisition    PASS
Control+A selection                     PASS
Backspace clear semantics               PASS
Clear Target OLD → empty                PASS
Distractor KEEP → KEEP                  PASS
one semantic Agent Action               PASS
```

The visible Agent Cursor during this action is expected: `clear` now contains a real PAGE_CDP pointer-acquisition phase before keyboard deletion. The cursor remains debug mirror telemetry only and does not choose or alter the target.

## Promotion

After native PASS + CI PASS, the proven `clear` planner/metadata/regression files were selectively promoted to `main` in commit `9365e9568f63cfe4842bdcf0f10db4334a3eabaf`. Deferred Browser UI/OS work was not merged.

## Next existing capability

Native-test `moveTo` on `main` without modifying implementation first.

Expected semantic behavior:

```text
moveTo(targetRef)
→ PAGE_CDP mouseMoved trajectory to the observation-bound target
→ no mousePressed / mouseReleased
→ page pointer/mouse enter/move listener can observe arrival
→ Agent Cursor mirrors the same trajectory
```
