# MAIN INTEGRATION — 2026-08-28

## Decision

The validated Agent body from `feat/agent-tab-context` is selectively consolidated into `main`.

The merge intentionally excludes the Browser UI / OS physical-input subsystem. Main Agent remains limited to non-desktop-owning execution surfaces:

```text
PAGE_CDP
BROWSER_NATIVE
```

## Included in main Agent

```text
Mission / semantic subgoals
Semantic Goal Resolver
Learned Strategy + model loading
Recovery / self-experience / world state
35-action Agent Action Contract
Behavior policy and learned behavior baseline
Pointer / keyboard / scroll / forms / media
follow-live moving-target tracking
browser-native navigate/back/forward/reload
browser-native switchTab/openNewTab/closeTab
semantic tab targeting without Strategy tabId/windowId
Goal Checker
Semantic Effect Evaluator
Outcome Controller
Episode Budget / bounded replan
human-approved Strategy training pipeline
continuous-learning review/dataset tooling
```

Tab lifecycle integration had dedicated PASS evidence before consolidation:

- `tab-lifecycle-agent` run `33131781463` — success
- `runtime-syntax` run `33131781515` — success

## Intentionally excluded from main

The following executable spike files remain only on `feat/agent-tab-context`:

```text
control-center/script/browser_ui_os_spike.js
control-center/script/browser_ui_os_spike.ps1
control-center/script/browser_ui_pointer_spike.ps1
control-center/script/browser_ui_switch_tab_spike.ps1
control-center/script/browser_ui_tabstrip_spike.js
control-center/script/browser_ui_tabstrip_spike.ps1
control-center/script/checks/browser_ui_tabstrip_spike.js
```

Subsystem boundary:

```text
Browser UI / OS Control
→ Windows UI Automation
→ Win32 SendInput
→ shared physical Windows pointer / keyboard ownership
→ visible browser chrome / tab-strip UI
```

This subsystem has historical experimental evidence, but it is not selectable by the main Agent. `browser-ui-os` was removed from the selectable execution-surface set. Requests attempting to force that surface fail closed with:

```text
browser_ui_os_external_to_main_agent
```

No silent physical-input escalation is allowed.

## History preservation

The selective integration commit uses both the previous `main` head and the validated Agent branch head as parents. Main-only takeover/history documentation is retained, while current Agent implementations from the development branch take precedence over superseded A5-era copies.

This file is the source-of-truth manifest for what the 2026-08-28 consolidation intentionally included and excluded.
