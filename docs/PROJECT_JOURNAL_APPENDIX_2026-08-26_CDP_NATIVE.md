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

## post-action semantic outcome fidelity — initial NATIVE FAIL, fixed and NATIVE PASS

Controlled page behavior:

```text
click Open Dynamic Panel
→ immediate title/state = CLICK ACK
→ 250ms later title/state = DYNAMIC READY
→ new interactive button = Dynamic Child
```

Initial native evidence with one-action bridge `0.2.0`:

```text
execution.ok = true
stepCount = resultCount = 13
immediate after.title = CLICK ACK
after.interactiveElements contained only Open Dynamic Panel
```

A later standalone observation on the same rendered page returned:

```text
title = DYNAMIC READY
interactiveElements:
  Open Dynamic Panel
  Dynamic Child
```

Classification:

```text
click executor = PASS
dynamic DOM rendering = PASS
Observer semantic capability = PASS
single immediate OBSERVE AFTER timing = FAIL / too early
```

Fix developed on `feat/agent-tab-context` in one-action bridge `0.2.1`:

```text
for UI/input outcome-sensitive actions:
  observe immediately after execute
  → poll every 80ms
  → minimum observation window 400ms
  → require semantic snapshot stability for >= 2 samples
  → maximum deadline 800ms
```

The fingerprint intentionally ignores `observationId`, timestamps and pointer geometry animation. It compares URL/title/focus/scroll and semantic interactive-element state. This is bounded outcome settling, not a fixed 250ms sleep tied to the test page, and it does not execute another Agent Action.

Native re-test using the same page and same semantic click command:

```text
bridgeVersion = 0.2.1
execution.ok = true
after.title = DYNAMIC READY
after.interactiveElements contained Open Dynamic Panel + Dynamic Child
postActionObservation.mode = settled
samples = 6
waitedMs = 400
semanticChanged = true
stableSamples = 3
deadlineReached = false
policy.pollMs = 80
policy.minWindowMs = 400
policy.maxWindowMs = 800
policy.stableSamples = 2
oneActionOnly = true
```

Classification:

```text
post-action delayed semantic outcome captured in same one-action result = PASS
no manual second OBSERVE required = PASS
no second Agent Action introduced = PASS
bounded settle deadline preserved = PASS
```

After native PASS and contract/CI success, the isolated one-action bridge `0.2.1` change and regression test were ported to `main` without merging Browser UI/OS experimental work.

## Current native validation status

```text
pressKey                               PASS
navigate                               PASS
reload                                 PASS
stale-ref after newer observation      PASS
moving-target live-geometry guard      PASS
post-action settled semantic outcome   PASS
```

## Next native sequence

The previously deferred Agent Cursor Debug Overlay is now the next focused task because direct PAGE_CDP functional/robustness validation has reached the point where pointer observability is useful.

Required cursor invariant:

```text
CDP dispatch remains source of truth
cursor is mirror-only telemetry
no input generation
no target selection or retargeting
no Behavior timing/trajectory changes
pointer-events:none
Observer ignores overlay
```

After Agent Cursor validation, continue remaining keyboard/input fidelity, metadata cleanup and multi-frame gates as useful.

No autonomous multi-step work yet.
