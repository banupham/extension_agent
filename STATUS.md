# STATUS — 2026-08-26

## Source of truth

GitHub `banupham/extension_agent` là source chính.

```bat
git pull
```

Trước khi sửa code: `STATUS.md` → `docs/PROJECT_JOURNAL.md` → source/tests hiện tại trên `main`.

---

# CURRENT FOCUS — AGENT / Phase A3

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

Không tiếp tục tối ưu Collector transport nếu không có regression mới.

---

# Agent execution boundary

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

---

# Phase A0 — COMPLETE

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

Current Action Window version: `0.1.4`.

```text
training-collector/tools/build_action_windows.js
training-collector/tools/analyze_action_windows.js
training-collector/tests/action_window_contract.js
training-collector/tests/action_window_quality_contract.js
docs/A1_NATIVE_DATASET_VALIDATION.md
```

Families:

```text
click / dismiss / toggle
focus / selectOption / submit
drag
hover / hoverAndObserve
scrollVertical / scrollHorizontal
typeText / pressKey
```

Important invariants:

```text
raw remains unchanged
resolvedTargetDescriptor is implementation truth
missing semantic label is never invented
hover background noise filtered only in derived dataset
hover windows embed bounded pointer approach + leave
safe physical facts preserved for A2
Strategy eligibility != Behavior eligibility
tsEpochMs is global reconstruction time
sessionSeq is durability order only
```

Native A1 gate used five real V0.8 sessions covering Google/YouTube, Facebook login/post-login, TikTok/video/short-drama, horizontal carousel, hover, modal dismiss, multi-tab/multi-frame.

---

# Phase A2 — COMPLETE: Behavior Feature Extractor

Main files:

```text
training-collector/tools/extract_behavior_features.js
training-collector/tools/analyze_behavior_features.js
training-collector/tests/behavior_feature_contract.js
training-collector/tests/behavior_feature_analysis_contract.js
docs/A2_NATIVE_FEATURE_VALIDATION.md
```

Behavior Feature version: `0.2.0`.

Derived pointer features:

```text
sample count / duration
start/end / displacement / path length
straightness
mean/median/P90/max speed
mean absolute acceleration
mean/P90 turn angle
correction count >=45deg
```

Click adds:

```text
acquisition pause
pointer down→up hold
down→DOM-action / DOM-action→up timing
endpoint distance to target center
normalized endpoint distance by target diagonal
```

Hover adds:

```text
approach path
leave path
dwell
preview-like outcome
mutation count
```

Scroll adds:

```text
burst duration/event count
signed + absolute delta
median/P90 event delta
inter-event gaps
direction changes
correction ratio
```

Keyboard adds:

```text
down/up timing
operation classes
key hold distribution
down→down inter-key rhythm
long pause count
repeat count
```

Printable human key content remains absent.

Target context:

```text
role/tag
x/y/width/height
center
area/aspect ratio
```

A2 analyzer reports robust distributions, coverage and warnings across one or multiple sessions.

Native spot gate across five sessions:

```text
DOM clicks checked:              105
click pointer lead-in:           104
click down→up pair:               94 (~89.5%)
hover-enter:                    1449
vertical scroll bursts:          348
horizontal scroll bursts:         27
keyboard hold pairs:             227
derived drag candidates:           1
```

Important observations:

```text
click hold median ~223 ms; long tail exists
hover dwell median ~363 ms
vertical/horizontal scroll have different burst distributions
keyboard gap/hold distributions contain large idle/outlier tails
drag is too sparse for confident fitting
```

These are dataset observations, NOT runtime constants.

Latest full A2 CI:

```text
commit: 19a1865669f6ad3267e7e160f06560443648e4aa
run:    32880751537
result: SUCCESS
```

---

# Phase A3 — IN PROGRESS: Empirical Behavior Baseline

Goal: create context-conditioned behavior sampling from A2 features without a complex learned model.

Initial families:

```text
pointer-click
pointer-hover
scroll-vertical
scroll-horizontal
keyboard-text
keyboard-key
```

Drag remains supported only by conservative fallback until more real demonstrations exist.

A3 rules:

```text
use robust empirical quantiles / bounded sampling
condition by action family + target geometry/context where supported
separate active typing gaps from idle pauses
clip/reject extreme outliers before sampling
never replay a human trajectory verbatim
never use random jitter/delay everywhere
natural behavior must not reduce action correctness
```

Expected output is an Execution Behavior Contract that can later be compiled into an exact CDP plan.

---

# “Tay chân” Agent — executor gap

Experimental Agent Runtime still directly executes only:

```text
openUrl
pressKey
type
```

P0 missing capability remains **Observation Target Registry**:

```text
observationId + targetRef
→ tab/frame/document
→ semantic descriptor/current rect
→ resolvable CDP target
```

Brain should emit `click e17`; stale refs must fail and trigger re-observation, never blind coordinate reuse.

P0 executor expansion after A3 baseline contract stabilizes:

```text
target registry
pointer move/hover/click/doubleClick
vertical/horizontal wheel
focus + text/key
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

Candidate future actions, not core yet:

```text
contextClick
pressAndHold
openLinkInNewTab
selectText
uploadFile
```

Media verbs compile to generic semantic click/drag; no site-specific YouTube/TikTok executor methods.

---

# Roadmap

```text
A3 Empirical Behavior Baseline
→ robust/context-conditioned distributions

P0 executor expansion
→ target registry + CDP input/navigation primitives

A4 One-action Agent Runtime Bridge
→ Strategy → Agent Action → Behavior → CDP → Observe After

A5 Goal Checker + Replan
```

Do not train complex models before A3 offline sampling metrics are stable.

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
9. Sparse families must remain explicitly sparse; do not manufacture confidence.
10. CI success != native Chrome Agent validation.
11. Update STATUS/JOURNAL after architecture or dataset-contract milestones.
