# Drag native PASS + PAGE_CDP batch validation — 2026-08-26

## Drag

Native functional drag is PASS.

Evidence summary:

```text
semantic source      = targetRef
semantic destination = args.destinationRef
cdpPlanVersion       = 0.1.3
execution            = 39 / 39 steps
final page title     = DRAG PASS
```

Runtime validates source live geometry before press and destination live geometry before execution and again immediately before mouse release. A normal-path native re-test after the destination guard remained PASS.

Naturalness is not hand-tuned at this gate; further motion quality belongs to Behavior learning/refinement.

Promoted to `main` as commit `953a98333cb123242af29048c1d042335337d257`; runtime-syntax run `32956687292` SUCCESS.

## Batch validation mode

Remaining existing PAGE_CDP/webpage actions are now tested from one fixed local surface instead of creating a new server per action.

```text
http://127.0.0.1:8091
```

Experimental branch `feat/agent-tab-context` was resynced onto the promoted `main`. Deferred Browser UI/OS spike files and execution-surface documentation were preserved on that branch. The batch lab lives at:

```text
control-center/script/page_cdp_test_lab.js
```

Rules remain unchanged:

```text
one semantic Agent Action per test
native capability first
PASS -> record and continue
implementation FAIL -> fix only on feat/agent-tab-context
no autonomous multi-step
no hand-tuning naturalness during functional validation
```

Batch groups:

```text
forms:       setChecked, toggle, selectOption, submit
observation: dismiss, hoverAndObserve, waitAndObserve
media:       play, pause, mute, unmute, setVolume, seek, changePlaybackRate
robustness:  multi-frame observation
control:     switchTab, openNewTab, closeTab (later, separate control-plane group)
```
