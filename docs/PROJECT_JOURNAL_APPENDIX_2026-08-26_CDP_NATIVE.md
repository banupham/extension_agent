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

Native evidence:

```text
mappedAction.type = pressKey
behaviorFamily = keyboard-key
CDP primitive = Input.dispatchKeyEvent
plan steps: keyDown Enter → keyUp Enter
execution.ok = true
stepCount = resultCount = 2
observationInvalidated = true
before.title = PressKey Test
after.title  = PRESSKEY PASS
focusedRef remained null
oneActionOnly = true
reObservedAfterExecution = true
selectorUsedByStrategy = false
literalTrajectoryReplay = false
```

Classification: `pressKey` functional CDP execution PASS. Physical-key naturalness/listener fidelity beyond the simple page listener is separate.

## navigate — NATIVE PASS

Controlled command:

```bat
node script/agent_one_action.js --type navigate --url "http://127.0.0.1:8091/target" --url-includes 127.0.0.1:8091 --full
```

Native evidence:

```text
mappedAction.type = navigate
behaviorFamily = navigation
CDP primitive = Page.navigate
execution.ok = true
stepCount = resultCount = 1
observationInvalidated = true
before.url/title = / / Navigate Start
after.url/title  = /target / NAVIGATE PASS
oneActionOnly = true
reObservedAfterExecution = true
selectorUsedByStrategy = false
literalTrajectoryReplay = false
```

Additional sparse smoke navigation to `https://pixelscan.dev/bot` reached the requested URL with `execution.ok=true`. This is navigation evidence only, not stealth/bot-detection evidence. Immediate after-title was empty, so external load/observer timing remains separate.

## reload — NATIVE PASS

Command:

```bat
node script/agent_one_action.js --type reload --url-includes 127.0.0.1:8091 --full
```

Native evidence:

```text
mappedAction.type = reload
behaviorFamily = navigation
CDP primitive = Page.reload
Page.reload { ignoreCache:false }
execution.ok = true
stepCount = resultCount = 1
observationInvalidated = true
before.url/title = /reload / Reload 1
after.url/title  = /reload / Reload 2
oneActionOnly = true
actionExecuted = true
reObservedAfterExecution = true
selectorUsedByStrategy = false
literalTrajectoryReplay = false
```

Classification: reload functional CDP execution PASS; OBSERVE AFTER captured the post-reload document correctly on the controlled surface.

## stale-ref rejection after newer observation — NATIVE PASS

Test preserved the real Agent chain:

```text
OBSERVE #1
→ semantic Agent Action: click(targetRef=e0)
→ mapAgentAction
→ sampledBehavior
→ buildCdpPlan
→ inject OBSERVE #2 immediately before execute
→ execute plan with OBSERVE #1 observationId
```

Native result:

```text
ok = true
test = semantic-click-stale-ref
action = click
expected = stale_observation
actual = stale_observation
originalObservationId != newObservationId
targetRef = e0
browser remained NOT CLICKED
```

Classification:

```text
newer observation invalidates the older observation-bound targetRef = PASS
Runtime rejected before pointer dispatch = PASS
no accidental click = PASS
```

This validates the production execution boundary rather than a hand-built raw CDP-only path.

## moving-target live geometry — initial NATIVE FAIL, fixed and NATIVE PASS

Controlled page kept the original observation latest, same URL and inside TTL, while moving the semantic target after the Agent click plan had already been built.

Initial native evidence on `main` before the fix:

```text
beforeTargetRect = { x:40, y:160, width:180, height:60 }
target moved live to { x:380, y:160, width:180, height:60 }
execution.ok = true
stepCount = resultCount = 13
afterTitle = MOVING TARGET FAIL OLD
OLD POSITION TRAP received the click
```

Classification: native-confirmed implementation failure. Observation freshness alone was insufficient because the Runtime used the observed pointer coordinates without confirming current target geometry.

Fix developed on reusable branch `feat/agent-tab-context`:

```text
Target Registry adds geometryChanged(observedRect, liveRect, tolerancePx)
Runtime target-dependent execution:
  resolve observation/ref as before
  → read current element state/rect
  → compare observed vs live geometry with 2px tolerance
  → reject missing/hidden/disabled live target
  → reject changed geometry as target_geometry_changed
  → invalidate observation on guard failure
  → do NOT silent-retarget

click path re-checks live geometry immediately before mousePressed
```

Contract/CI evidence:

```text
Agent Runtime target registry contract includes geometry-change cases
runtime-syntax workflow for experimental fix completed SUCCESS
```

Native re-test after extension reload:

```text
page state = TARGET MOVED TO B
old-position trap remained unclicked
moved target remained unclicked

ok = true
test = moving-target-geometry-guard
expected = target_geometry_changed
actual   = target_geometry_changed
```

Classification:

```text
moving-target geometry change detected before click = PASS
old coordinate not clicked = PASS
Executor did not silently retarget to new position = PASS
observation is invalidated so caller must re-observe = PASS
```

After CI + native PASS, only this geometry guard source/test change was ported to `main`; Browser UI/OS experimental work on the reusable branch was not merged as part of this fix.

## Current native validation status

```text
pressKey                          PASS
navigate                          PASS
reload                            PASS
stale-ref after newer observation PASS
moving-target live-geometry guard PASS
```

## Next native sequence

```text
1 post-action observer outcome fidelity
2 remaining keyboard/input fidelity or metadata cleanup gates when useful
3 Agent Cursor Debug Overlay only when PAGE_CDP pointer observability becomes useful
```

No autonomous multi-step work yet.
