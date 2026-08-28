# Tab Lifecycle Agent Integration — 2026-08-28

## Scope

This milestone integrates the three already proven browser-native tab lifecycle actions into the ordinary Agent decision/mission path:

- `switchTab`
- `openNewTab`
- `closeTab`

The separate Browser UI / Windows UIA + Win32 SendInput subsystem is **not** integrated by this milestone. It remains intentionally separate because it can own the real Windows pointer and represents a different execution/consent boundary.

## Architecture after integration

```text
Task / Mission
→ Semantic Goal Resolver
→ Strategy
→ semantic Agent Action
   switchTab / openNewTab / closeTab
→ Browser Action Envelope
→ Agent Runtime Extension
→ semantic tab match resolved to internal tab identity
→ Chrome Tabs API
   chrome.tabs.update / create / remove
→ Browser Context AFTER
→ Goal Checker
→ Semantic Effect Evaluator
→ Outcome Controller
→ Episode Budget / bounded replan
```

## Semantic targeting invariant

Strategy does not emit raw `tabId` or `windowId`.

For `switchTab` and `closeTab`, Strategy emits a semantic match using only:

- `title`
- `titleIncludes`
- `url`
- `urlIncludes`

Runtime resolves that semantic match to exactly one live browser tab, then uses the internal tab identity for Chrome Tabs API execution.

Ambiguous or missing semantic targets are rejected instead of choosing an arbitrary tab.

`openNewTab` accepts only an explicit HTTP(S) URL.

## Implementation

- `control-center/manager/strategy/tab_lifecycle_provider.js`
  - explicit Vietnamese/English tab-intent recognition
  - semantic tab decision overlay around the ordinary Strategy provider/model
  - delegates non-tab tasks unchanged

- `control-center/manager/strategy/index.js`
  - integrates tab lifecycle provider by default
  - sanitizes optional browser context before Strategy use
  - does not expose `tabId` / `windowId` to Strategy

- `control-center/manager/strategy/agent_action_contract.js`
  - validates semantic tab matches
  - rejects raw tab/window identities in Agent Action args

- `control-center/manager/mission/semantic_goal_resolver.js`
  - compiles explicit tab lifecycle instructions into `browserTab` success criteria

- `control-center/extension/agent-runtime-extension/tab_context.js`
  - resolves semantic match to one live tab
  - dispatches `chrome.tabs.update`, `chrome.tabs.create`, or `chrome.tabs.remove`

- `control-center/script/checks/tab_lifecycle_agent_integration.js`
  - Strategy semantic decisions
  - semantic Goal compilation
  - Runtime semantic resolution
  - full bounded Agent episode for all three actions

- `.github/workflows/tab-lifecycle-agent.yml`
  - dedicated integration regression gate

## Evidence

Historical native evidence already established browser-native tab lifecycle 3/3 as functional PASS.

Integration evidence on commit `cb0c566341572f9d9c604faf08a28fc74827338b`:

- `tab-lifecycle-agent` run `33131781463` — PASS
- `runtime-syntax` run `33131781515` — PASS

The end-to-end contract proves for each of the three actions:

```text
Task
→ Strategy semantic action
→ Browser Action
→ browser context changes
→ semantic effect observed
→ Goal Checker satisfied
→ episode terminates with goal_satisfied
```

No PAGE_CDP plan is used for tab lifecycle actions.

## Deliberately separate subsystem

The following remains outside this integration:

```text
Browser UI / OS Control
→ Windows UI Automation
→ Win32 SendInput
→ real Windows pointer ownership
→ browser chrome/tab-strip UI
```

Those experiments have their own evidence and are preserved for a later explicit decision about whether they should become an Agent execution surface.
