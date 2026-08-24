# Changelog

## V3.8 — 2026-08-25

- Fix root cause Runs & Logs stale `queued`: `saveState()` no longer replaces live run object references.
- Replace stale-prone `activeByAgent` boolean with per-agent worker Promises.
- Add per-run diagnostics: create, enqueue, worker dequeue, spawn, plan, progress, summary, finalize, child exit/error.
- Add manager log file and dashboard `Manager diagnostics` section.
- Add queue watchdog diagnostic/recovery.
- Ensure Backspace mapping is explicit (`VK 8`) and document supported keys.
- Correct Shift modifier bit to CDP bitfield value `8` where applicable.
- Startup script kills previous listeners on ports 8788/3000 before launching V3.8.
- Smoke-tested 1 browser + 1 scenario parallel and 1 browser + 2 scenarios sequential.

## V3.7

- Deterministic `scrollTo`/`scrollBy` contract.
- Vertical scroll uses wheel on fixed coordinates without random wheel position.
- Startup single-instance attempt.

## V3.6

- Explicit FIFO sequential queue.
- Finalize run on runner `summary` instead of waiting indefinitely for Node wrapper exit.

## V3.5

- Synced action contract across Recorder → runner → extension.
- Added `replaceText`, `clearInput`, `keyCombo`, form actions and broader pressKey support.
