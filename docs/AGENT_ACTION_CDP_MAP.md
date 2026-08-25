# Agent Action → Behavior → CDP Mapping v0.1

## Purpose

This document is the Phase A0 bridge between Training Collector demonstrations and Agent Runtime execution.

```text
Task
→ Observer
→ Strategy / Brain
→ Agent Action Contract (WHAT)
→ Execution Behavior Contract (HOW naturally)
→ CDP Execution Plan
→ Agent Runtime Extension / CDP Executor
→ Chrome
```

Deterministic Scenario Mode keeps using `control-center/ACTION_CONTRACT.json`. Agent Mode uses `control-center/AGENT_ACTION_CONTRACT.json` and must not emit raw selectors, coordinates or CDP method names as its primary decision representation.

## Core boundary

```text
Strategy       = WHAT action + semantic target
Behavior       = HOW naturally, conditioned by human demonstrations
CDP Planner    = exact browser-native execution plan
Executor       = dispatch CDP commands
```

Human demonstrations are not replayed verbatim. They provide context-conditioned distributions and constraints.

## Action mapping matrix

| Agent action | Behavior family | Main demonstration evidence | CDP / browser primitive |
| --- | --- | --- | --- |
| navigate | navigation | route/navigation transitions | `Page.navigate` |
| back / forward | navigation | browser navigation outcomes | navigation history + `Page.navigateToHistoryEntry` |
| reload | navigation | page lifecycle | `Page.reload` |
| switchTab / openNewTab / closeTab | navigation | multi-tab sessions | `chrome.tabs.*` control plane |
| click | pointer-click | pointer approach + DOM click + outcome | `Input.dispatchMouseEvent` |
| doubleClick | pointer-click | repeated click window | `Input.dispatchMouseEvent` clickCount |
| hover | pointer-hover | hover enter/dwell/leave | `Input.dispatchMouseEvent(mouseMoved)` |
| hoverAndObserve | pointer-hover | hover-preview / UI reaction | mouse move + re-observe |
| moveTo | pointer-hover | pointer path | `Input.dispatchMouseEvent(mouseMoved)` |
| drag | pointer-drag | down → continuous movement → up | `Input.dispatchMouseEvent` series |
| scrollVertical | scroll-vertical | wheel deltaY bursts / pauses | `Input.dispatchMouseEvent(mouseWheel)` |
| scrollHorizontal | scroll-horizontal | wheel deltaX / carousel sessions | `Input.dispatchMouseEvent(mouseWheel)` |
| scrollIntoView | scroll-target-acquisition | target offscreen → visible | `DOM.scrollIntoViewIfNeeded` or runtime call |
| focus | focus-acquisition | focus + pointer/keyboard lead-in | DOM/runtime focus or pointer acquisition |
| typeText | keyboard-text | key timing/bursts, no printable content | `Input.dispatchKeyEvent` / `Input.insertText` |
| replaceText | keyboard-text | focus + selection/editing timing | key events + insert text |
| clear | keyboard-text | select/delete operations | `Input.dispatchKeyEvent` |
| pressKey / keyCombo | keyboard-key | Enter/Tab/Escape/etc timing | `Input.dispatchKeyEvent` |
| selectOption | form-control | select/change facts | runtime DOM interaction |
| setChecked | form-control | checkbox/change facts | pointer or runtime DOM action |
| toggle | pointer-click | like/mute/switch controls | click primitive |
| submit | pointer-click / keyboard-key | submit/click/Enter | click or key event |
| play / pause | pointer-click | media controls | click semantic control |
| mute / unmute | pointer-click | media/audio controls | click semantic control |
| setVolume | pointer-drag | slider acquisition/drag | mouse drag series |
| seek | pointer-drag | timeline slider | mouse drag series |
| changePlaybackRate | media-control | player menus / key controls | semantic click/key sequence |
| waitAndObserve | observation-wait | idle/state-transition windows | no input; re-observe after bounded wait |
| dismiss | pointer-click / keyboard-key | modal/notification close | semantic close target or Escape |

## Demonstration → Behavior feature families

### Pointer click

Derive, do not bake into raw capture:

```text
start position
path length / straight-line distance
movement duration
velocity / acceleration / jerk
curvature
near-target correction / overshoot
acquisition dwell
mouse down → up hold
```

Condition by target context: rect/size, role, current pointer distance, recent interaction history and frame context.

### Hover

```text
approach trajectory
enter timestamp
dwell duration
leave trajectory
state/mutation/control appearance after hover
```

Background `html/body/full-page` hover remains raw but should be filtered from semantic training actions.

### Scroll

```text
axis
delta sequence
burst duration
inter-event timing
pause structure
settling/correction
viewport/context
```

Horizontal and vertical scroll are separate behavior families.

### Keyboard

```text
initial focus-to-type pause
key hold where available
inter-key intervals
burst/pause structure
editing-operation timing
Enter/Tab/Escape timing
```

Printable human key content is not a training feature. Agent task text is supplied by Task/Strategy; Behavior only controls execution rhythm.

### Drag / slider

```text
target-handle acquisition
mouse-down hold
continuous path
velocity profile
correction near requested value
mouse-up timing
```

## Agent decision examples

Good:

```json
{
  "status": "act",
  "action": {
    "type": "click",
    "targetRef": "e271",
    "intent": "open_comments"
  }
}
```

Bad:

```json
{
  "action": "clickSelector",
  "selector": "#comments > button",
  "x": 713,
  "y": 442,
  "cdpMethod": "Input.dispatchMouseEvent"
}
```

## Human verification boundary

Human verification/CAPTCHA is not an Agent action family.

```text
observe challenge
→ Decision.status = blocked
→ reasonCode = human_verification_required
→ no automatic solve/bypass
→ legitimate replan only when it independently serves the task
```

## Phase order after A0

```text
A1 Action Window Builder
→ A2 Behavior Feature Extractor
→ A3 empirical context-conditioned baseline
→ A4 one-action Agent bridge
→ A5 Goal Checker + Replan
→ learned/retrieval Strategy and learned Behavior only after metrics are stable
```
