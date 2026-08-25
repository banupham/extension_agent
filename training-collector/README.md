# Training Collector V0.8 Socket Mirror

Observe-only Chrome MV3 extension for collecting human browser demonstrations for analysis and future Agent behavior learning.

## Current runtime

```text
Runtime:    0.8.0
Raw schema: 0.7.2
```

V0.8 changes the **development transport**, not the raw event semantics.

```text
content scripts / frames
→ RAW_BATCH + batchId
→ background serialized append
→ IndexedDB safety buffer
→ localhost WebSocket mirror
→ append-only JSONL server archive
```

Manual `.raw.jsonl.gz` export remains available only as fallback/debug.

## Why socket mirror

The previous automatic Downloads/offscreen adapter proved unreliable in native Chrome testing. V0.8 stops treating browser download as the primary development extraction path.

The socket path is designed for long sessions:

```text
persist to IndexedDB first
→ send persisted events over socket
→ server ACKs durable last sessionSeq
→ disconnect/restart
→ reconnect
→ server returns resumeFromSeq
→ extension replays missing events from IndexedDB
```

This preserves the key reliability rule:

```text
socket/network failure must not erase browser-side raw data
```

## Local socket server

Start:

```bat
cd training-collector\socket-server
START_SOCKET_SERVER.bat
```

Endpoint:

```text
ws://127.0.0.1:8765/training-collector
```

Output:

```text
training-collector/socket-data/
  <sessionId>.raw.jsonl
  <sessionId>.meta.json
```

`socket-data/` and `socket-server/node_modules/` are ignored by Git.

Protocol details: `training-collector/socket-server/README.md`.

## Browser-session lifecycle

A physical collection remains one Chrome browser session.

```text
Chrome starts
→ browser session ID
→ all matching tabs/frames feed same session

Chrome exits
→ WebSocket disconnects
→ server waits grace period
→ session-end
```

If the MV3 runtime/server disconnects temporarily and reconnects with the same session ID, collection resumes instead of creating a new semantic collection boundary.

On the next Chrome start, dangling IndexedDB sessions from the prior browser process are marked `closed-inferred`, replayed to the socket server if needed, then closed server-side.

## Frame-aware capture

Content scripts run with:

```text
all_frames = true
match_about_blank = true
match_origin_as_fallback = true
```

Persisted identity includes:

```text
tabId
windowId
frameId
documentId
documentLifecycle
pageInstanceId
elementRef
```

Element identity must be interpreted in page/frame context, not globally by `elementRef` alone.

Optional Task Episodes remain top-frame only for now. Continuous raw telemetry is frame-aware.

## Raw sources

Physical:

```text
pointer
pointer-down / pointer-up
wheel
scroll-position
keyboard timing/operation class
focus / visibility
heartbeat / idle gaps
```

Semantic DOM:

```text
dom-click
dom-focus
dom-input
dom-change
dom-submit
dom-hover-enter
dom-hover-dwell
dom-hover-leave
semantic-snapshot
route-change
```

Mutation:

```text
dom-mutation-burst ~120 ms
```

Diagnostics:

```text
frame-context
collector-stream-start
collector-stream-health
collector-stream-stop
```

## Action target semantics

DOM click retains both raw and interpreted target:

```text
targetRef
rawTargetRef
resolvedTargetRef
targetResolution.method
targetResolution.confidence
```

Resolved target does not overwrite the raw fact.

## Hover semantics

Raw capture stores only direct hover lifecycle facts. Higher-level semantics such as:

```text
hover-preview
```

are derived offline by:

```text
training-collector/tools/build_action_semantics.js
```

Example regression case:

```text
YouTube thumbnail hover
→ dwell
→ preview starts
→ audio/mute control appears
→ no navigation
```

## SPA routes and stream health

`observer/route_trace.js` detects route changes using popstate/hashchange plus location polling. Route changes emit a sanitized route event and semantic snapshot anchor.

Stream-health records allow analyzer diagnostics for cases where a page appears to produce physical telemetry but semantic/DOM/hover/mutation streams are unexpectedly absent.

## IndexedDB reliability

Database:

```text
trainingCollectorRawV06
```

Stores:

```text
sessions
chunks
batchReceipts
```

Chunk size: 1000 events.

Reliability includes:

```text
RAW_BATCH batchId ACK/retry
receipt dedupe
serialized background append
chunk checksum
missing/checksum/event-count/sequence verification
```

The DB name remains V06 for storage continuity; session/event raw schema is 0.7.2.

## Analyzer

```bat
node training-collector\tools\analyze_raw.js path\to\session.raw.jsonl
node training-collector\tools\analyze_raw.js path\to\session.raw.jsonl.gz
```

Reports include:

```text
event/source distributions
pointer sampling gaps
physical↔semantic correlation
mutation burst volume
sessionSeq integrity
timestamp reversals
privacy flags
frame/document/pageInstance coverage
route/snapshot counts
stream-health and physical-only suspicion
```

Socket server `.raw.jsonl` files can be analyzed directly while or after a session is collected.

## Privacy boundary

Collector does not intentionally capture/store:

- password values;
- cookies;
- Authorization/access/refresh tokens;
- localStorage/sessionStorage secret contents;
- clipboard contents;
- payment secrets;
- raw sensitive input values;
- printable keyboard character/code content;
- URL query values/hash contents;
- raw page title under the current policy.

Filtering should happen before sensitive data leaves the content script whenever possible. The socket server receives only the already-filtered Collector raw events.

## Development test flow

```text
1 git pull
2 start training-collector/socket-server/START_SOCKET_SERVER.bat
3 chrome://extensions → Reload Training Collector
4 refresh/reopen target tabs
5 browse normally
6 popup → Socket Mirror should show connected
7 inspect training-collector/socket-data/*.raw.jsonl growing continuously
8 close Chrome
9 wait ~45 s or reopen Chrome
10 inspect session .meta.json / session-end
```

Manual JSONL.gz export is fallback only and no longer needs to be part of normal testing.
