# Training Collector Socket Server

Local development ingest + machine-verification backend for Training Collector V0.8.

## Start on Windows

Raw mirroring and Task Episode machine classification work with the existing launcher:

```bat
cd training-collector\socket-server
START_SOCKET_SERVER.bat
```

To also enable automatic candidate creation after the ACCEPT buffer reaches its threshold, pass the current base dataset and production model to the same launcher:

```bat
START_SOCKET_SERVER.bat "<base-dataset-dir>" "<base-model.json>" 100
```

The first run installs the single `ws` dependency, then starts:

```text
ws://127.0.0.1:8765/training-collector
```

The server binds to localhost by default. Production model promotion is never performed by this server.

## Durable data layout

```text
training-collector/socket-data/
  <sessionId>.raw.jsonl
  <sessionId>.meta.json
  task-episode-reviews/
    <episodeId>.task-episode-review.json
  pipeline/
    state.json
    receipts/
      <episodeId>.machine-eligibility.json
    candidates/
      <batchId>/...
    work/                         # transient and cleaned after processing
```

`task-episode-reviews/` contains the privacy-safe review export, not raw interaction telemetry. `receipts/` contains the machine decision and evidence. QUARANTINE and REJECT receipts never enter candidate dataset construction.

## Raw-session protocol

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

## Task Episode pipeline protocol

After the user presses **Mark Success**, the extension builds the existing privacy-safe Task Episode review, writes it to a durable `chrome.storage.local` outbox, then uses the same WebSocket:

```text
extension → task-episode-review
server    → persist review
server    → task-episode-review-ack
server    → machine eligibility
server    → ACCEPT | QUARANTINE | REJECT receipt
server    → task-episode-review-result + pipeline-status
```

The ACK is sent only after a safe review has been durably written. Re-sending the same episode is deduplicated. Reusing an episode ID with different review content is rejected as a digest conflict. On server restart, persisted reviews without receipts are automatically reprocessed. On extension service-worker restart, unacknowledged reviews are replayed from the local outbox.

Machine eligibility reuses `prepare_incremental_strategy_learning.js`; it does not invent a second training path. ACCEPT requires the existing independent outcome + semantic gates. QUARANTINE remains outside training. Privacy-invalid reviews are fail-closed and the unsafe payload is not persisted by the server.

## Candidate batching and protection

Default candidate threshold is **100 machine ACCEPT episodes**. Until both base paths are configured, the backend continues classifying reviews but reports `Training config: WAITING` and does not fit a model.

When the threshold is reached and base config exists:

```text
ACCEPT buffer
→ existing incremental Strategy orchestrator
→ machine-verified dataset
→ candidate model
→ existing Candidate Protection runner (default ON)
→ candidate ready / protection failure status
```

The backend sets and reports `productionPromotionAllowed: false`. Even after protection PASS, promotion remains a separate manual operation. A pending candidate blocks creation of another automatic candidate so later batches cannot silently diverge from an unpromoted base model.

## Browser exit

While connected, the extension sends a heartbeat every 20 seconds. When the WebSocket disappears and does not reconnect within the default 45-second grace period, the server appends a `session-end` record and marks the session closed. A later reconnect with the same session ID can resume the file safely.

When Chrome starts again, the extension also detects IndexedDB sessions left active by the previous browser process, marks them `closed-inferred`, replays any missing events to the server, then sends `session-close`.

## Storage responsibility

```text
IndexedDB = browser-side raw safety buffer / replay source
Socket server JSONL = continuous raw development ingest/archive
Task review outbox = browser-side durable successful-episode delivery
Socket pipeline receipts = machine eligibility audit trail
Manual JSONL.gz / Task Episode export = fallback or audit only
```

The socket path does not weaken the Collector privacy boundary. Raw mirroring receives only the already-filtered events persisted in IndexedDB, while Strategy automation receives the existing privacy-safe Task Episode review export.

## Environment variables

```text
TC_SOCKET_HOST                         default 127.0.0.1
TC_SOCKET_PORT                         default 8765
TC_SOCKET_DATA_DIR                     default training-collector/socket-data
TC_SOCKET_FINALIZE_GRACE_MS            default 45000
TC_SOCKET_MAX_PAYLOAD                  default 16777216

TC_STRATEGY_PIPELINE_ENABLED           default 1
TC_STRATEGY_BATCH_THRESHOLD            default 100
TC_STRATEGY_BASE_DATASET               optional; required for candidate creation
TC_STRATEGY_BASE_MODEL                 optional; required for candidate creation
TC_STRATEGY_AUTO_PROTECT               default 1
TC_STRATEGY_HEALTH_BASE                default http://127.0.0.1:3000
TC_STRATEGY_BROKER                     default ws://127.0.0.1:3000
TC_STRATEGY_AGENT_ID                   optional
TC_STRATEGY_MINIMUM_BENCHMARK_SCORE    default 90
TC_STRATEGY_PROTECTION_TIMEOUT_MS      default 10000
```
