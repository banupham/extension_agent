# Forms batch native PASS — 2026-08-26

## Scope

Batch native validation on the fixed local PAGE_CDP test surface at `http://127.0.0.1:8091`.

Actions:

```text
setChecked
toggle
selectOption
submit
```

## Baseline discovery

Initial native batch result on existing implementation:

```text
setChecked    FAIL → cdp_plan_unsupported:setChecked
toggle        PASS → TOGGLE PASS
selectOption  FAIL → cdp_plan_unsupported:selectOption
submit        PASS → SUBMIT PASS
```

`toggle` and `submit` required no capability change.

## Minimal fixes after native-confirmed FAIL

`setChecked` now binds observed checkbox/radio state. The action is idempotent: if observed `checked` already equals the requested semantic value, the plan does not toggle it; otherwise it uses observation-bound PAGE_CDP pointer input.

`selectOption` now binds observed select state and option metadata. The planner resolves the requested semantic value/label to one observed option, acquires the select with PAGE_CDP pointer input, then uses allowlisted `Input.dispatchKeyEvent` (`Home`, `ArrowDown`, `Enter`) rather than Strategy-provided coordinates/selectors or arbitrary Runtime JavaScript.

Runtime live binding re-reads form state before execution and rejects `target_state_changed` when the observed state/options no longer match.

No input text/password values are added to the observation contract. Only checkable state and select option metadata required by these actions are exposed.

## Native re-test

After pulling the experimental fix and reloading Agent Runtime V0.2:

```text
setChecked    PASS
selectOption  PASS
```

Together with the unchanged native PASS cases:

```text
Forms batch = 4/4 PASS
```

Agent Cursor was visibly active for the pointer phases after the extension reload, confirming PAGE_CDP `Input.dispatchMouseEvent` participation rather than a hidden direct-DOM mutation path.

## Classification

```text
functional forms semantics     NATIVE PASS
observation-bound state guard  PASS
PAGE_CDP pointer/key mechanism PASS
naturalness                    separate Behavior-learning concern
```

Functional PASS does not claim natural-behavior quality PASS.
