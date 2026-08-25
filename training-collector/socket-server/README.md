# Training Collector Socket Server

Local development ingest server for Training Collector V0.8.

## Start on Windows

```bat
cd training-collector\socket-server
START_SOCKET_SERVER.bat
```

The first run installs the single `ws` dependency, then starts:

```text
ws://127.0.0.1:8765/training-collector
```

The server binds to localhost by default. Raw files are written outside Git tracking to:

```text
training-collector/socket-data/
  <sessionId>.raw.jsonl
  <sessionId>.meta.json
```

## Protocol

```text
extension → client-hello
extension → session-open
server    → session-ack { resumeFromSeq }
extension → event-batch { sessionId, firstSeq, lastSeq, events }
server    → batch-ack { lastSeq }

connection loss / server restart
→ reconnect
→ session-open
→ server returns persisted resumeFromSeq
→ extension replays missing events from IndexedDB
```

The server accepts only the next contiguous `sessionSeq`. Events at or below the stored sequence are treated as duplicates and ignored. A gap causes `resync`, after which the extension replays from the server's last durable sequence.

## Browser exit

While connected, the extension sends a heartbeat every 20 seconds. When the WebSocket disappears and does not reconnect within the default 45-second grace period, the server appends a `session-end` record and marks the session closed. A later reconnect with the same session ID can resume the file safely.

When Chrome starts again, the extension also detects IndexedDB sessions left active by the previous browser process, marks them `closed-inferred`, replays any missing events to the server, then sends `session-close`.

## Storage responsibility

```text
IndexedDB = browser-side safety buffer / replay source
Socket server JSONL = continuous development ingest/archive
Manual JSONL.gz = fallback/debug only
```

The socket path does not weaken the Collector privacy boundary. It receives only the already-filtered raw events that would otherwise be persisted in IndexedDB.

## Environment variables

```text
TC_SOCKET_HOST                 default 127.0.0.1
TC_SOCKET_PORT                 default 8765
TC_SOCKET_DATA_DIR             default training-collector/socket-data
TC_SOCKET_FINALIZE_GRACE_MS    default 45000
TC_SOCKET_MAX_PAYLOAD          default 16777216
```
