# STATUS — 2026-08-26

## Source of truth

GitHub `banupham/extension_agent` là source chính.

```bat
git pull
```

Trước khi sửa code: `STATUS.md` → `docs/PROJECT_JOURNAL.md` → source/tests hiện tại trên `main`.

---

# CURRENT FOCUS — AGENT / A4 native one-action functional validation

Collector V0.8 transport/capture gate đã đạt và chỉ còn stability/regression support.

```text
continuous socket ingest      PASS
late-server IndexedDB replay  PASS
no missing/duplicate seq      PASS
multi-frame/multi-tab         PASS
SPA routes                    PASS
login privacy boundary        PASS
browser close finalize        PASS
```

Current Agent native evidence:

```text
tab inventory / tab matching          PASS
human keyword → exact tabId resolve   PASS
OBSERVE on Facebook by keyword        PASS
semantic button selection             PASS
basic native click dispatch           PASS
OBSERVE AFTER / invalidation           PASS
```

This milestone is functional Agent validation only. Brain task reasoning, autonomous multi-step planning and natural-behavior quality are not declared complete by these passes.

## Native validation operating rules

Current P0/A4 work tests **existing Agent functions first**. Do not add a new command, test mode or capability merely to make a native test easier.

```text
main
→ run an existing function
→ if PASS: record evidence and continue
→ if FAIL because of implementation: switch to the single reusable experiment branch
→ fix + CI/offline check + native re-test
→ merge only the native-passed fix to main
→ sync the same experiment branch back to main
```

The reusable experiment branch is:

```text
feat/agent-tab-context
```

Do not create a new branch per native bug.

Repeated functional testing should prefer a neutral/controlled page with no valuable account state. Account-backed platforms such as Facebook are reserved for sparse smoke validation after a capability already works in a controlled environment. This is to reduce unintended account/platform side effects from repeated automated interaction, not to bypass platform protections.

For P0 in-page interaction validation, use one execution path consistently:

```text
OBSERVE
→ semantic target / Agent Action
→ Behavior
→ CDP Plan 0.1.1
→ allowlisted Agent Runtime dispatcher
→ Chrome
→ OBSERVE AFTER
```

Do not mix DOM `.click()`, arbitrary `Runtime.evaluate`, Scenario/Stealth executor actions, or another in-page executor into the same Agent functional gate. `chrome.tabs.*` remains control-plane only.

---

# Agent execution boundary

```text
TASK
→ BROWSER CONTEXT / TAB INVENTORY
→ OBSERVER
→ STRATEGY / BRAIN
→ AGENT ACTION CONTRACT        = WHAT
→ EXECUTION BEHAVIOR CONTRACT = HOW naturally
→ CDP EXECUTION PLAN           = exact browser-native plan
→ AGENT RUNTIME EXTENSION      = dispatch only
→ CHROME
→ OBSERVE AFTER
→ GOAL CHECK / REPLAN
```

Hard invariant:

```text
Strategy does NOT emit selector / coordinate / CDP packet.
Behavior does NOT choose task intent.
Executor does NOT choose strategy.
```

`tabId` is internal execution identity. Human-facing CLI may select a browser context by keyword/host/title/url; manager resolves that once to one `tabId` before OBSERVE and reuses the same tab for EXECUTE + OBSERVE AFTER.

CDP is the standard in-page execution layer. `chrome.tabs.*` remains tab lifecycle/control-plane.

---

# A0 — COMPLETE

```text
control-center/AGENT_ACTION_CONTRACT.json
control-center/manager/strategy/agent_action_contract.js
control-center/manager/strategy/execution_behavior_contract.js
docs/AGENT_ACTION_CDP_MAP.md
```

Scenario Mode contract remains separate.

---

# A1 — COMPLETE

Action Window `0.1.4`.

```text
training-collector/tools/build_action_windows.js
training-collector/tools/analyze_action_windows.js
docs/A1_NATIVE_DATASET_VALIDATION.md
```

Derived families:

```text
click / dismiss / toggle
focus / selectOption / submit
drag
hover / hoverAndObserve
scrollVertical / scrollHorizontal
typeText / pressKey
```

Raw truth is never rewritten; Strategy eligibility and Behavior eligibility are separate; `tsEpochMs` is chronology and `sessionSeq` is durability only.

---

# A2 — COMPLETE

Behavior Feature `0.2.0`.

```text
training-collector/tools/extract_behavior_features.js
training-collector/tools/analyze_behavior_features.js
docs/A2_NATIVE_FEATURE_VALIDATION.md
```

A2 derives pointer path/speed/acceleration/turn/corrections, click hold/acquisition, hover approach+dwell+leave, vertical/horizontal wheel bursts, keyboard hold/inter-key timing and target geometry.

Native gate across five recent sessions showed useful click/hover/scroll/keyboard coverage. Drag remains sparse and must use fallback rather than a confident learned distribution.

---

# A3 — EMPIRICAL BASELINE CONTRACT READY

Main files:

```text
training-collector/tools/build_behavior_baseline.js
control-center/manager/behavior/empirical_policy.js
control-center/script/checks/empirical_behavior_policy.js
```

Baseline `0.1.0` uses aggregated robust quantiles only:

```text
p10 / p25 / p50 / p75 / p90
```

No literal human trajectory is stored or replayed. Runtime samples bounded empirical profiles by behavior family and target-size context when sample count is sufficient.

Initial families:

```text
pointer-click
pointer-hover
scroll-vertical
scroll-horizontal
keyboard-text
keyboard-key
pointer-drag (sparse fallback)
```

`focus-acquisition` deliberately reuses the pointer-click empirical baseline because the physical acquisition/click mechanics are the same family while semantic intent remains `focus`.

Real native baseline JSON is intentionally a generated local artifact from collected sessions, not hard-coded into source. Native Agent functional tests may run without it using conservative fallbacks; naturalness evaluation is a separate later gate.

---

# CDP Execution Planner — v0.1.1 / BASIC CLICK NATIVE PASS

```text
control-center/manager/execution/cdp_plan.js
control-center/script/checks/cdp_execution_plan.js
```

CDP Plan `0.1.1` converts mapped Agent Action + sampled Behavior + current target geometry into exact CDP steps.

Implemented:

```text
pointer-click / focus acquisition
  adaptive endpoint inside target
  bounded curved approach
  empirical turn influence
  bounded micro-correction when sampled
  dwell → press → empirical hold → release

doubleClick
  two real press/release cycles
  first cycle clickCount=1
  second cycle clickCount=2
  bounded inter-click gap

pointer-hover
  bounded approach + optional dwell

scroll vertical/horizontal
  multi-event wheel burst
  separate axes
  bounded duration/delta
  optional empirical correction event

keyboard text/key
  task text emitted with empirical timing
  never uses captured human printable content

navigate/reload
```

Natural behavior comes from aggregate distributions/context, not fixed random jitter and not literal trajectory replay.

Native basic click evidence now proves a `0.1.1` pointer-click plan can be dispatched successfully by Agent Runtime. Remaining fidelity questions:

```text
doubleClick sequence still needs browser-native validation
keyCombo modifier sequence is not complete yet
Input.insertText per char may differ from keyDown/keyUp listeners
moving target geometry revalidation is not robust yet
```

---

# Agent Runtime V0.2 — P0 IN NATIVE VALIDATION

Main files:

```text
control-center/extension/agent-runtime-extension/manifest.json
control-center/extension/agent-runtime-extension/target_registry.js
control-center/extension/agent-runtime-extension/tab_context.js
control-center/extension/agent-runtime-extension/cdp_plan_dispatcher.js
control-center/extension/agent-runtime-extension/broker_client.js
control-center/extension/agent-runtime-extension/background.js
```

## Browser/tab context

External broker commands do not have content-script `sender.tab` identity. Agent Runtime therefore exposes explicit browser context:

```text
agentListTabs
agentObserveTabs
agentObserve(tabId?)
agentExecutePlan(tabId? + observationId)
```

Scopes:

```text
active
visible
matching
all
```

Human-facing CLI supports selectors such as:

```bat
node script/agent_one_action.js --observe --tab facebook
node script/agent_one_action.js --observe --host facebook.com
```

Manager resolves the selector once to an exact `tabId`; the execution identity remains explicit internally.

## Observation-bound targets

Every observation gets a short-lived `observationId`.

```text
observationId + targetRef
→ tab/frame
→ semantic descriptor
→ observed rect
→ internal-only selector when available
```

Public observation does NOT expose internal selector. Brain sees semantic target facts only.

New observation, navigation/loading, TTL expiry or debugger detach makes old refs stale. Stale refs fail; they are never reused as blind coordinates.

Current TTL is 4 seconds. This is deliberately strict for first one-action tests; measure actual Strategy/model latency before deciding whether to extend TTL or add semantic re-resolution.

## Allowlisted EXECUTE_PLAN

Only these manager-plan methods are accepted:

```text
Input.dispatchMouseEvent
Input.dispatchKeyEvent
Input.insertText
Page.navigate
Page.reload
Page.getNavigationHistory
Page.navigateToHistoryEntry
```

No arbitrary `Runtime.evaluate` / raw CDP tunnel exists through `EXECUTE_PLAN`.

Dispatcher version compatibility after native evidence:

```text
accepted CDP plans: 0.1.0, 0.1.1
latest planner:      0.1.1
```

The previous runtime accepted only `0.1.0`, while manager planner emitted `0.1.1`, causing `unsupported_cdp_plan_version`. Native branch validation with the compatibility fix succeeded; backward acceptance of `0.1.0` remains covered by contract test.

After a plan executes the observation is invalidated, forcing OBSERVE AFTER.

## Direct broker connection

Agent Runtime connects directly to the existing control broker as a separate agent:

```text
meta.product = agent-runtime
broker actions:
  agentStatus
  agentListTabs
  agentObserveTabs
  agentObserve
  agentExecutePlan
```

Agent Mode does NOT proxy through the deterministic Stealth/Scenario extension.

Multiple extension clients may share broker port `3000`; broker routing is by `agentId`. Native debugging showed Stealth Executor and Agent Runtime are separate agent products, not two servers competing to listen on the same port.

Extension-side reconnect/heartbeat is implemented; explicit client close no longer schedules reconnect.

---

# A4 one-action bridge — BASIC CLICK NATIVE PASS

Manager files:

```text
control-center/manager/agent/broker_runtime_client.js
control-center/manager/agent/one_action_bridge.js
control-center/script/agent_one_action.js
```

Bridge version `0.2.0` has the correct decision order:

```text
resolve browser context once
→ OBSERVE
→ Brain/harness decide(observation)
→ exactly ONE Agent Action
→ mapAgentAction
→ sampledBehavior
→ buildCdpPlan
→ broker agentExecutePlan(tabId + observationId)
→ OBSERVE AFTER on same tab
```

Terminal Brain decisions such as `blocked` execute nothing.

Native harness can auto-discover the single broker agent whose `meta.product=agent-runtime`; `--agent` is available when multiple runtimes are connected.

Examples from `control-center`:

```bat
node script/agent_one_action.js --tabs
node script/agent_one_action.js --tabs --tabs-scope matching --host facebook.com
node script/agent_one_action.js --observe --tab facebook
node script/agent_one_action.js --type click --label "Thông báo" --tab facebook
node script/agent_one_action.js --type doubleClick --label "Example label" --tab facebook
node script/agent_one_action.js --type hover --label "Example label" --tab facebook
node script/agent_one_action.js --type focus --label "Search" --tab facebook
node script/agent_one_action.js --type typeText --text "agent test" --tab facebook
node script/agent_one_action.js --type scrollVertical --direction 1 --tab facebook
```

Optional:

```text
--baseline <generated behavior-baseline.json>
--tab <numeric tabId | human keyword>
--on <human keyword>
--host <hostname>
--agent <runtime-agentId>
--full
```

---

# Native evidence — 2026-08-26

## Browser context / tab identity — PASS

Observed native sequence:

```text
agentListTabs
→ returned Google/Facebook browser facts with tabId/windowId/active/url

--tabs --tabs-scope matching --host facebook.com
→ returned only Facebook tab

--observe --tab facebook
→ resolved human keyword to exact internal tabId
→ observation.url = https://web.facebook.com/...
→ observation.title = Facebook
```

This removes the need for a user to copy/paste tab ids during normal use. Numeric tabId remains available for debugging and exact internal binding.

## Semantic basic click — PASS

Native command:

```bat
node script/agent_one_action.js --type click --label "Thông báo" --tab facebook
```

Observed evidence:

```text
resolvedTabId = Facebook tab
selectedTarget.ref = e13
selectedTarget.role = button
selectedTarget.label = Thông báo
cdpPlanVersion = 0.1.1
plan = mouseMoved → mouseMoved → mousePressed → mouseReleased
execution.ok = true
stepCount = 4
resultCount = 4
observationInvalidated = true
beforeObservationId != afterObservationId
```

Human visual confirmation: Facebook panel **“Thông báo” actually opened**.

Therefore this is recorded as a functional native click PASS for the Agent execution stack.

Important scope of this pass:

```text
PASS:
  browser-context resolution
  semantic target selection by label
  one-action mapping
  CDP 0.1.1 dispatch
  observation invalidation
  OBSERVE AFTER
  visible UI click effect

NOT YET CLAIMED:
  full semantic capture of notification panel contents after click
  Brain-level goal reasoning
  autonomous multi-step behavior
  naturalness/human-likeness quality
```

Post-click observation did not expose the notification contents as completely as desired. Treat that as observer/outcome-fidelity evidence for later investigation, not as a failure of the native click executor.

---

# Latest CI gate

CDP `0.1.1` dispatcher compatibility milestone:

```text
PR:          #4
workflow:    runtime-syntax
run:         32919174975
head commit: e7b8e0b75b0ff036b33e302c175b15debab7bdba
result:      SUCCESS
merge commit:d1c340e0aea5b588b071e9913361d789eb6550e0
```

This gate includes the dispatcher contract for:

```text
accept 0.1.1
retain 0.1.0 compatibility
reject unknown versions
retain CDP method allowlist
retain delay bounds
```

CI success is NOT native Chrome Agent validation; the basic click additionally has native browser evidence above.

---

# NEXT — continue A4 functional native validation

Do not start autonomous multi-step tasks yet. Do not add test-only Agent capabilities. Start each native capability test from `main` and use the existing CLI/action vocabulary.

```text
TAB CONTEXT / keyword resolve      PASS
OBSERVE semantic targets           PASS
basic click + visible UI effect    PASS
OBSERVE AFTER / new observation    PASS

next existing functions:
vertical scroll
hover without click
horizontal scroll on a real carousel
doubleClick on a safe target
focus
non-sensitive typeText
back / forward

later invariant/evidence gates:
stale-ref rejection when it can be exercised through existing interfaces
moving-target evidence/rejection
post-action semantic outcome fidelity
keyboard listener fidelity
```

For repeated tests, prefer neutral/controlled pages. Use account-backed sites only for sparse smoke verification after the function already passes in a controlled environment.

Functional correctness first. Brain quality and natural human behavior remain separate later gates.

Important native questions still open:

```text
Does 4 s observation TTL survive real Brain/model latency?
Does a dynamic target move between observation and execution?
Does two-cycle doubleClick behave correctly on real sites?
Does per-character Input.insertText trigger required site listeners?
Does OBSERVE AFTER capture enough semantic state for goal checking?
Do sampled pointer corrections look natural rather than artificial?  (later behavior-quality gate)
```

---

# Remaining runtime gaps after P0

P1:

```text
drag / slider / seek
scrollIntoView
selectOption / setChecked / form submit
semantic dismiss helper
tab lifecycle through Agent bridge
hoverAndObserve / waitAndObserve outcome policy
multi-frame target registry beyond current top-frame runtime observation
robust target revalidation for moving DOM geometry
full modifier-aware keyCombo
```

Potential future actions only when task/evidence requires them:

```text
contextClick
pressAndHold
openLinkInNewTab
selectText
uploadFile
```

Media verbs compile to generic semantic click/drag; no site-specific YouTube/TikTok executor methods.

---

# Safety / privacy

CAPTCHA/human verification remains:

```text
status=blocked
reasonCode=human_verification_required
no automatic solve/bypass
```

Human login demonstrations may contribute timing/semantic form behavior but never credential/password/cookie/token/clipboard contents.

---

# Development rules

1. GitHub is source of truth.
2. Scenario Mode and Agent Mode remain separate.
3. Strategy=WHAT; Behavior=HOW; CDP Planner=exact plan; Executor=dispatch.
4. Browser context is first-class; human selectors resolve to exact internal tabId before OBSERVE.
5. Collector raw stays un-derived and privacy-filtered.
6. Strategy/Behavior dataset eligibility remain separate.
7. Human demonstrations provide distributions/context, not literal replay.
8. Sparse families remain explicitly sparse.
9. Target refs are observation-bound and stale refs trigger re-observation.
10. `EXECUTE_PLAN` is allowlisted; no arbitrary CDP method tunnel.
11. Brain decides only after OBSERVE and at most one action per loop.
12. CI success != native Chrome Agent validation.
13. Functional Agent validation != Brain quality != natural-behavior quality.
14. Update STATUS/JOURNAL after architecture, protocol, dataset-contract or native-gate milestones.
15. Native functional validation tests existing functions on `main` first; do not add test-only Agent capabilities.
16. Only implementation failures move to the single reusable experiment branch `feat/agent-tab-context`; do not create a branch per bug.
17. P0 in-page functional tests use the unified CDP Planner → allowlisted Runtime dispatcher path.
18. Prefer neutral/controlled pages for repeated tests; account-backed platforms are sparse smoke-validation surfaces.
