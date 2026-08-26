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

## Direct P0 CDP action validation status

```text
pressKey  PASS
navigate  PASS
reload    PASS
stale-ref after newer observation PASS
```

## Next native sequence

```text
1 moving-target geometry evidence / rejection behavior
2 post-action observer outcome fidelity
3 Agent Cursor Debug Overlay only when pointer observability becomes useful
```

For moving-target validation, do not create a second observation before execution because that would only retest stale-observation rejection. The page itself must change geometry while the original observation remains latest, same-URL, and inside TTL.

No autonomous multi-step work yet.
