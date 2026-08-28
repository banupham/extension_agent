# Agent development handoff — main

Read this file before changing the repository.

## Working rules

- Active production branch: `main`.
- The selective Agent consolidation into `main` was explicitly approved on 2026-08-28.
- Use `feat/agent-tab-context` only for the deliberately external Browser UI / OS experimental subsystem or historical comparison.
- Commit every meaningful development, diagnostic, test, and state milestone to GitHub.
- Strategy chooses **WHAT**; Behavior chooses **HOW**.
- No site/ref hardcode to force PASS.
- No generic `failure => scroll`.
- Never move heldout into TRAIN or change split policy merely to force PASS.
- Do not persist selectors, coordinates, raw CDP, raw tab/window IDs, credentials/passwords/secrets, typed sensitive values, or private reasoning in Strategy/recovery/memory/training.
- No literal trajectory replay.
- Human demonstrations never auto-promote; exact digest confirmation is required before approval is applied.
- Raw user interaction never auto-trains directly.

## Main Agent body

Integrated on `main`:

```text
Mission / subgoals
Semantic mission interpreter
Semantic Goal Resolver
Learned Strategy + model loading
Recovery / self-experience / world state
35 semantic Agent Actions
Behavior policy / learned Behavior baseline
PAGE_CDP execution
BROWSER_NATIVE execution
follow-live moving-target tracking
browser-native switchTab / openNewTab / closeTab
Goal Checker
Semantic Effect Evaluator
Outcome Controller
Episode Budget / bounded replan
privacy-safe human-approved training pipeline
stable incremental dataset merge
```

## Execution surface boundary

Selectable surfaces on main:

```text
page-cdp
browser-native
```

Not selectable on main:

```text
browser-ui-os
```

External subsystem preserved on `feat/agent-tab-context`:

```text
Windows UI Automation
Win32 SendInput
real shared Windows pointer/keyboard ownership
visible browser chrome / tab-strip interaction
```

Main fails closed if code attempts to force that surface.

## Strategy model boundary

- v0.3.3 remains the frozen proven baseline/fallback model.
- Incremental candidate work is preserved, but repository consolidation does not itself promote an unapproved model artifact.
- Continue to require heldout/regression/fresh evidence and explicit promotion approval for model changes.

## Tab lifecycle evidence

The three browser-native functions are integrated end-to-end:

```text
switchTab
openNewTab
closeTab
```

Strategy targets tabs semantically by title/url. Runtime resolves live `tabId/windowId` internally.

Validated before main promotion:

- `tab-lifecycle-agent` run `33131781463` — PASS
- `runtime-syntax` run `33131781515` — PASS

Selective merge tree validation:

- `tab-lifecycle-agent` run `33132346961` — PASS
- `runtime-syntax` run `33132346859` — PASS

## Detailed historical handoff

The full pre-main handoff, including dataset digests, Strategy v0.3.3/v0.3.5 candidate history, Cargo/Signal Relay/Harbor evidence and continuous-learning details, is preserved verbatim at:

```text
docs/AGENT_HANDOFF_PRE_MAIN_2026-08-28.md
```

Use it for historical evidence, not for branch-selection rules.

## Current source-of-truth docs

```text
STATUS.md
docs/MAIN_INTEGRATION_2026-08-28.md
docs/AGENT_EXECUTION_SURFACES.md
docs/TAB_LIFECYCLE_AGENT_INTEGRATION_2026-08-28.md
```
