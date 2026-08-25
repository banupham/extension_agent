# Agent Training Architecture — Roadmap

## 1. Mục tiêu

Agent cuối cùng phải đồng thời:

```text
1. hiểu đúng task / browser state
2. chọn đúng next semantic action
3. thực thi action tự nhiên dựa trên human demonstrations
4. dùng CDP làm chuẩn thực thi browser-native
5. quan sát outcome và replan
```

Runtime đích:

```text
TASK
↓
OBSERVER
↓
STRATEGY / BRAIN
↓
AGENT ACTION CONTRACT        = WHAT
↓
EXECUTION BEHAVIOR CONTRACT = HOW naturally
↓
CDP EXECUTION PLAN           = exact browser-native plan
↓
AGENT RUNTIME EXTENSION / CDP EXECUTOR
↓
CHROME
↓
OBSERVE AFTER
↓
GOAL CHECKER
↓
REPLAN
```

Scenario deterministic, Recorder, Training Collector và Agent Runtime giữ boundary riêng.

## 2. Four-layer execution boundary

```text
Strategy       = chọn semantic action + target
Behavior Policy= cách thực thi tự nhiên theo context
CDP Planner    = biến action + behavior thành exact CDP plan
Executor       = dispatch CDP commands
```

Strategy không phát raw selector, tọa độ hay CDP packet.

Ví dụ Strategy:

```js
{
  status: 'act',
  action: {
    type: 'click',
    targetRef: 'e17',
    intent: 'open_comments'
  }
}
```

Behavior Policy có thể tạo:

```js
{
  behaviorVersion: '0.1.0',
  actionType: 'click',
  targetRef: 'e17',
  profile: 'empirical-v0',
  pointer: {
    profile: 'empirical',
    targetAcquisition: 'adaptive',
    dwellBeforeDownMs: null,
    holdMs: null
  }
}
```

Sau đó CDP Planner mới tạo trajectory/timing cụ thể và Executor dispatch `Input.dispatchMouseEvent`.

## 3. Contracts hiện tại

### Task / Observation / Decision / Outcome

Code:

```text
control-center/manager/strategy/contracts.js
```

Decision statuses:

```text
act | done | blocked | failed
```

Không lưu chain-of-thought; dùng `reasonCode` ngắn cho diagnostics/training.

### Agent Action Contract v0.1

Files:

```text
control-center/AGENT_ACTION_CONTRACT.json
control-center/manager/strategy/agent_action_contract.js
docs/AGENT_ACTION_CDP_MAP.md
```

Agent action vocabulary:

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

Deterministic `control-center/ACTION_CONTRACT.json` vẫn giữ nguyên cho Scenario Mode. Không dùng nó làm vocabulary chính của Agent.

### Execution Behavior Contract v0.1

File:

```text
control-center/manager/strategy/execution_behavior_contract.js
```

Behavior families hiện map:

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

## 4. CDP là execution standard

Agent Runtime extension hiện dùng `chrome.debugger` + CDP. Existing runtime mới chỉ thực thi trực tiếp một tập nhỏ (`Page.navigate`, `Input.dispatchKeyEvent`, `Input.insertText`), nhưng Phase A0 đã định nghĩa mapping đích cho toàn semantic vocabulary.

Examples:

```text
click / hover / drag
→ Input.dispatchMouseEvent

scrollVertical / scrollHorizontal
→ Input.dispatchMouseEvent(type=mouseWheel)

typeText / pressKey
→ Input.dispatchKeyEvent / Input.insertText

navigate
→ Page.navigate

back / forward
→ Page.getNavigationHistory + Page.navigateToHistoryEntry
```

`chrome.tabs.*` chỉ là control-plane cho tab lifecycle; interaction trong page ưu tiên CDP/browser-native execution.

## 5. Natural execution không phải randomization

Không dùng nền tảng:

```text
random delay everywhere
random jitter everywhere
```

Human demonstrations được dùng để học quan hệ context → distribution/constraints, không replay trajectory nguyên xi.

Click:

```text
pointer start
→ target acquisition path
→ velocity/deceleration
→ optional correction
→ dwell
→ mouseDown
→ hold
→ mouseUp
```

Hover:

```text
approach
→ enter
→ dwell
→ observe UI response
→ optional leave
```

Scroll:

```text
axis-specific wheel burst
→ delta/time profile
→ pause
→ correction/settling
```

Typing:

```text
focus acquisition
→ initial pause
→ burst/inter-key timing
→ editing operations
```

Agent task text comes from Task/Strategy. Human printable key content is never a behavior feature.

## 6. Training Collector → Agent learning bridge

Collector V0.8 provides privacy-filtered raw demonstrations:

```text
physical pointer/wheel/keyboard timing
+
semantic DOM/action target/frame/route/state change
↓
Action Window Builder
↓
Behavior Feature Extractor
↓
Behavior Dataset
```

Raw order fields:

```text
tsEpochMs = primary global time axis for reconstruction
pageSeq   = page-local capture ordering
sourceSeq = source-local ordering
sessionSeq= durability/persistence integrity; NOT chronological truth
```

## 7. Action Window Builder — next milestone A1

A1 must turn raw facts into candidate demonstrations:

```text
BEFORE
→ approach / hover / focus / wheel / key timing
→ SEMANTIC ACTION
→ AFTER / mutation / route / state change
→ OUTCOME
```

Initial semantic actions:

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

Regression demonstrations already available from native sessions include:

```text
YouTube hover-preview
embedded iframe controls
YouTube media controls / playback rate
Facebook like / comments
Facebook horizontal recommendation/video carousel
login form interaction without credential leakage
TikTok dynamic video routes
short-drama login-gated modal + dismiss
multi-tab / multi-frame interaction
```

## 8. Behavior Feature Extractor — A2

Pointer:

```text
path length / displacement
duration
velocity / acceleration / jerk
curvature
overshoot/correction
target acquisition slowdown
dwell
mouse hold
```

Keyboard:

```text
initial pause
inter-key intervals
bursts / pauses
Backspace/Delete/Tab/Enter operation timing
```

Scroll:

```text
axis
wheel burst duration
delta distribution
velocity/timing
pause structure
correction/settling
```

Drag:

```text
handle acquisition
press duration
continuous path
correction near requested value
release timing
```

Condition features by semantic role, target rect/size, pointer distance, editable state, frame context and recent interaction history.

## 9. Behavior learning phases

```text
A2 / N0 feature extraction
↓
A3 / N1 empirical distributions
↓
context-conditioned empirical Behavior Policy
↓
A4 one-action Agent bridge
↓
A5 Goal Checker + Replan
↓
N2/N3 learned behavior only after offline metrics are stable
```

Start with empirical distributions, not a complex learned trajectory model.

## 10. One-action Agent loop

```text
1 validate Task
2 observe
3 privacy redact
4 Strategy decides ONE Agent Action
5 validate Agent Action Contract
6 Behavior Policy prepares Execution Behavior Contract
7 CDP Planner resolves semantic target/context and execution plan
8 Executor executes CDP plan
9 observe stateAfter
10 Goal Checker evaluates progress/outcome
11 append step history
12 replan or terminate
```

Budgets:

```text
maxSteps
maxDurationMs
maxConsecutiveFailures
maxReplans
domain/navigation constraints
```

## 11. Evaluation

Measure separately:

```text
Planning quality
→ task success / progress / recovery

Action correctness
→ correct semantic action + target

Execution fidelity
→ trajectory/timing distributions vs held-out human demonstrations

Runtime reliability
→ CDP execution success / observation consistency
```

Natural execution must never reduce action correctness merely to look human-like.

## 12. Human verification boundary

CAPTCHA/human-verification is not an action vocabulary item.

```text
observe challenge
→ Decision.status = blocked
→ reasonCode = human_verification_required
→ no automatic solve/bypass
→ legitimate replan only if independently useful for task
```

See `docs/AGENT_BOUNDARY_CONDITIONS.md`.

## 13. Privacy

Never train/store raw credential values, cookies, auth tokens, clipboard content, payment secrets, local/session storage secrets, sensitive form values or printable human key content.

Behavior learning uses timing/operation classes and semantic context only.

## 14. Current module map

```text
control-center/AGENT_ACTION_CONTRACT.json
  Agent semantic vocabulary

control-center/manager/strategy/agent_action_contract.js
  validation + Behavior family + CDP primitive mapping

control-center/manager/strategy/execution_behavior_contract.js
  HOW contract

control-center/manager/strategy/
  Task / Observation / Decision / Strategy

control-center/extension/agent-runtime-extension/background.js
  experimental CDP Observer/Executor

training-collector/
  human demonstration capture

training-collector/tools/
  raw analysis / derived semantics; A1/A2 dataset tools will live here or a dedicated dataset module
```

## 15. Development rules

1. Contract before implementation.
2. Strategy decides WHAT, never raw CDP.
3. Behavior Policy decides HOW naturally.
4. CDP Planner owns exact execution plan.
5. Executor is the only layer dispatching browser commands.
6. Deterministic Scenario Mode contract remains separate.
7. Do not train directly from unvalidated raw telemetry.
8. Human demonstrations provide distributions/context, not trajectory replay.
9. Collector remains privacy-filtered at source.
10. CI contract success and native browser validation are recorded separately.
