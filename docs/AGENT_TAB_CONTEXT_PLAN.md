# Agent Tab Context Plan

## Purpose

Native A4 testing showed that an external broker command does not carry Chrome `sender.tab` identity the way Training Collector content-script events do. The Agent Runtime therefore needs an explicit browser-context layer instead of treating inferred active-tab state as the primary source of truth.

This is an additive plan. It does **not** replace the existing A4 one-action bridge, Strategy/Behavior/CDP boundaries, observation-bound target registry, or `--tab` execution path.

## Updated execution boundary

```text
TASK
→ BROWSER CONTEXT / TAB INVENTORY
→ OBSERVER
→ STRATEGY / BRAIN
→ AGENT ACTION CONTRACT
→ EXECUTION BEHAVIOR CONTRACT
→ CDP EXECUTION PLAN
→ AGENT RUNTIME EXTENSION
→ CHROME
→ OBSERVE AFTER
→ GOAL CHECK / REPLAN
```

Hard invariants remain:

```text
Strategy does NOT emit selector / coordinate / CDP packet.
Behavior does NOT choose task intent.
Executor does NOT choose strategy.
ObservationId remains bound to the tab where it was created.
Execution must use the same explicit tabId when supplied.
```

## Compatibility rule

Existing calls remain valid:

```text
agentObserve without tabId
→ active-tab convenience fallback

agentObserve with tabId
→ exact tab

agentExecutePlan with tabId
→ exact tab
```

No old P0 command is removed or renamed.

## New additive broker actions

### `agentListTabs`

Returns lightweight http/https browser context facts without observing DOM targets.

Supported scope modes:

```text
active
visible   = active tab in each Chrome window
matching  = hostname / urlIncludes / titleIncludes
all       = all http/https tabs
```

Example:

```json
{
  "action": "agentListTabs",
  "data": {
    "scope": {
      "mode": "matching",
      "hostname": "facebook.com"
    }
  }
}
```

### `agentObserveTabs`

Explicit multi-tab observation for native validation and future browser-context planning.

```json
{
  "action": "agentObserveTabs",
  "data": {
    "scope": {
      "mode": "visible",
      "maxTabs": 4
    }
  }
}
```

This is intentionally separate from the one-action bridge. A4 still executes exactly one action against one observation/tab at a time.

## Runtime tab scopes

```text
active
  last-focused normal Chrome window
  → active tab
  → fallback to any active web tab

tab
  exact tabId

visible
  all active http/https tabs across Chrome windows

matching
  http/https tabs matching hostname/url/title facts

all
  all http/https tabs
```

`matching` is browser-fact filtering only. It does not infer task intent. If several Facebook tabs match, Strategy/Manager must still choose the intended tab before execution.

## CLI additions

Existing:

```bat
node script/agent_one_action.js --observe
node script/agent_one_action.js --observe --tab 123
node script/agent_one_action.js --type click --label "Like" --tab 123
```

New inventory:

```bat
node script/agent_one_action.js --tabs
node script/agent_one_action.js --tabs --tabs-scope visible
node script/agent_one_action.js --tabs --tabs-scope matching --host facebook.com
```

New scoped observation:

```bat
node script/agent_one_action.js --observe-tabs visible
node script/agent_one_action.js --observe-tabs matching --host facebook.com
```

Recommended native flow:

```text
LIST TABS
→ choose explicit tabId
→ OBSERVE(tabId)
→ one action
→ EXECUTE(tabId + observationId)
→ OBSERVE AFTER(tabId)
```

## Why this does not disturb the old plan

The new layer only makes browser context identity first-class. It does not add autonomous multi-step behavior and does not broaden the Agent Action contract.

P0 native validation remains the current gate:

```text
observe
click
doubleClick
hover
scroll
focus + typeText
history
stale-ref rejection
moving-target evidence
keyboard fidelity evidence
```

P1 remains deferred until P0 native evidence is stable.

## Native validation for tab context

```text
1. list all tabs
2. list visible tabs across multiple Chrome windows
3. match facebook.com while another tab is foreground
4. switch tabs and repeat inventory
5. close a matched tab and repeat inventory
6. observe explicit tabId
7. switch foreground tab while CLI runs
8. verify execution remains bound to the explicit tabId
9. verify old --observe fallback still works
10. verify stale observation cannot migrate to another tab
```

## Future, not part of this change

```text
Brain-level browser-context selection policy
multi-frame Agent target registry
cross-tab autonomous planning
tab lifecycle actions
semantic tab aliases persisted across navigation
```

These remain separate future milestones and must not be pulled into A4 P0 accidentally.
