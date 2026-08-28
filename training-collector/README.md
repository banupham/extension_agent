# Training Collector V0.8 Socket Mirror + Task Pipeline

Observe-only Chrome MV3 extension for collecting human browser demonstrations for analysis, behavior learning, and fail-closed Strategy learning candidates.

## Current runtime

```text
Runtime:    0.8.6
Raw schema: 0.7.2
Task review: 0.1.0
```

V0.8 keeps the raw event semantics stable while adding a reliable development transport and a separate privacy-safe Task Episode pipeline.

```text
continuous raw capture
→ background serialized append
→ IndexedDB safety buffer
→ localhost WebSocket mirror
→ append-only JSONL archive

Mark Success
→ privacy-safe Task Episode review
→ durable extension outbox
→ same localhost WebSocket
→ machine eligibility
→ ACCEPT | QUARANTINE | REJECT receipt
→ ACCEPT buffer
→ candidate model when threshold/config are ready
→ candidate protection
→ manual promotion only
```

Manual `.raw.jsonl.gz` and Task Episode JSON exports remain available as fallback/audit paths, not as required normal workflow steps.

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

Task Episode delivery follows the same reliability principle:

```text
build privacy-safe review
→ persist in chrome.storage.local outbox
→ send to server
→ server persists review
→ ACK
→ remove from extension outbox
```

Therefore socket/network failure must not erase browser-side raw data or a completed successful Task Episode waiting for backend processing.

## Local socket server

Start raw mirroring + Task Episode machine classification with the existing launcher:

```bat
cd training-collector\socket-server
START_SOCKET_SERVER.bat
```

To also allow candidate creation after the machine-ACCEPT buffer reaches its threshold, pass the current base dataset and model to that same launcher:

```bat
START_SOCKET_SERVER.bat "<base-dataset-dir>" "<base-model.json>" 100
```

Endpoint:

```text
ws://127.0.0.1:8765/training-collector
```

Durable output:

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
```

`socket-data/` and `socket-server/node_modules/` are ignored by Git. Protocol/config details are in `training-collector/socket-server/README.md`.

## Automatic Strategy pipeline boundary

A user-level **Mark Success** is evidence that the demonstration should be evaluated; it is not by itself permission to train Strategy.

The backend reuses the existing incremental Strategy orchestrator and applies the same privacy, semantic-label, ambiguity, independent-outcome, dedupe, dataset, held-out, and candidate-protection boundaries.

```text
ACCEPT
= independent outcome verified
+ semantic candidate resolved/safe
+ privacy/review gates pass

QUARANTINE
= potentially useful but not independently verified or still ambiguous

REJECT
= contradicted, privacy-invalid, malformed, or otherwise unsafe
```

Only ACCEPT receipts can enter candidate batching. QUARANTINE and REJECT are retained as audit evidence but never copied into the candidate training input.

Default candidate threshold is 100 ACCEPT episodes. If base dataset/model paths are not configured, machine classification continues normally and the popup reports `Training config: WAITING`; no candidate is fit.

Candidate creation reuses `prepare_incremental_strategy_learning.js`, `finalizeMachineAcceptedStrategyLearning`, and the existing Candidate Protection runner. The server always reports production promotion as disabled. Even a protected candidate requires a separate manual promotion decision.

A pending unpromoted candidate blocks another automatic candidate, preventing later batches from silently forking from an unchanged production base.

## Pipeline Monitor

The popup now shows:

```text
extension Task Episode outbox
processed review count
ACCEPT / QUARANTINE / REJECT / duplicate / error
ACCEPT buffer / configured threshold
base dataset/model readiness
candidate version/status
candidate protection status
production promotion = MANUAL ONLY
last pipeline result/error
```

`Export Task Episode for Review` remains available for audit/fallback, but it is no longer required after a successful normal Task Episode.

## Browser-session lifecycle

A physical collection remains one Chrome browser session.

```text
Chrome starts
→ browser session ID
→ matching tabs/frames feed same raw session

Chrome exits
→ WebSocket disconnects
→ server waits grace period
→ session-end
```

If the MV3 runtime/server disconnects temporarily and reconnects with the same session ID, collection resumes instead of creating a new semantic collection boundary.

On the next Chrome start, dangling IndexedDB sessions from the prior browser process are marked `closed-inferred`, replayed to the socket server if needed, then closed server-side.

Persisted Task Episode reviews without machine receipts are also recovered and processed by the socket server after restart. Unacknowledged browser-side Task Episode reviews are replayed from the extension outbox.

## Frame-aware capture

Content scripts run with:

```text
all_frames = true
match_about_blank = true
match_origin_as_fallback = true
```

Persisted raw identity includes:

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

Continuous raw telemetry is frame-aware. Task Episode capture has frame-aware provenance support through the background/subframe bridge while the episode itself remains one task-level record.

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

Raw capture stores only direct hover lifecycle facts. Higher-level semantics such as `hover-preview` are derived offline by `training-collector/tools/build_action_semantics.js`.

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
- raw page title under the current raw-capture policy.

Filtering should happen before sensitive data leaves the content script whenever possible. Raw socket mirroring receives only already-filtered Collector events. The Strategy pipeline receives the stricter existing Task Episode review export, which explicitly excludes selectors, tab IDs, and raw action coordinates and fails closed on unsafe privacy flags.

## Development test flow

```text
1 git pull
2 start the existing socket server launcher
3 chrome://extensions → Reload Training Collector
4 refresh/reopen target tabs
5 start a Task Episode
6 perform the task normally
7 press Mark Success
8 popup → Strategy Pipeline Monitor shows queued/processed result
9 inspect socket-data/pipeline/receipts for durable machine decision
10 when ACCEPT buffer reaches threshold and base config is ready, inspect candidate/protection status
```

Manual exports are fallback/audit only and no longer need to be part of normal successful teaching flow.
