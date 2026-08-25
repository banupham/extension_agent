# STATUS — 2026-08-25

## Source of truth

GitHub `banupham/extension_agent` là source chính.

```bat
git pull
```

Trước khi sửa code: `STATUS.md` → `docs/PROJECT_JOURNAL.md` → source/tests hiện tại trên `main`.

---

# CURRENT FOCUS — AGENT

Training Collector V0.8 transport/capture gate đã đạt qua native Chrome sessions và server JSONL:

```text
continuous socket ingest      PASS
late-server IndexedDB replay  PASS
no missing/duplicate seq      PASS
multi-frame/multi-tab         PASS
SPA routes                    PASS
login form observation        PASS
credential privacy boundary   PASS
browser close >45s finalize   PASS
session-end                   PASS
```

Collector từ đây chuyển sang stability/regression support. Không tiếp tục tối ưu transport nếu không có regression mới.

---

# Agent Phase A0 — COMPLETE: Semantic Action + Behavior + CDP Map

## Four-layer execution boundary

```text
TASK
→ OBSERVER
→ STRATEGY / BRAIN
→ AGENT ACTION CONTRACT        = WHAT
→ EXECUTION BEHAVIOR CONTRACT = HOW naturally
→ CDP EXECUTION PLAN           = exact browser-native plan
→ AGENT RUNTIME EXTENSION      = dispatch CDP
→ CHROME
→ OBSERVE AFTER
→ GOAL CHECK
→ REPLAN
```

Hard invariant:

```text
Strategy does NOT emit raw selector / coordinate / CDP packet.
Behavior does NOT decide task intent.
Executor does NOT decide strategy.
```

CDP is the execution standard for page interaction. `chrome.tabs.*` remains control-plane for tab lifecycle.

## New Phase A0 files

```text
control-center/AGENT_ACTION_CONTRACT.json
control-center/manager/strategy/agent_action_contract.js
control-center/manager/strategy/execution_behavior_contract.js
control-center/script/checks/agent_action_contract.js
docs/AGENT_ACTION_CDP_MAP.md
```

`control-center/manager/strategy/index.js` exports the new contracts.

Deterministic `control-center/ACTION_CONTRACT.json` remains unchanged and separate.

## Agent Action Contract v0.1 vocabulary

```text
navigation:
  navigate back forward reload switchTab openNewTab closeTab

pointer:
  click doubleClick hover moveTo drag

scroll:
  scrollVertical scrollHorizontal scrollIntoView

keyboard:
  focus typeText replaceText clear pressKey keyCombo

forms:
  selectOption setChecked toggle submit

media:
  play pause mute unmute setVolume seek changePlaybackRate

observation-dependent:
  hoverAndObserve waitAndObserve dismiss
```

Human verification/CAPTCHA is not an action; it remains `status=blocked`, `reasonCode=human_verification_required`.

## Behavior families v0.1

```text
pointer-click
pointer-hover
pointer-drag
scroll-vertical
scroll-horizontal
scroll-target-acquisition
keyboard-text
keyboard-key
focus-acquisition
form-control
media-control
navigation
observation-wait
```

Behavior Policy will learn distributions/context from human demonstrations; it must not replay human trajectories verbatim or use generic random jitter/delay.

## CDP mapping examples

```text
click / hover / drag
→ Input.dispatchMouseEvent

scrollVertical / scrollHorizontal
→ Input.dispatchMouseEvent(mouseWheel)

typeText / pressKey
→ Input.dispatchKeyEvent / Input.insertText

navigate
→ Page.navigate

back / forward
→ Page.getNavigationHistory + Page.navigateToHistoryEntry
```

Current experimental Agent Runtime executor still only directly supports a small subset (`openUrl`, `pressKey`, `type`). The semantic/CDP map is now the contract target for later runtime expansion.

---

# NEXT — Phase A1: Action Window Builder

Build an offline tool that transforms raw V0.8 human sessions into candidate semantic demonstrations:

```text
BEFORE
→ physical approach / hover / focus / wheel / key timing
→ SEMANTIC ACTION
→ AFTER state / mutation / route
→ OUTCOME
```

Initial actions:

```text
click
hover / hoverAndObserve
scrollVertical
scrollHorizontal
typeText
pressKey
drag
toggle
dismiss
```

Ordering rule:

```text
tsEpochMs = primary global reconstruction time
pageSeq   = page-local ordering
sourceSeq = source-local ordering
sessionSeq= persistence/integrity only; NOT chronological truth
```

A1 regression demonstrations to preserve:

```text
YouTube hover-preview
embedded iframe interactions
YouTube media controls / playback rate
Facebook like / comments
Facebook horizontal carousel
login form without credential leakage
TikTok SPA video switching
short-drama login-gated modal + dismiss
multi-tab / multi-frame activity
```

A1 must also address dataset-side:

```text
actionable-parent semantic label enrichment
hover background/container noise filtering
```

Do not mutate raw Collector facts to achieve this; derived semantics belong in dataset tooling.

---

# After A1

```text
A2 Behavior Feature Extractor
→ pointer/keyboard/scroll/drag features

A3 Empirical Behavior Baseline
→ context-conditioned distributions, no complex model yet

A4 One-action Agent Runtime Bridge
→ Strategy → Agent Action → Behavior → CDP → Observe After

A5 Goal Checker + Replan

then:
retrieval/learned Strategy
context-conditioned/learned Behavior Model
```

---

# Agent evaluation axes

```text
Planning quality
→ task success / progress / recovery

Action correctness
→ correct semantic action + target

Execution fidelity
→ trajectory/timing vs held-out human demonstrations

Runtime reliability
→ CDP execution + observation consistency
```

Natural execution must never reduce correctness merely to look human-like.

---

# Collector stable baseline

Runtime: `Training Collector V0.8 Socket Mirror`  
Raw schema: `0.7.2`

```text
IndexedDB = browser-side safety buffer
localhost WebSocket = development archive
manual gzip = fallback/debug only
```

Do not reintroduce Downloads/offscreen auto-export as the primary data pipeline.

---

# Development rules

1. GitHub is source of truth.
2. Scenario Mode and Agent Mode remain separate.
3. Strategy = WHAT; Behavior = HOW; CDP Planner = exact plan; Executor = dispatch.
4. CDP is the standard page-interaction execution layer for Agent.
5. Collector raw stays un-derived and privacy-filtered.
6. Dataset derivation must use `tsEpochMs` as global time axis; `sessionSeq` is durability order.
7. Human demonstrations provide distributions/context, not literal trajectory replay.
8. CI success != native Chrome validation.
9. Update STATUS/JOURNAL after architectural milestones.
