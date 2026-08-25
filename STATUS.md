# STATUS — 2026-08-26

## Source of truth

GitHub `banupham/extension_agent` là source chính.

```bat
git pull
```

Trước khi sửa code: `STATUS.md` → `docs/PROJECT_JOURNAL.md` → source/tests hiện tại trên `main`.

---

# CURRENT FOCUS — AGENT / Phase A2

Training Collector V0.8 transport/capture gate đã đạt và chuyển sang stability/regression support.

```text
continuous socket ingest      PASS
late-server IndexedDB replay  PASS
no missing/duplicate seq      PASS
multi-frame/multi-tab         PASS
SPA routes                    PASS
login privacy boundary        PASS
browser close finalize        PASS
```

Không tiếp tục tối ưu Collector transport nếu không có regression mới.

---

# Agent Phase A0 — COMPLETE

Execution boundary:

```text
TASK
→ OBSERVER
→ STRATEGY / BRAIN
→ AGENT ACTION CONTRACT        = WHAT
→ EXECUTION BEHAVIOR CONTRACT = HOW naturally
→ CDP EXECUTION PLAN           = exact browser-native plan
→ AGENT RUNTIME EXTENSION      = dispatch
→ CHROME
→ OBSERVE AFTER
→ GOAL CHECK / REPLAN
```

Hard invariant:

```text
Strategy does NOT emit raw selector / coordinate / CDP packet.
Behavior does NOT decide task intent.
Executor does NOT decide strategy.
```

CDP is the standard in-page execution layer. `chrome.tabs.*` remains tab lifecycle control-plane.

Key files:

```text
control-center/AGENT_ACTION_CONTRACT.json
control-center/manager/strategy/agent_action_contract.js
control-center/manager/strategy/execution_behavior_contract.js
docs/AGENT_ACTION_CDP_MAP.md
docs/AGENT_EXECUTOR_GAP_MAP.md
```

Deterministic `control-center/ACTION_CONTRACT.json` remains separate.

---

# Phase A1 — COMPLETE: Action Window Builder

Main files:

```text
training-collector/tools/build_action_windows.js
training-collector/tools/analyze_action_windows.js
training-collector/tests/action_window_contract.js
training-collector/tests/action_window_quality_contract.js
docs/A1_NATIVE_DATASET_VALIDATION.md
```

Current derived Action Window version: `0.1.4`.

Window model:

```text
BEFORE
→ physical/semantic lead-in
→ SEMANTIC ACTION
→ AFTER / mutation / route / state
→ OUTCOME
```

Current families:

```text
click
dismiss
toggle
focus
selectOption
submit
drag
hover / hoverAndObserve
scrollVertical
scrollHorizontal
typeText
pressKey
```

## A1 completed invariants

### Real DOM descriptor alignment

Native raw uses `targetDescriptor` / `resolvedTargetDescriptor`; A1 treats these as implementation truth and only keeps older aliases for compatibility.

### Actionable-parent semantic label enrichment

```text
resolvedTargetDescriptor
→ descriptor index / semantic snapshot
→ targetDescriptor
→ raw descendant fallback
```

Derived output records `labelSource` and `labelEnriched`. Missing labels are never invented.

### Hover noise filtering

Raw hover remains untouched. Derived Action Windows filter known generic background/container targets only when there is no stronger semantic/outcome evidence.

### Hover physical trajectory — A1.4

A1 now embeds bounded pointer facts around hover:

```text
up to 1.2 s pointer approach before hover-enter
→ dwell/outcome
→ up to 0.5 s pointer leave trajectory after hover end
```

Native spot validation showed pointer approach evidence on roughly 85–89% of hover-enter events across the recent real sessions. A2 no longer needs a second raw reconstruction path just to recover hover approach.

### Physical facts preserved for A2

```text
pointer: phase / x / y / movement / buttons / pressure / timing
wheel: x / y / deltaX / deltaY / deltaMode / timing
keyboard: phase / operation class / timing / modifiers
```

Printable human key content remains absent.

### Training eligibility split

Strategy and Behavior eligibility remain separate:

```text
unlabeled click + strong pointer path
→ Strategy: may reject
→ Behavior: useful
```

Real click label coverage remains site-dependent (roughly 40–67% in recent sessions); this is not a reason to fabricate semantics.

### A1 native-data gate

Five real V0.8 sessions were checked. Evidence includes Facebook login/post-login actions, horizontal carousel scroll, TikTok/video/short-drama flows, YouTube/Google, multi-tab/multi-frame, hover, dismiss/modal, and session lifecycle.

Important data limitation carried forward: real drag demonstrations are still sparse. A2 supports drag extraction, but A3 must not fit a confident drag distribution from the current small sample.

A1 hover trajectory CI:

```text
commit: 5641b67a11c4b52dec9907ec320c3003ba1a1570
run:    32878588181
result: SUCCESS
```

---

# Phase A2 — IN PROGRESS: Behavior Feature Extractor

New files:

```text
training-collector/tools/extract_behavior_features.js
training-collector/tests/behavior_feature_contract.js
```

Behavior Feature version: `0.1.0`.

Current extractor derives:

```text
pointer click/hover/drag:
  sample count
  duration
  displacement
  path length
  straightness
  speed distribution
  mean absolute acceleration
  acquisition pause
  hover dwell / leave path

scroll:
  burst duration
  event count
  total delta
  absolute primary-axis delta
  median/P90 delta
  inter-event timing
  direction changes

keyboard:
  event timing
  key-down count
  operation class counts
  repeat count
  no printable content

target context:
  role/tag
  width/height/area/aspect ratio
```

A2 is derived data only; Collector raw is unchanged.

Latest A2-enabled CI:

```text
commit: 0c450c8d1e7ff59d259eb65f26a3adff5e938df2
run:    32878914977
result: SUCCESS
```

## A2 next gate

Run A2 on native A1 sessions and inspect distributions/missingness before adding more features. Especially measure:

```text
click approach path coverage
hover approach/leave coverage
pointer speed/acceleration stability
scroll burst distributions by axis
keyboard burst/gap distributions
drag sample count and quality
target geometry coverage
outliers caused by tab/frame/context transitions
```

Do not add complex learned behavior models until these offline distributions are understood.

---

# “Tay chân” Agent — executor gap

Current experimental runtime directly executes only:

```text
openUrl
pressKey
type
```

The most important P0 gap remains the **Observation Target Registry**:

```text
observationId + targetRef
→ tab/frame/document
→ semantic descriptor / current rect
→ resolvable CDP target
```

The Brain must be able to emit `click e17`; stale refs must fail and trigger re-observation, never blind coordinate reuse.

P0 executor expansion after A2/A3 feature design stabilizes:

```text
target registry
pointer move/hover/click/doubleClick
vertical/horizontal wheel
focus + text/key execution
navigate/back/forward/reload
```

P1:

```text
drag
scrollIntoView
selectOption/setChecked/toggle/submit/dismiss
tab lifecycle
hoverAndObserve/waitAndObserve
```

Potential future action candidates, not yet core contract:

```text
contextClick
pressAndHold
openLinkInNewTab
selectText
uploadFile
```

Media verbs compile to generic semantic click/drag; do not add site-specific YouTube/TikTok executor methods.

---

# Roadmap

```text
A2 Behavior Feature Extractor
→ native feature-distribution validation

A3 Empirical Behavior Baseline
→ context-conditioned distributions, no complex model yet

P0 executor expansion
→ target registry + CDP input/navigation primitives

A4 One-action Agent Runtime Bridge
→ Strategy → Agent Action → Behavior → CDP → Observe After

A5 Goal Checker + Replan
```

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
5. Derived cleanup belongs in dataset tooling; never overwrite raw truth.
6. Strategy and Behavior dataset eligibility are separate concepts.
7. `tsEpochMs` is global dataset time; `sessionSeq` is durability order.
8. Human demonstrations provide distributions/context, not literal replay.
9. CI success != native Chrome Agent validation.
10. Update STATUS/JOURNAL after architecture or dataset-contract milestones.
