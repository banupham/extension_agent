# PROJECT JOURNAL APPENDIX — 2026-08-26 — TAB LIFECYCLE BATCH

## Gate

Existing semantic actions were native-tested before implementation changes:

```text
switchTab   → cdp_plan_unsupported:switchTab
openNewTab  → cdp_plan_unsupported:openNewTab
closeTab    → cdp_plan_unsupported:closeTab
```

This confirmed that the Agent Action vocabulary already contained the actions, but the one-action bridge incorrectly routed them into the PAGE_CDP planner.

## Repair on reusable experiment branch

Implemented on `feat/agent-tab-context` only after the native failure.

Architecture:

```text
Browser Context resolves internal tabId
→ Strategy emits semantic switchTab / openNewTab / closeTab
→ one-action bridge builds browserAction envelope, not CDP plan
→ Agent Runtime browser control-plane
→ chrome.tabs.update / chrome.tabs.create / chrome.tabs.remove
→ tab inventory after execution
```

Key invariants:

- `cdpPlan = null` for all three actions;
- Strategy does not emit raw CDP, selector, coordinate, or execution-surface details;
- `tabId` remains internal execution identity resolved outside Strategy;
- no PAGE_CDP pointer/keyboard event is sent;
- no Browser UI/OS input is used;
- post-action evidence is browser-context inventory rather than a fake page observation;
- `closeTab` does not attempt to observe the removed page after execution.

`openNewTab` is limited to valid HTTP(S) URLs in this browser-native path.

## Regression coverage

Added/updated coverage for:

```text
Agent tab context chrome.tabs.* control
Agent Runtime broker command middleware
Manager broker runtime executeBrowserAction adapter
one-action browser-context bridge
native one-action CLI wiring
```

CI on the experiment branch:

```text
run 32971291364
runtime-syntax
SUCCESS
```

The dedicated `Run tab lifecycle one-action bridge contract test` step passed.

## Native retest

User native evidence after reloading Agent Runtime V0.2:

```text
switchTab   = PASS
openNewTab  = PASS
closeTab    = PASS
```

Expected execution evidence was satisfied:

```text
cdpPlan = null
browserAction.actionType = semantic tab action
execution.ok = true
postActionObservation.mode = browser-context
```

For `switchTab`, the selected tab became active in the after inventory. For `openNewTab`, the requested URL appeared as a newly created tab. For `closeTab`, the disposable tab disappeared and no page-after observation was attempted.

## Promotion

Selective promotion to `main`:

```text
32190277ef9610bdf51aa4a0a855d639ce8068ea
feat(agent): promote native-passed tab lifecycle control plane
```

Only browser-control-plane runtime/manager code and its regression coverage were promoted. Experimental Browser UI/OS artifacts and the local PAGE_CDP batch lab were not included.

Main CI:

```text
32972700448
runtime-syntax
SUCCESS
```

All contract/regression steps passed, including the dedicated tab lifecycle bridge test.

## Result

```text
switchTab   = NATIVE PASS
openNewTab  = NATIVE PASS
closeTab    = NATIVE PASS
```

The existing semantic Agent Action functional matrix is now closed for the currently scoped PAGE_CDP/browser-native baseline.

## Next

Before A5 / autonomous multi-step, re-test the previously deferred Browser UI/OS shell-control surface as requested. Browser UI/OS remains a separate execution surface and is not integrated into ordinary Runtime execution by this batch.

Any test that sends real Windows mouse/keyboard input requires explicit user consent immediately before input is sent and an exclusive desktop-input lease. Naturalness remains Behavior-learning work, separate from functional correctness.
