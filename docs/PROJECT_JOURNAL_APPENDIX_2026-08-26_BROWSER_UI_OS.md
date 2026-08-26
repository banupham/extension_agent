# PROJECT JOURNAL APPENDIX — Browser UI/OS spike deferred

Date: 2026-08-26

This appendix records experimental evidence produced on the reusable branch `feat/agent-tab-context` and the decision about when to integrate it.

## Experimental evidence

Controlled local surface remains `http://127.0.0.1:8091`; future local tests should change page content/state rather than allocate a new port.

Observed results on the experimental branch:

```text
modifier-aware PAGE_CDP Alt+ArrowLeft → page listener      PASS
same PAGE_CDP key events → browser-shell Back accelerator  NOT TRIGGERED
Win32 SendInput Alt+Left → browser Back                     PASS with foreground/focus requirement
Windows UI Automation + physical mouse → browser Back       PASS
Windows UI Automation + physical mouse → browser Forward    PASS
```

Physical pointer execution used semantic UI Automation discovery, real Windows cursor movement, multi-step trajectory, LEFTDOWN, hold, LEFTUP. Functional result was PASS. Human visual assessment of current trajectory was approximately 90%; the remaining naturalness is a later Behavior-quality task, not a functional executor failure.

## Architecture conclusion

Browser UI / OS control is a valid future execution surface for advanced browser-chrome tasks that PAGE_CDP or deterministic browser-native control cannot perform. It consumes shared physical desktop input, therefore any future integrated version must request explicit consent and use an exclusive input-control lease. Only one physical Windows mouse/keyboard execution stream can own that lease at an instant; PAGE_CDP/browser-native logical control is not subject to that same limitation.

## Decision: DEFER INTEGRATION

Do **not** integrate `BROWSER_UI_OS` into Agent Runtime now. Keep the spike/evidence on the reusable experiment branch for later work.

Current development focus returns to existing CDP/web-page capabilities on `main`:

```text
1 pressKey native validation
2 navigate native validation
3 reload native validation
4 remaining stale-ref / moving-target / observer fidelity gates
5 Agent Cursor Debug Overlay when pointer observability becomes useful
```

Agent Cursor remains visualization/telemetry only and is not an execution source.

No autonomous multi-step work yet.
