# STATUS — 2026-08-26

## Source of truth

GitHub `banupham/extension_agent` là source chính.

```bat
git pull
```

Trước khi sửa code: `STATUS.md` → `docs/PROJECT_JOURNAL.md` → source/tests hiện tại trên `main`.

---

# CURRENT FOCUS — AGENT / A4 native one-action validation

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

---

# Agent execution boundary

```text
TASK
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

CDP is the standard in-page execution layer. `chrome.tabs.*` remains tab lifecycle control-plane.

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

Real native baseline JSON is intentionally a generated local artifact from collected sessions, not hard-coded into source. The first native Agent tests may pass `--baseline <file>`; without it the policy uses conservative fallbacks.

---

# CDP Execution Planner — READY FOR NATIVE TEST

```text
control-center/manager/execution/cdp_plan.js
control-center/script/checks/cdp_execution_plan.js
```

CDP Plan `0.1.0` converts mapped Agent Action + sampled Behavior + current target geometry into exact CDP steps.

Implemented:

```text
pointer-click
  adaptive endpoint inside target
  bounded curved approach
  empirical turn influence
  bounded micro-correction when sampled
  dwell → press → empirical hold → release

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

Known fidelity gaps before declaring execution complete:

```text
doubleClick native sequence needs browser validation
keyCombo modifier sequence is not complete yet
Input.insertText per char may differ from keyDown/keyUp listeners
```

---

# Agent Runtime V0.2 — P0 READY

Main files:

```text
control-center/extension/agent-runtime-extension/manifest.json
control-center/extension/agent-runtime-extension/target_registry.js
control-center/extension/agent-runtime-extension/cdp_plan_dispatcher.js
control-center/extension/agent-runtime-extension/broker_client.js
control-center/extension/agent-runtime-extension/background.js
```

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

After a plan executes the observation is invalidated, forcing OBSERVE AFTER.

## Direct broker connection

Agent Runtime now connects directly to the existing control broker as a separate agent:

```text
meta.product = agent-runtime
broker actions:
  agentStatus
  agentObserve
  agentExecutePlan
```

Agent Mode does NOT proxy through the deterministic Stealth/Scenario extension.

Extension-side reconnect/heartbeat is implemented; explicit client close no longer schedules reconnect.

---

# A4 one-action bridge — READY FOR NATIVE TEST

Manager files:

```text
control-center/manager/agent/broker_runtime_client.js
control-center/manager/agent/one_action_bridge.js
control-center/script/agent_one_action.js
```

Bridge version `0.2.0` now has the correct decision order:

```text
OBSERVE
→ Brain decide(observation)
→ exactly ONE Agent Action
→ mapAgentAction
→ sampledBehavior
→ buildCdpPlan
→ broker agentExecutePlan(observationId)
→ OBSERVE AFTER
```

Terminal Brain decisions such as `blocked` execute nothing.

Native harness can auto-discover the single broker agent whose `meta.product=agent-runtime`; `--agent` is available when multiple runtimes are connected.

Example modes after `npm install` in `control-center`:

```bat
node control-center/script/agent_one_action.js --observe
node control-center/script/agent_one_action.js --type click --label "Example label"
node control-center/script/agent_one_action.js --type hover --label "Example label"
node control-center/script/agent_one_action.js --type scrollVertical --direction 1
```

Optional:

```text
--baseline <generated behavior-baseline.json>
--tab <tabId>
--agent <runtime-agentId>
--full
```

---

# Latest CI gate

```text
run:    32883873609
commit: 06df74ee128fbc00091e79f1fad6a11dd7256913
result: SUCCESS
```

This run passed Agent action/behavior contracts, A3 policy, target registry, CDP planner, allowlisted dispatcher, one-action Brain bridge, extension broker client, manager broker adapter, native harness contract, A1/A2 and Collector regressions/socket integration.

CI success is NOT native Chrome Agent validation.

---

# NEXT — native A4 validation

Do not start autonomous multi-step tasks yet. Validate one action at a time:

```text
OBSERVE semantic targets
click button/link by label/ref
re-observe and verify new observationId
hover without click
vertical scroll
horizontal scroll on a real carousel
focus + type non-sensitive text as separate actions
back / forward
stale-ref rejection
```

Measure correctness first, naturalness second.

Important native questions:

```text
Does 4 s observation TTL survive real Brain/model latency?
Does a dynamic target move between observation and execution?
Does doubleClick need two explicit press/release cycles?
Does per-character Input.insertText trigger required site listeners?
Do sampled pointer corrections look natural rather than artificial?
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
4. Collector raw stays un-derived and privacy-filtered.
5. Strategy/Behavior dataset eligibility remain separate.
6. Human demonstrations provide distributions/context, not literal replay.
7. Sparse families remain explicitly sparse.
8. Target refs are observation-bound and stale refs trigger re-observation.
9. `EXECUTE_PLAN` is allowlisted; no arbitrary CDP method tunnel.
10. Brain decides only after OBSERVE and at most one action per loop.
11. CI success != native Chrome Agent validation.
12. Update STATUS/JOURNAL after architecture or dataset-contract milestones.
