# STATUS — 2026-08-26

## Source of truth

GitHub `banupham/extension_agent` là source chính.

```bat
git pull
```

Trước khi sửa code: `STATUS.md` → `docs/PROJECT_JOURNAL.md` → source/tests hiện tại trên `main`.

---

# CURRENT FOCUS — AGENT / Phase A1

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

# Phase A1 — IN PROGRESS: Action Window Builder

Main files:

```text
training-collector/tools/build_action_windows.js
training-collector/tests/action_window_contract.js
```

Current derived Action Window version: `0.1.3`.

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

## A1 fixes already implemented

### Real DOM descriptor alignment

Collector raw uses:

```text
targetDescriptor
resolvedTargetDescriptor
```

A1 now reads these real fields. Earlier synthetic aliases (`resolvedTarget`) were insufficient for native data.

### Actionable-parent label enrichment

Derived target label resolution:

```text
resolvedTargetDescriptor
→ descriptor index / semantic snapshot
→ targetDescriptor
→ raw descendant fallback
```

Derived output records `labelSource` and `labelEnriched`. Raw facts are never mutated.

### Hover noise filtering

Raw keeps all hover facts. A1 filters only derived training windows for known generic background/container targets such as `html`, `body`, `ytd-app`, `ytd-browse` when there is no stronger semantic evidence.

Preview-like hover is retained when UI mutation/outcome supports semantic intent.

### Preserve behavior facts for A2

Action Windows now retain safe physical facts required for behavior learning:

```text
pointer: phase / x / y / movement / buttons / pressure / timing
wheel: x / y / deltaX / deltaY / deltaMode / timing
keyboard: phase / operation class / timing / modifiers
```

Printable human key content remains absent.

### Drag derivation

A1 derives `drag` from:

```text
pointer down
→ continuous move samples
→ pointer up
```

with duration, distance, start/end and full safe point series. This supports slider/seek/volume demonstrations.

### High-confidence semantic promotion

Only high-confidence cases are promoted:

```text
role=switch/checkbox or dom-change.checked → toggle
known close/dismiss labels             → dismiss
dom-change.selectedIndex               → selectOption
dom-submit                              → submit
dom-focus focused=true                  → focus
```

Ambiguous actions such as Facebook Like remain generic `click` unless state evidence is strong enough.

---

# “Tay chân” Agent — executor gap

Current experimental runtime still directly executes only a small subset:

```text
openUrl
pressKey
type
```

The most important P0 gap is not another semantic verb; it is the **Observation Target Registry**:

```text
observationId + targetRef
→ tab/frame/document
→ semantic descriptor / current rect
→ resolvable CDP node/runtime target
```

The Brain must be able to emit `click e17`; stale refs must fail and trigger re-observation, never blind coordinate reuse.

P0 executor expansion after A1/A2/A3 design:

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

See `docs/AGENT_EXECUTOR_GAP_MAP.md`.

---

# A1 next gate

Run the A1 builder on native Facebook/TikTok/YouTube socket JSONL and measure:

```text
action family counts
resolved/enriched label coverage
hover windows kept vs filtered
pointer facts around click
real drag windows
horizontal vs vertical scroll bursts
keyboard privacy
outcome mutation/route coverage
frame-aware target identity
```

Then decide whether A1 needs additional derivation rules before A2.

Ordering invariant:

```text
tsEpochMs = primary global reconstruction time
pageSeq/sourceSeq = local ordering
sessionSeq = persistence/integrity only
```

---

# After A1

```text
A2 Behavior Feature Extractor
→ pointer/keyboard/scroll/drag features

A3 Empirical Behavior Baseline
→ context-conditioned distributions

A4 One-action Agent Runtime Bridge
→ Strategy → Agent Action → Behavior → CDP → Observe After

A5 Goal Checker + Replan
```

Do not train complex models before A2/A3 offline metrics are stable.

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
5. Derived cleanup belongs in dataset tooling, never overwrite raw truth.
6. `tsEpochMs` is global dataset time; `sessionSeq` is durability order.
7. Human demonstrations provide distributions/context, not literal replay.
8. CI success != native Chrome Agent validation.
9. Update STATUS/JOURNAL after architecture or dataset-contract milestones.
