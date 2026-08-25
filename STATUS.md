# STATUS — 2026-08-26

## Source of truth

GitHub `banupham/extension_agent` là source chính.

```bat
git pull
```

Trước khi sửa code: `STATUS.md` → `docs/PROJECT_JOURNAL.md` → source/tests hiện tại trên `main`.

---

# CURRENT FOCUS — AGENT / A3 + P0 runtime bridge

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

Families currently derived:

```text
click / dismiss / toggle
focus / selectOption / submit
drag
hover / hoverAndObserve
scrollVertical / scrollHorizontal
typeText / pressKey
```

Important: raw truth is never rewritten; Strategy eligibility and Behavior eligibility are separate; `tsEpochMs` is chronology and `sessionSeq` is durability only.

---

# A2 — COMPLETE

Behavior Feature `0.2.0`.

```text
training-collector/tools/extract_behavior_features.js
training-collector/tools/analyze_behavior_features.js
docs/A2_NATIVE_FEATURE_VALIDATION.md
```

A2 derives pointer path/speed/acceleration/turn/corrections, click hold/acquisition, hover approach+dwell+leave, vertical/horizontal wheel burst features, keyboard hold/inter-key timing and target geometry.

Native gate across five recent sessions showed useful click/hover/scroll/keyboard coverage. Drag remains sparse and must use fallback rather than a confident learned distribution.

---

# A3 — IN PROGRESS: Empirical Behavior Baseline

Main files:

```text
training-collector/tools/build_behavior_baseline.js
control-center/manager/behavior/empirical_policy.js
control-center/script/checks/empirical_behavior_policy.js
```

Baseline version `0.1.0` uses aggregated robust quantiles only:

```text
p10 / p25 / p50 / p75 / p90
```

No literal human trajectory is stored or replayed.

Initial behavior families:

```text
pointer-click
pointer-hover
scroll-vertical
scroll-horizontal
keyboard-text
keyboard-key
pointer-drag (sparse fallback)
```

Context buckets currently include target size when enough samples exist. Runtime sampling stays bounded between empirical quantiles, which naturally clips extreme raw tails rather than sampling them directly.

---

# CDP Execution Planner — NEW

```text
control-center/manager/execution/cdp_plan.js
control-center/script/checks/cdp_execution_plan.js
```

CDP Plan version `0.1.0` converts mapped Agent Action + Execution Behavior + current target geometry into exact steps.

Implemented planner families:

```text
pointer-click
  adaptive target point
  bounded curved approach path
  dwell
  mousePressed
  empirical hold
  mouseReleased

pointer-hover
  approach path
  optional dwell

scroll vertical/horizontal
  multi-event wheel burst
  separate axis
  bounded empirical duration/delta

keyboard text/key
  task text emitted per character with empirical timing
  no human captured printable content is used

navigate/reload
```

Natural execution is generated from aggregate constraints; it is not random jitter everywhere and not trajectory replay.

---

# P0 Agent Runtime — V0.2 Target Registry + allowlisted plan dispatch

Main files:

```text
control-center/extension/agent-runtime-extension/manifest.json
control-center/extension/agent-runtime-extension/target_registry.js
control-center/extension/agent-runtime-extension/cdp_plan_dispatcher.js
control-center/extension/agent-runtime-extension/background.js
control-center/script/checks/agent_runtime_target_registry.js
control-center/script/checks/cdp_plan_dispatcher.js
```

Runtime extension version `0.2.0`.

## Observation Target Registry

Every observation gets a short-lived `observationId`.

```text
observationId + targetRef
→ tab + frame
→ semantic descriptor
→ current observation rect
→ internal-only selector when available
```

Public observation does NOT expose internal selector. Brain sees semantic `targetRef` + role/label/rect only.

Target refs are observation-bound:

```text
new observation
navigation/loading
TTL expiry
runtime detach
→ old targetRef becomes stale
```

Stale target must fail and trigger re-observation; never blindly reuse old coordinates.

Current TTL: 4 seconds. This is intentionally short for the one-action-per-observation Agent loop and can be tuned after native tests.

## Direct CDP primitives now available

```text
navigate / reload / back / forward
pressKey / typeText
moveTo / hover
click / doubleClick
focus
scrollVertical / scrollHorizontal
```

Legacy normalized execution remains temporarily for debugging.

## EXECUTE_PLAN

Runtime now accepts exact CDP plans from the manager, but only through a strict allowlist:

```text
Input.dispatchMouseEvent
Input.dispatchKeyEvent
Input.insertText
Page.navigate
Page.reload
Page.getNavigationHistory
Page.navigateToHistoryEntry
```

`Runtime.evaluate` and arbitrary CDP methods are NOT accepted through `EXECUTE_PLAN`.

For target-bound plans, a valid current `observationId + targetRef` is required before dispatch. After plan execution the observation is invalidated, enforcing re-observation.

---

# Latest CI gate

Target registry gate:

```text
run: 32881807557
result: SUCCESS
```

Latest CDP planner/dispatcher run contains passing Agent/A1/A2/A3/planner/registry/dispatcher steps; use the latest workflow run on `main` as implementation gate before native testing.

CI success is not native Chrome validation.

---

# NEXT — A4 preparation / Manager one-action bridge

Implement one callable pipeline:

```text
OBSERVE
→ observationId + semantic target list
→ Strategy emits ONE Agent Action
→ mapAgentAction
→ empirical_policy.sampledBehavior
→ cdp_plan.buildCdpPlan
→ Runtime EXECUTE_PLAN(observationId)
→ OBSERVE AFTER
```

First native actions should be deliberately small and observable:

```text
click semantic button/link
hover semantic target
vertical scroll
horizontal scroll
focus + type text
back/forward
```

Do not start autonomous multi-step tasks until this one-action bridge proves stale-target handling and outcome re-observation.

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
```

Potential future actions, only when task/evidence requires them:

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
10. CI success != native Chrome Agent validation.
11. Update STATUS/JOURNAL after architecture or dataset-contract milestones.
