# PROJECT JOURNAL APPENDIX — CDP native validation continuation

Date: 2026-08-26

This appendix records continuation of native validation for existing CDP/web-page actions on `main` after Browser UI/OS Runtime integration was deferred.

Controlled local surface policy:

```text
http://127.0.0.1:8091
```

Keep the same port and change only page content/state between test cases.

## pressKey — NATIVE PASS

Command:

```bat
node script/agent_one_action.js --type pressKey --key "Enter" --url-includes 127.0.0.1:8091 --full
```

Controlled page behavior:

```text
initial title = PressKey Test
keydown Enter → visible intermediate state ENTER DOWN
keyup Enter   → visible final state PRESSKEY PASS
final title   = PRESSKEY PASS
```

Native evidence:

```text
mappedAction.type = pressKey
behaviorFamily = keyboard-key
CDP primitive = Input.dispatchKeyEvent

plan steps:
1 keyDown Enter
2 keyUp Enter

execution.ok = true
cdpPlanVersion = 0.1.2
stepCount = 2
resultCount = 2
observationInvalidated = true
before.title = PressKey Test
after.title  = PRESSKEY PASS
focusedRef remained null
oneActionOnly = true
reObservedAfterExecution = true
selectorUsedByStrategy = false
literalTrajectoryReplay = false
```

Classification:

```text
pressKey functional CDP execution = PASS
physical-key naturalness/listener fidelity beyond this simple page listener = separate later gate
```

## Next native sequence

```text
1 navigate
2 reload
3 stale-ref / moving-target / observer outcome gates
4 Agent Cursor Debug Overlay only when pointer observability becomes useful
```

No autonomous multi-step work yet.
