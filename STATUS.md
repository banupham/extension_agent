# STATUS — 2026-08-28

## Source of truth

`main` is now the production Agent source of truth after the selective Agent consolidation approved on 2026-08-28.

Read in this order before changes:

```text
STATUS.md
→ AGENT_HANDOFF.md
→ docs/MAIN_INTEGRATION_2026-08-28.md
→ focused implementation docs/tests
```

## Current main Agent state

Selective consolidation is complete.

The main Agent body includes:

```text
Task / Mission
→ semantic mission interpretation
→ semantic goal resolution
→ learned Strategy / model loading
→ recovery / self-experience / world state
→ 35-action Agent Action Contract
→ Behavior policy
→ PAGE_CDP or BROWSER_NATIVE execution
→ observe-after
→ Goal Checker
→ Semantic Effect Evaluator
→ Outcome Controller
→ Episode Budget / bounded replan
```

Integrated capabilities include:

- pointer, keyboard, scroll, form and media semantic actions;
- follow-live target tracking for moving targets;
- browser-native navigation control;
- browser-native `switchTab`, `openNewTab`, `closeTab` with semantic title/url targeting;
- no Strategy selectors, coordinates, raw CDP, raw `tabId`, or raw `windowId`;
- mission/subgoal execution, recovery and bounded replanning;
- Strategy/Behavior training pipelines with privacy/noise filtering and explicit human approval;
- incremental Strategy dataset tooling with stable split preservation;
- semantic outcome/effect feedback.

## Strategy model state

- Frozen Strategy v0.3.3 remains the proven baseline/fallback model.
- Incremental candidate training/evaluation work is preserved in the repository history/handoff.
- A candidate model must still satisfy its own promotion evidence; merging the Agent body does not silently promote an unapproved model artifact.

## Execution surfaces allowed on main

Only:

```text
page-cdp
browser-native
```

Browser-native default actions:

```text
navigate
back
forward
reload
switchTab
openNewTab
closeTab
```

## Deliberately outside the main Agent body

The following remains external:

```text
Browser UI / OS Control
→ Windows UI Automation
→ Win32 SendInput
→ shared physical Windows pointer/keyboard ownership
→ visible browser chrome / tab-strip UI
```

The experimental spike executables are preserved on:

```text
feat/agent-tab-context
```

They are not present in the main tree. Main execution policy has no selectable `browser-ui-os` surface and fails closed on attempts to force it.

See `docs/MAIN_INTEGRATION_2026-08-28.md` for the exact exclusion manifest.

## Validation at consolidation boundary

Pre-main selective merge tree:

```text
merge commit: 822950910a51c40bfaf026db468d20a3fe2bc05f
runtime-syntax: PASS
  run 33132346859

tab-lifecycle-agent: PASS
  run 33132346961
```

A dedicated main execution-surface boundary gate is also maintained to prevent accidental Browser UI/OS re-entry.

## Current maturity

```text
Scoped browser Agent architecture        INTEGRATED
35 semantic action vocabulary            INTEGRATED
Browser-native tab lifecycle             INTEGRATED / PASS
follow-live moving target tracking       INTEGRATED
Goal/effect/outcome feedback              INTEGRATED
bounded replan/recovery                   INTEGRATED
human-approved learning pipeline         INTEGRATED
broad unconstrained autonomy             NOT CLAIMED
Browser UI / OS physical control         EXTERNAL TO MAIN AGENT
```

Next development should start from `main` unless the task explicitly concerns the external Browser UI/OS experimental subsystem.
