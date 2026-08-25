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
2 search journal theo component/problem
3 fetch source hiện tại trên main
4 fetch contract/test liên quan
5 sửa theo boundary
6 CI/offline test
7 native browser validation nếu runtime behavior
8 cập nhật STATUS/JOURNAL khi invariant/milestone thay đổi
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

```text
Strategy        = WHAT
Behavior Policy = HOW naturally
CDP Planner     = exact browser-native plan
Executor        = dispatch
```

Scenario Mode và Agent Mode không gộp contract.

---

# 3. Collector stable baseline — V0.8

Runtime `0.8.0`, raw schema `0.7.2`.

```text
all-frame content capture
→ RAW_BATCH + batchId
→ background normalize + sessionSeq
→ IndexedDB append/receipt dedupe
→ localhost WebSocket mirror
→ append-only server JSONL
```

Invariant:

```text
IndexedDB persist first
→ socket mirror second
```

Native gate đã đạt:

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

Collector từ đây là stability/regression support. Manual gzip chỉ fallback/debug; không quay lại Downloads/offscreen làm primary pipeline.

Socket lookup:

```text
training-collector/core/socket_mirror.js
training-collector/background.js
training-collector/socket-server/server.js
training-collector/socket-server/integration_test.js
training-collector/tests/v08_socket_mirror_contract.js
```

---

# 4. Collector semantics / raw truth

Physical:

```text
training-collector/capture/physical_capture.js
training-collector/correlation/physical_semantic_correlator.js
```

Action targets:

```text
training-collector/capture/dom_capture.js
training-collector/correlation/action_target_resolver.js
training-collector/observer/semantic_observer.js
```

Raw target invariant:

```text
rawTargetRef
resolvedTargetRef
```

Không overwrite raw target bằng interpreted target.

Actual DOM descriptor field names in native raw:

```text
targetDescriptor
resolvedTargetDescriptor
```

This matters for A1. Synthetic aliases such as `resolvedTarget` are not implementation truth.

Hover raw:

```text
dom-hover-enter
dom-hover-dwell
dom-hover-leave
```

Derived offline only:

```text
hover
hover-dwell
hover-preview
```

Frame identity:

```text
tabId + frameId + pageInstanceId + elementRef
```

SPA route change → semantic snapshot re-anchor.

Timeline:

```text
tsEpochMs  = primary global reconstruction time
pageSeq    = page-local order
sourceSeq  = source-local order
sessionSeq = persistence/integrity order only
```

Never sort training trajectories primarily by `sessionSeq`.

---

# 5. Privacy invariants

Do not capture/store/train raw:

- password/credential values;
- cookies;
- Authorization/access/refresh tokens;
- local/session storage secrets;
- clipboard contents;
- payment secrets;
- printable human key content;
- raw sensitive form values.

Typing Behavior learns timing/operation classes, not human typed content.

---

# 6. Agent Phase A0 — COMPLETE

Read:

```text
control-center/AGENT_ACTION_CONTRACT.json
control-center/manager/strategy/agent_action_contract.js
control-center/manager/strategy/execution_behavior_contract.js
docs/AGENT_ACTION_CDP_MAP.md
docs/AGENT_EXECUTOR_GAP_MAP.md
control-center/extension/agent-runtime-extension/background.js
```

Deterministic `control-center/ACTION_CONTRACT.json` remains separate.

Agent action vocabulary includes navigation, pointer, vertical/horizontal scroll, keyboard/form, media and observation-dependent actions.

Hard boundary:

```text
Strategy must not emit raw selector / coordinates / CDP method.
Behavior must not choose task intent.
Executor must not choose strategy.
```

Human demonstrations define context-conditioned distributions, not literal trajectory replay.

---

# 7. Agent “tay chân” gap map

Current experimental Agent Runtime directly executes only:

```text
openUrl
pressKey
type
```

Most important P0 missing capability is the Observation Target Registry:

```text
observationId + targetRef
→ tab/frame/document
→ semantic descriptor/current rect
→ resolvable CDP target
```

Brain should say `click e17`; Executor resolves it. Stale refs must fail explicitly and trigger re-observation, never reuse stale coordinates blindly.

P0 execution families before useful Agent practice:

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
form controls
dismiss
tab lifecycle
hoverAndObserve/waitAndObserve
```

Candidate future actions, not core until evidence/task demand exists:

```text
contextClick
pressAndHold
openLinkInNewTab
selectText
uploadFile
```

Media verbs should compile to generic semantic click/drag, not site-specific YouTube/TikTok executor methods.

---

# 8. Phase A1 — Action Window Builder

Read first:

```text
training-collector/tools/build_action_windows.js
training-collector/tests/action_window_contract.js
training-collector/tools/build_action_semantics.js
```

Current derived contract: `actionWindowVersion 0.1.3`.

Shape:

```text
BEFORE
→ physical/semantic lead-in
→ SEMANTIC ACTION
→ AFTER / route / mutation
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
hover
hoverAndObserve
scrollVertical
scrollHorizontal
typeText
pressKey
```

## A1 label enrichment

Do not change raw. Derived target label resolution:

```text
resolvedTargetDescriptor
→ descriptor index / semantic snapshot
→ targetDescriptor
→ raw descendant/index fallback
```

Derived fields:

```text
labelSource
labelEnriched
```

This addresses real cases where actionable parent is correct but its own label is empty while descendant/snapshot carries useful accessible text.

## A1 hover noise

Raw hover remains untouched.

Derived filter removes only known generic background/container targets without stronger semantic evidence. Examples:

```text
html
body
ytd-app
ytd-browse
tp-yt-app-drawer
```

Preview-like hover with mutation/outcome evidence is retained.

## A1 physical facts preserved

A1 must not strip behavior information needed by A2.

Safe fields kept:

```text
pointer:
  phase x y movementX movementY button buttons pressure timing

wheel:
  x y deltaX deltaY deltaZ deltaMode timing

keyboard:
  phase operation keyClass non-printable code modifiers timing
```

Printable human key content remains absent.

## A1 drag

Derived from:

```text
pointer down
→ continuous move samples
→ pointer up
```

Output includes duration, distance, start/end and safe point series. This is necessary for slider/seek/volume behavior learning.

## A1 high-confidence semantic promotion

Only promote when evidence is strong:

```text
role=switch/checkbox or dom-change.checked → toggle
known close/dismiss label                 → dismiss
dom-change.selectedIndex                  → selectOption
dom-submit                                → submit
dom-focus focused=true                    → focus
```

Do not promote ambiguous semantic intent. Example: Facebook Like stays generic click unless reliable state evidence is available.

## A1 regression cases

Preserve:

```text
YouTube hover-preview
embedded iframe controls
YouTube media control/slider
Facebook like/comments
Facebook horizontal carousel
login form without credential leakage
TikTok SPA video switching
short-drama login modal + dismiss
multi-tab/multi-frame
```

Next A1 gate: run builder over native Facebook/TikTok/YouTube JSONL and measure label coverage, filtered hover rate, action-family counts, drag quality, scroll bursts, keyboard privacy and outcome coverage.

---

# 9. After A1

```text
A2 Behavior Feature Extractor
→ pointer/keyboard/scroll/drag metrics

A3 Empirical Behavior Baseline
→ context-conditioned distributions

A4 One-action Agent Runtime Bridge
→ Strategy → Agent Action → Behavior → CDP → Observe After

A5 Goal Checker + Replan
```

Do not jump to a complex learned Behavior model before A2/A3 metrics.

---

# 10. Agent safety boundary

CAPTCHA/human verification:

```text
observe
→ status=blocked
→ reasonCode=human_verification_required
→ no automatic solve/bypass
→ no blind retry loop
→ legitimate alternate route only if independently serves task
```

---

# 11. Architectural decisions

## D001 — Scenario Mode and Agent Mode stay separate
## D002 — Recorder and Training Collector are different products
## D003 — Physical raw stays un-derived
## D004 — DOM semantics are core; physical supplements behavior
## D005 — Correlate physical↔semantic near capture time
## D006 — Mutation uses bursts
## D007 — IndexedDB is browser-side raw persistence
## D008 — Manual/download export is fallback only
## D009 — Batch receipts make RAW_BATCH retries idempotent
## D010 — Natural Execution is a separate layer
## D011 — Hover can be a semantic action with outcome
## D012 — Raw and resolved action targets coexist
## D013 — pageSeq/sourceSeq support reconstruction; sessionSeq is persistence order
## D014 — hover-preview is derived offline
## D015 — CAPTCHA is an Agent boundary condition
## D016 — Frame identity is composite
## D017 — All-frame raw does not imply multi-frame Agent Episode
## D018 — SPA route changes need semantic re-anchor
## D019 — Stream silence must be observable
## D020 — Socket mirror is post-persist transport
## D021 — Socket resume uses server durable sequence
## D022 — Server tolerates duplicates and rejects gaps
## D023 — Socket disconnect is not immediate session end
## D024 — Continuous JSONL is preferred development archive
## D025 — Socket protocol requires integration CI
## D026 — Agent has its own semantic Action Contract
## D027 — CDP is Agent in-page execution standard
## D028 — Agent execution is Action → Behavior → CDP Plan → Executor
## D029 — Human demonstrations define distributions/context, not literal replay
## D030 — Derived dataset cleanup must not mutate raw Collector truth
## D031 — A1 must preserve safe physical facts needed by A2
## D032 — Native raw descriptor names are contract facts; tests must cover `resolvedTargetDescriptor`
## D033 — Stale targetRef must trigger re-observation, not blind coordinate reuse

---

# 12. CI map

Workflow:

```text
.github/workflows/extension-syntax.yml
```

Agent/A1 checks:

```text
control-center/script/checks/strategy_contract.js
control-center/script/checks/agent_action_contract.js
training-collector/tests/action_window_contract.js
```

Collector storage/frame/socket regression checks remain enabled. CI success != native Chrome Agent validation.

---

# 13. Maintenance rule

Update journal when module responsibility, contract/protocol, difficult invariant, version/migration, test gate or architecture boundary changes. Do not log every commit.
