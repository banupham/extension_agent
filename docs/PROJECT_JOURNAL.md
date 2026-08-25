# PROJECT JOURNAL — persistent engineering memory

Mục đích: bộ nhớ kỹ thuật lâu dài cho `banupham/extension_agent`.

```text
STATUS.md
→ current milestone / next gate

PROJECT_JOURNAL.md
→ lookup map / invariants / rationale / regressions

source trên main
→ implementation truth
```

Nếu journal mâu thuẫn với source, source hiện tại trên `main` là implementation truth; sau đó cập nhật journal.

---

# 1. Quy trình trước khi sửa code

```text
1 đọc STATUS.md
2 đọc/search PROJECT_JOURNAL.md theo component/problem
3 fetch source hiện tại trên main
4 fetch contract/test liên quan
5 sửa theo boundary
6 chạy CI/offline test
7 browser validation nếu runtime behavior
8 cập nhật STATUS/JOURNAL nếu có milestone/invariant mới
```

---

# 2. Product boundaries

```text
RECORDER
Human → deterministic Scenario

TRAINING COLLECTOR
Human → raw physical + semantic browser session

AGENT
Task → Strategy → Agent Action → Behavior → CDP Plan → Executor
```

Hard boundary:

```text
Strategy       = WHAT
Behavior Policy= HOW naturally
CDP Planner    = exact browser-native plan
Executor       = dispatch browser commands
```

Scenario Mode không bị thay bằng Agent Mode.

---

# 3. Training Collector stable baseline — V0.8

Runtime:

```text
manifest 0.8.0
raw schema 0.7.2
```

Primary flow:

```text
all-frame content capture
→ RAW_BATCH + batchId
→ background normalize + sessionSeq
→ IndexedDB append/receipt dedupe
→ localhost WebSocket mirror
→ append-only server JSONL
```

Critical invariant:

```text
persist IndexedDB first
→ socket mirror second
```

Socket failure must never remove/replace browser-side raw persistence.

## Socket lookup

Read:

```text
training-collector/core/socket_mirror.js
training-collector/background.js
training-collector/socket-server/server.js
training-collector/socket-server/integration_test.js
training-collector/socket-server/README.md
training-collector/tests/v08_socket_mirror_contract.js
```

Protocol:

```text
client-hello
session-open
session-ack { resumeFromSeq }
event-batch
batch-ack { lastSeq }
resync { resumeFromSeq }
session-close
heartbeat
```

Server rules:

```text
duplicate <= lastSeq → ignore
gap → resync
append JSONL → persist meta → ACK
server restart → scan durable JSONL → resumeFromSeq
```

Native validation achieved:

```text
continuous socket archive      PASS
late-server replay             PASS
no missing/duplicate seq       PASS
multi-browser concurrent       PASS
multi-tab / multi-frame        PASS
SPA routes                     PASS
login-form observation         PASS
credential privacy             PASS
browser close >45s finalize    PASS
session-end                    PASS
```

Collector now enters stability/regression support. Do not keep optimizing transport without a regression.

Manual gzip remains fallback/debug only. Downloads/offscreen auto-export is not the architecture.

---

# 4. Collector semantic/capture lookup

## Physical

```text
training-collector/capture/physical_capture.js
training-collector/correlation/physical_semantic_correlator.js
training-collector/content.js
```

Raw physical remains un-derived.

## Action targets

```text
training-collector/capture/dom_capture.js
training-collector/correlation/action_target_resolver.js
training-collector/observer/semantic_observer.js
training-collector/observer/element_registry.js
```

Keep both:

```text
rawTargetRef
resolvedTargetRef
```

Never overwrite raw fact with interpreted target.

## Hover

```text
training-collector/observer/hover_trace.js
training-collector/observer/mutation_trace.js
training-collector/tools/build_action_semantics.js
```

Raw:

```text
dom-hover-enter
dom-hover-dwell
dom-hover-leave
```

Derived offline:

```text
hover
hover-dwell
hover-preview
```

Regression: YouTube thumbnail hover → animated preview/control appears without navigation.

## Frame identity

```text
tabId + frameId + pageInstanceId + elementRef
```

`elementRef` is not globally unique.

## SPA

```text
route-change
→ semantic snapshot re-anchor
```

## Timeline

```text
tsEpochMs  = capture time / primary global reconstruction axis
pageSeq    = page-local order
sourceSeq  = source-local order
sessionSeq = durable persistence order
```

Never use `sessionSeq` as chronological truth in dataset generation.

---

# 5. Privacy invariants

Never capture/store/train raw:

- password/credential values;
- cookies;
- Authorization/access/refresh tokens;
- local/session storage secrets;
- clipboard contents;
- payment secrets;
- raw sensitive input values;
- printable human key content;
- URL query/hash secret contents.

Typing Behavior may learn timing/operation classes, not human typed content.

---

# 6. Agent Phase A0 — semantic action + behavior + CDP map

Read first:

```text
control-center/AGENT_ACTION_CONTRACT.json
control-center/manager/strategy/agent_action_contract.js
control-center/manager/strategy/execution_behavior_contract.js
control-center/script/checks/agent_action_contract.js
docs/AGENT_ACTION_CDP_MAP.md
docs/AGENT_TRAINING_ARCHITECTURE.md
```

Deterministic contract remains separate:

```text
control-center/ACTION_CONTRACT.json
```

Do not migrate Scenario Mode onto Agent vocabulary.

## Agent Action Contract v0.1

Vocabulary:

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

observation:
  hoverAndObserve waitAndObserve dismiss
```

Strategy action must use semantic `targetRef` when target-bound. Strategy must not emit raw selector, coordinate or CDP method as its primary representation.

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

## CDP mapping principles

```text
click/hover/drag
→ Input.dispatchMouseEvent

scroll vertical/horizontal
→ Input.dispatchMouseEvent(mouseWheel)

typeText/pressKey
→ Input.dispatchKeyEvent / Input.insertText

navigate
→ Page.navigate

back/forward
→ Page.getNavigationHistory + Page.navigateToHistoryEntry
```

`chrome.tabs.*` is allowed as tab lifecycle control-plane; in-page interaction should be standardized around CDP/browser-native execution.

## Existing Agent Runtime state

Read:

```text
control-center/extension/agent-runtime-extension/background.js
```

Current runtime is experimental and currently directly implements only:

```text
openUrl
pressKey
type
```

Do not confuse current executor coverage with the Agent semantic contract target. Runtime expansion happens after A1/A2/A3 design is stable enough.

---

# 7. Human demonstrations → natural execution

Human demonstration is NOT trajectory replay.

Learn context-conditioned distributions/constraints.

Pointer click features:

```text
start position
path length / displacement
duration
velocity / acceleration / jerk
curvature
overshoot/correction
near-target slowdown
dwell
mouseDown→mouseUp hold
```

Hover:

```text
approach
enter
dwell
UI mutation/state response
leave
```

Scroll:

```text
axis
delta burst
timing
pause
settling/correction
```

Horizontal and vertical scroll are separate families. Facebook carousel is a regression case for horizontal scroll.

Keyboard:

```text
focus-to-type pause
inter-key timing
burst/pause structure
Backspace/Delete/Tab/Enter timing
```

Drag/slider:

```text
handle acquisition
press
continuous trajectory
correction near requested value
release
```

Natural behavior is not random delay/jitter everywhere.

---

# 8. NEXT — Phase A1 Action Window Builder

Purpose:

```text
raw human session
→ candidate semantic demonstrations
```

Window shape:

```text
BEFORE
→ physical approach / hover / focus / wheel / key timing
→ SEMANTIC ACTION
→ AFTER / mutation / route / semantic state
→ OUTCOME
```

Initial derived actions:

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

A1 dataset-side responsibilities:

```text
actionable-parent semantic-label enrichment
hover html/body/container noise filtering
frame-aware target identity
tsEpochMs reconstruction
before/action/after/outcome windows
```

Do not modify raw Collector facts to make the dataset cleaner.

Regression demonstrations to keep:

```text
YouTube hover-preview
embedded iframe controls
YouTube media controls / playback rate
Facebook like / comments
Facebook horizontal carousel
login without credential leakage
TikTok dynamic video routes
short-drama login-gated modal + dismiss
multi-tab/multi-frame
```

---

# 9. Agent roadmap after A1

```text
A2 Behavior Feature Extractor
↓
A3 Empirical context-conditioned Behavior Baseline
↓
A4 One-action Agent Runtime Bridge
↓
A5 Goal Checker + Replan
↓
retrieval/learned Strategy
↓
learned Behavior policy only after stable offline metrics
```

A3 should start with empirical distributions, not a complex model.

---

# 10. Agent safety boundary

CAPTCHA/human verification:

```text
observe
→ status=blocked
→ reasonCode=human_verification_required
→ no automatic solve/bypass
→ no blind reload/click loop
→ legitimate alternate route only if independently serves task
```

See `docs/AGENT_BOUNDARY_CONDITIONS.md`.

---

# 11. CI map

Workflow:

```text
.github/workflows/extension-syntax.yml
```

Agent checks:

```text
control-center/script/checks/strategy_contract.js
control-center/script/checks/agent_action_contract.js
```

Collector checks include storage/action/frame/socket contracts and real localhost socket integration test.

CI success != native Chrome runtime validation.

---

# 12. Architectural decisions

## D001 — Scenario Mode and Agent Mode stay separate
Protect deterministic execution.

## D002 — Recorder and Training Collector are different products
Recorder → Scenario; Collector → training telemetry.

## D003 — Physical raw stays un-derived
Behavior features are offline-derived.

## D004 — DOM semantic signal is core; physical supplements it
Agent needs target/state/outcome.

## D005 — Physical↔semantic correlation near capture time
Avoid target drift.

## D006 — Mutation uses bursts
Raw mutation noise otherwise dominates.

## D007 — IndexedDB is browser-side raw persistence
Downloads are not storage architecture.

## D008 — Manual/download export is debug fallback only
V0.8 primary development archive is socket JSONL.

## D009 — Batch receipts make RAW_BATCH retries idempotent
ACK loss must not duplicate raw events.

## D010 — Natural Execution is a separate layer
Strategy=WHAT; Behavior=HOW.

## D011 — Hover can be a semantic action with outcome
Not all meaningful actions navigate/click.

## D012 — Raw and resolved action targets coexist
Interpretation must not destroy raw fact.

## D013 — pageSeq/sourceSeq support reconstruction
sessionSeq is persistence order.

## D014 — hover-preview is derived offline
Raw keeps hover/state facts.

## D015 — CAPTCHA is an Agent boundary condition
Blocked/replan legitimately; no automatic solve/bypass.

## D016 — Frame identity is composite
`tabId + frameId + pageInstanceId + elementRef`.

## D017 — All-frame raw does not imply multi-frame Agent Episode
Explicit Agent Observation contract is required first.

## D018 — SPA route changes need semantic re-anchor
route-change + semantic snapshot.

## D019 — Stream silence must be observable
collector-stream-health diagnostics.

## D020 — Socket mirror is post-persist transport
IndexedDB first, socket second.

## D021 — Socket resume uses server durable sequence
Server returns `resumeFromSeq`; extension replays IndexedDB.

## D022 — Server tolerates duplicates and rejects sequence gaps
Duplicate ignore; gap → resync.

## D023 — Socket disconnect is not immediate session end
Use grace window.

## D024 — Continuous JSONL is preferred development archive
Manual gzip is fallback.

## D025 — Socket protocol requires integration CI
Static contracts are insufficient.

## D026 — Agent has its own semantic Action Contract
Do not reuse deterministic selector-heavy `ACTION_CONTRACT.json` as Agent brain vocabulary.

## D027 — CDP is Agent execution standard
Strategy stays semantic; exact CDP belongs below Behavior Policy.

## D028 — Agent execution is four-layered
`Action → Behavior → CDP Plan → Executor` keeps reasoning, fidelity and mechanics independently testable.

## D029 — Human demonstrations define distributions/context, not literal replay
Natural execution must generalize to unseen geometry/state.

---

# 13. Engineering milestones

```text
V0.7 Action Semantics
→ raw/resolved targets + hover lifecycle

V0.7.2 Frame-Aware Stream Diagnostics
→ all-frame + route re-anchor + stream health

V0.8 Socket Mirror
→ IndexedDB safety + localhost continuous JSONL

V0.8 native transport gate
→ late-server replay + concurrent sessions + close finalization validated

Agent Phase A0
→ Agent Action Contract v0.1
→ Execution Behavior Contract v0.1
→ Action→Behavior→CDP mapping
→ CI smoke test
```

Current next gate: **A1 Action Window Builder**.

---

# 14. Maintenance rule

Update journal when module responsibility, contract/protocol, difficult invariant, version/migration, test gate or architecture boundary changes. Do not log every commit.
