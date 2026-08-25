# STATUS — 2026-08-25

## Source of truth

GitHub `banupham/extension_agent` là source chính của dự án.

```bat
git pull
```

Trước khi sửa code: đọc `STATUS.md` → `docs/PROJECT_JOURNAL.md` → fetch source hiện tại trên `main`.

---

# Training Collector — CURRENT: V0.8 Socket Mirror

Manifest:

```text
Training Collector V0.8 Socket Mirror
```

Runtime version: `0.8.0`  
Raw schema: `0.7.2`

Collector vẫn observe-only.

## Vì sao chuyển sang V0.8

Native Chrome testing cho thấy automatic Downloads/offscreen adapter không đủ đáng tin làm đường lấy raw data dài phiên. Một closed session trong popup báo:

```text
autoExport=failed
error=Cannot read properties of undefined (reading 'download')
```

Quyết định mới:

```text
IndexedDB = browser-side safety buffer
localhost WebSocket = continuous development ingest/archive
manual JSONL.gz = fallback/debug only
```

Không đầu tư thêm vào offscreen auto-download. `offscreen.html/js`, `downloads`, `offscreen`, `alarms` đã rời active runtime.

## V0.8 socket transport

Extension background mở:

```text
ws://127.0.0.1:8765/training-collector
```

Flow:

```text
content raw batch
→ background normalize + sessionSeq
→ IndexedDB append / receipt dedupe
→ socket mirror only AFTER persist
→ local socket server
→ append-only <sessionId>.raw.jsonl
```

Protocol:

```text
client-hello
session-open
session-ack { resumeFromSeq }
event-batch
batch-ack { lastSeq }
resync { resumeFromSeq } when gap detected
session-close
heartbeat
```

Critical invariant:

```text
persist first
→ mirror second
```

Socket failure cannot replace/delete IndexedDB raw data.

## Replay / recovery

When server is unavailable or restarts:

```text
WebSocket reconnect
→ session-open
→ server scans existing JSONL/meta
→ returns resumeFromSeq
→ extension reads missing events chunk-by-chunk from IndexedDB
→ sends only sessionSeq > resumeFromSeq
```

Server ignores duplicate sequences and rejects gaps with `resync`.

Closed/dangling sessions from a previous Chrome process are also registered with socket mirror on next startup, replayed if incomplete, then `session-close` is sent.

This means old IndexedDB sessions can still be recovered even if no browser download was produced.

## Local socket server

Files:

```text
training-collector/socket-server/server.js
training-collector/socket-server/package.json
training-collector/socket-server/START_SOCKET_SERVER.bat
training-collector/socket-server/README.md
```

Start:

```bat
cd training-collector\socket-server
START_SOCKET_SERVER.bat
```

Default output:

```text
training-collector/socket-data/
  <sessionId>.raw.jsonl
  <sessionId>.meta.json
```

Server binds `127.0.0.1` by default. `socket-data/` and `node_modules/` are Git-ignored.

## Browser session end semantics

While connected, extension sends heartbeat every 20 s. Server treats WebSocket disconnect as provisional and waits 45 s by default.

```text
disconnect
→ 45 s grace
→ no reconnect
→ append session-end
→ meta.status = closed
```

If same session reconnects before/after a provisional close, server can resume using `resumeFromSeq` rather than starting a second raw archive.

## Existing V0.7.2 capture retained

Raw schema remains `0.7.2` because capture semantics did not change.

Still retained:

```text
all-frame raw capture
frameId/documentId/documentLifecycle/pageInstanceId identity
SPA route-change + semantic re-anchor
collector-stream-health diagnostics
rawTargetRef + resolvedTargetRef
dom-hover-enter/dwell/leave
pageSeq/sourceSeq/sessionSeq
mutation bursts
IndexedDB checksum/receipt reliability
```

Optional Task Episodes remain top-frame only.

## Manual export

Popup still contains:

```text
Manual Export Fallback
```

It reads IndexedDB chunks and creates `.raw.jsonl.gz` in the popup context. It is no longer part of the normal collection workflow.

## Popup diagnostics

V0.8 popup shows:

```text
Socket state
endpoint
connectedAt
last server message
last socket error
per-session ackedThrough / eventCount / sentThrough / queued
current IndexedDB session
recent sessions
```

Normal healthy state should approach:

```text
State: connected
ack ~= eventCount
queued = 0
```

## Frame / SPA / action semantics

V0.7.2 frame-aware capture and diagnostics remain active:

```text
all_frames = true
match_about_blank = true
match_origin_as_fallback = true
```

Action semantics remain:

```text
raw target + resolved target
hover lifecycle raw facts
hover-preview derived offline
```

Analyzer reads JSON/JSONL/JSONL.gz and reports frame/source/stream-health diagnostics.

## Privacy boundary

Socket transport does not expand capture scope. Server receives only the already-filtered raw telemetry emitted by Collector.

Still prohibited:

- password values;
- cookies;
- Authorization/access/refresh tokens;
- local/session storage secret contents;
- clipboard contents;
- payment secrets;
- raw sensitive input values;
- printable keyboard actual character/code;
- URL query values/hash contents.

---

# Agent boundary — CAPTCHA / human verification

Policy unchanged:

```text
observe CAPTCHA / human verification
→ Decision.status = blocked
→ reasonCode = human_verification_required
→ do not solve/bypass automatically
→ do not retry blindly
→ re-evaluate goal
→ use another legitimate route/page only if it serves the task
→ otherwise stop blocked
```

Details: `docs/AGENT_BOUNDARY_CONDITIONS.md`.

---

# Browser validation next

V0.8 now needs native Chrome + local-server validation.

```text
1 git pull
2 start training-collector\socket-server\START_SOCKET_SERVER.bat
3 chrome://extensions → Reload
4 confirm Training Collector V0.8 Socket Mirror
5 refresh/reopen tabs
6 browse normally for 1–3 minutes
7 popup → Socket Mirror should become connected
8 inspect training-collector\socket-data\<sessionId>.raw.jsonl while Chrome is running
9 verify file grows without Manual Export
10 close all Chrome
11 wait ~45 s
12 inspect <sessionId>.meta.json status=closed and session-end record
13 reopen Chrome
14 verify new browser session starts and any prior IndexedDB backlog is replayed
```

Especially useful validation:

```text
server starts AFTER Chrome/session already has events
→ expected: resume/replay from IndexedDB

server stops temporarily then restarts
→ expected: reconnect + resume without duplicate/gap

Chrome closes
→ expected: server finalizes after grace
```

CI success does not equal browser validation.

## Next after socket validation

If socket mirror is stable:

```text
analyze native V0.8 socket JSONL
→ verify frame/SPA/hover/action-target quality
→ semantic actionable-parent label improvement if still needed
→ hover background-noise filtering
→ Behavior Dataset Preparation
```

---

# Agent architecture boundary

```text
TASK
→ OBSERVE
→ STRATEGY / PLANNER
→ NORMALIZED ACTION
→ BEHAVIOR MODEL / NATURAL EXECUTION POLICY
→ CDP EXECUTOR
→ BROWSER
→ OBSERVE AFTER
→ GOAL CHECK
→ REPLAN
```

```text
Strategy       = WHAT to do
Behavior Model = HOW naturally
Executor       = translate execution plan into CDP
```

---

# Development rules

1. GitHub is source of truth.
2. Update STATUS/JOURNAL after major milestone or non-obvious bug/invariant.
3. CI success != native Chrome tested.
4. IndexedDB remains the safety source for socket replay; do not turn socket send into pre-persist fire-and-forget.
5. Manual/download export is fallback only.
6. Do not commit user raw sessions or `socket-data/` to GitHub.
7. Recorder, Collector, deterministic Scenario Mode and Agent Runtime keep separate boundaries.
8. Raw capture stays privacy-filtered at source.
