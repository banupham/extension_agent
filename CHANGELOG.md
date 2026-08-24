# Changelog

## V3.9 — 2026-08-25

- Add deterministic `clickRecorded` action across Recorder → runner → executor.
- Recorder stores click position as element-relative `rx/ry` plus viewport-coordinate fallback.
- Executor re-resolves the target element and clicks `rect.left + width*rx`, `rect.top + height*ry`.
- `clickRecorded` does not use random click offset or a generated random mouse path.
- Recorder prefers clickable ancestors and adds unique anchor `href` selectors.
- Recorder stops prioritizing IDs that look generated/dynamic.
- Scroll recording debounce increased to 420 ms and exporter coalesces consecutive `scrollTo` destinations.
- Extension version bumped to 1.5.0.

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
