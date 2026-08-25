# PROJECT JOURNAL — persistent engineering memory

Mục đích: bộ nhớ kỹ thuật lâu dài cho `banupham/extension_agent`.

```text
STATUS.md
→ current milestone / next step

PROJECT_JOURNAL.md
→ code lookup / invariants / rationale / traps / regression cases

source trên main
→ implementation truth
```

Nếu journal và source mâu thuẫn, source hiện tại trên `main` là implementation truth; sau đó journal phải được cập nhật lại.

---

# 1. Quy trình trước khi sửa code

```text
1. đọc STATUS.md
2. search PROJECT_JOURNAL.md theo component/problem
3. fetch đúng source files được chỉ ra
4. fetch contract/test liên quan
5. sửa theo boundary hiện có
6. CI/offline test
7. browser validation nếu runtime/browser behavior
8. cập nhật STATUS/JOURNAL khi knowledge dài hạn thay đổi
```

Không quét toàn repo nếu journal đã xác định được vùng code.

---

# 2. Product boundaries

```text
RECORDER
Human → deterministic Scenario

TRAINING COLLECTOR
Human → raw physical + semantic browser session

AGENT
Task → Strategy → Action Contract → Behavior Policy → CDP Executor
```

```text
Strategy       = WHAT to do
Behavior Model = HOW naturally
Executor       = translate execution plan to CDP
```

Recorder không phải raw training collector. Collector observe-only. Agent Strategy/model không phát raw CDP.

---

# 3. Training Collector current architecture — V0.8

Runtime:

```text
manifest version: 0.8.0
raw schema:       0.7.2
```

Primary development flow:

```text
content scripts / all frames
→ RAW_BATCH + batchId
→ background normalize + sessionSeq
→ IndexedDB append / receipt dedupe
→ localhost WebSocket mirror
→ append-only JSONL server archive
```

Critical invariant:

```text
persist IndexedDB first
→ mirror socket second
```

Socket send is never allowed to replace browser-side persistence.

Manual `.raw.jsonl.gz` export remains fallback/debug only.

---

# 4. Code Lookup Map — capture / semantics

## Physical pointer / wheel / keyboard / idle / focus

Read:

```text
training-collector/capture/physical_capture.js
training-collector/correlation/physical_semantic_correlator.js
training-collector/content.js
training-collector/core/reliable_sender.js
```

Invariants:

- raw physical stays un-derived;
- printable keyboard does not store actual char/code;
- sensitive targets filtered before raw leaves content script;
- physical↔semantic correlation near capture time.

## DOM click/focus/input/change/submit

Read:

```text
training-collector/capture/dom_capture.js
training-collector/correlation/action_target_resolver.js
training-collector/observer/semantic_observer.js
training-collector/observer/element_registry.js
training-collector/content.js
```

Target contract:

```text
targetRef          legacy/raw event target
rawTargetRef       raw DOM event.target
resolvedTargetRef  interpreted actionable target
targetResolution   method + confidence
```

Never overwrite raw target with resolved target.

## Hover / preview

Read:

```text
training-collector/observer/hover_trace.js
training-collector/observer/mutation_trace.js
training-collector/correlation/action_target_resolver.js
training-collector/tools/build_action_semantics.js
training-collector/tests/v07_action_semantics_contract.js
```

Raw facts:

```text
dom-hover-enter
dom-hover-dwell
dom-hover-leave
```

Derived offline:

```text
hover
hover-dwell
hover-preview
```

Regression case:

```text
YouTube thumbnail hover
→ dwell
→ animated preview
→ mute/audio control appears
→ no navigation
```

Need distinguish `hover-preview`, `click-open`, `click-control`.

## Mutation

Read:

```text
training-collector/observer/mutation_trace.js
training-collector/tools/analyze_raw.js
training-collector/tools/build_action_semantics.js
```

Current capture-time compromise:

```text
dom-mutation-burst ~120 ms
```

Do not dump innerHTML/textContent/raw values. Mutation relevance remains dataset/derived concern.

---

# 5. Frame / SPA / stream diagnostics — inherited V0.7.2

Read:

```text
training-collector/manifest.json
training-collector/content.js
training-collector/observer/route_trace.js
training-collector/background.js
training-collector/tools/analyze_raw.js
training-collector/tests/v072_frame_stream_contract.js
```

Manifest:

```text
all_frames = true
match_about_blank = true
match_origin_as_fallback = true
```

Persisted identity:

```text
tabId
windowId
frameId
documentId
documentLifecycle
pageInstanceId
elementRef
```

Composite element identity:

```text
tabId + frameId + pageInstanceId + elementRef
```

Do not treat `e17` as globally unique.

Coordinates inside iframe are frame-client coordinates.

Continuous raw = all-frame. Optional Task Episode = top-frame only until Agent Observation has an explicit multi-frame contract.

SPA route trace:

```text
popstate
hashchange
location poll 500 ms
→ route-change
→ semantic-snapshot snapshotReason=route-change
```

Stream diagnostics:

```text
collector-stream-start
collector-stream-health
collector-stream-stop
```

Used to distinguish “no interaction” from “capture module appears silent”.

---

# 6. Timeline / ordering

Read:

```text
training-collector/content.js
training-collector/background.js
training-collector/observer/mutation_trace.js
training-collector/observer/hover_trace.js
```

Fields:

```text
tsEpochMs  capture timestamp
pageSeq    page-local capture order
sourceSeq  source-local order
sessionSeq durable background persistence order
```

`sessionSeq` is not chronological truth across asynchronous sources.

---

# 7. IndexedDB reliability

Read:

```text
training-collector/core/raw_session_store.js
training-collector/core/indexeddb_chunk_store.js
training-collector/core/reliable_sender.js
training-collector/background.js
training-collector/tests/v06_storage_contract.js
```

Current DB:

```text
trainingCollectorRawV06
stores:
  sessions
  chunks
  batchReceipts
chunk size: 1000
```

DB name remains V06 for storage continuity; raw schema is 0.7.2.

Retry invariant:

```text
same batchId retry
→ receipt exists
→ ACK again
→ do not append duplicate events
```

Integrity checks:

```text
missing chunk
checksum mismatch
event-count mismatch
firstSeq/lastSeq mismatch
cross-chunk sequence gap
```

Never auto-delete raw data because integrity verification failed.

---

# 8. V0.8 socket mirror lookup

Read first:

```text
training-collector/core/socket_mirror.js
training-collector/background.js
training-collector/socket-server/server.js
training-collector/socket-server/README.md
training-collector/popup.js
training-collector/tests/v08_socket_mirror_contract.js
```

Endpoint:

```text
ws://127.0.0.1:8765/training-collector
```

Protocol:

```text
client-hello
session-open
session-ack { resumeFromSeq }
event-batch
batch-ack { lastSeq }
resync { resumeFromSeq }
session-close
heartbeat
```

Mirror rules:

```text
1. background persists normalized events first
2. only non-duplicate persisted batch is published live
3. reconnect → session-open
4. server returns durable resumeFromSeq
5. extension replays missing IndexedDB chunks in bounded batches
6. server ignores <= lastSeq duplicate events
7. sequence gap → resync
```

`core/socket_mirror.js` owns connection/reconnect/heartbeat/session ACK state.

`background.js` owns:

```text
session lifecycle
sessionSeq assignment
IndexedDB durability
chunk-by-chunk replay callback
```

Do not move IndexedDB persistence behind socket ACK.

## Socket server

Files:

```text
training-collector/socket-server/package.json
training-collector/socket-server/server.js
training-collector/socket-server/START_SOCKET_SERVER.bat
training-collector/socket-server/README.md
```

Default output:

```text
training-collector/socket-data/<sessionId>.raw.jsonl
training-collector/socket-data/<sessionId>.meta.json
```

Server binds localhost by default.

Server durability rules:

```text
append JSONL batch
→ persist meta lastSeq
→ send batch-ack
```

On startup/session-open server scans existing JSONL to recover `lastSeq`; meta alone is not trusted as the only recovery source.

Browser-exit heuristic:

```text
WebSocket disconnect
→ 45 s grace
→ no reconnect
→ append session-end
→ status closed
```

A same-session reconnect may resume after a provisional close.

## Backlog recovery

Important V0.8 property:

```text
server can start late
OR
server can restart
OR
previous browser session can already be closed
```

and missing events can still be replayed from IndexedDB.

This is why old sessions that failed automatic download may still be recoverable.

---

# 9. Manual export — fallback only

Read:

```text
training-collector/popup.js
training-collector/background.js
```

Flow:

```text
GET_RAW_EXPORT_META
GET_RAW_EXPORT_CHUNK
→ popup CompressionStream(gzip)
→ manual .raw.jsonl.gz
```

No offscreen auto-export runtime remains in V0.8.

Removed from active architecture:

```text
offscreen.html
offscreen.js
downloads permission
offscreen permission
alarms permission
auto-export retry path
```

Do not reintroduce Downloads API as the main persistence/extraction architecture.

---

# 10. Analyzer / dataset lookup

Read:

```text
training-collector/tools/analyze_raw.js
training-collector/tests/raw_analysis_contract.js
training-collector/tools/build_action_semantics.js
training-collector/tests/v07_action_semantics_contract.js
```

Analyzer reads:

```text
legacy JSON
JSONL
JSONL.gz
```

Socket server `.raw.jsonl` can be analyzed directly.

Metrics include:

```text
event/source distributions
pointer gaps
physical↔semantic correlation
mutation volume
sessionSeq integrity
timestamp inversions
privacy flags
frame/document/pageInstance coverage
route/snapshot counts
stream-health / physical-only suspicion
```

Derived semantics remain interpretation, not raw truth.

---

# 11. Agent lookup / CAPTCHA boundary

Strategy:

```text
control-center/manager/strategy/
docs/AGENT_TRAINING_ARCHITECTURE.md
docs/AGENT_BOUNDARY_CONDITIONS.md
```

Execution:

```text
control-center/extension/agent-runtime-extension/background.js
control-center/ACTION_CONTRACT.json
```

CAPTCHA policy:

```text
observe CAPTCHA / human verification
→ Decision.status = blocked
→ reasonCode = human_verification_required
→ do not solve/bypass automatically
→ do not retry blindly
→ re-evaluate goal
→ alternative legitimate route/page only if it serves task
→ otherwise stop blocked
```

Frame-aware observation exists for completeness, not challenge bypass.

---

# 12. Privacy invariants

Do not capture/store:

- password values;
- cookies;
- Authorization/access/refresh tokens;
- localStorage/sessionStorage secret contents;
- clipboard contents;
- payment secrets;
- raw sensitive input values;
- printable keyboard actual character/code;
- URL query values/hash content;
- raw document title under current policy.

Socket transport does not expand capture scope. It mirrors only already-filtered Collector raw events.

Do not commit `socket-data/` or user raw sessions to GitHub.

---

# 13. CI map

Workflow:

```text
.github/workflows/extension-syntax.yml
```

Collector contracts:

```text
training-collector/tests/architecture_contract.js
training-collector/tests/raw_session_contract.js
training-collector/tests/raw_analysis_contract.js
training-collector/tests/v06_storage_contract.js
training-collector/tests/v07_action_semantics_contract.js
training-collector/tests/v072_frame_stream_contract.js
training-collector/tests/v08_socket_mirror_contract.js
```

CI success != Chrome/server integration tested.

---

# 14. Architectural decisions

## D001 — Scenario Mode and Agent Mode stay separate
Protect deterministic execution.

## D002 — Recorder and Training Collector are different products
Recorder → deterministic Scenario; Collector → training telemetry.

## D003 — Physical raw stays un-derived
Behavior features are derived offline.

## D004 — DOM is core semantic signal; physical is supplementary
Agent needs target/state/outcome, not trajectory alone.

## D005 — Physical↔semantic correlation near capture time
Avoid target drift.

## D006 — Mutation uses bursts
V0.4 showed mutation noise dominating raw streams.

## D007 — IndexedDB is browser-side raw persistence
Do not depend on browser downloads as storage.

## D008 — Download export is debug/fallback only
V0.8 removes auto-download runtime entirely.

## D009 — Batch receipts make RAW_BATCH retries idempotent
Serialized append alone is insufficient for ACK loss.

## D010 — Natural Execution is a separate layer
Strategy=WHAT, Behavior=HOW, Executor=CDP.

## D011 — Hover can be an action with outcome
Dynamic UI may respond without click/navigation.

## D012 — Raw and resolved action targets coexist
Interpretation must not destroy raw fact.

## D013 — pageSeq/sourceSeq support reconstruction
sessionSeq is persistence order.

## D014 — hover-preview is derived offline
Raw keeps lifecycle/state facts.

## D015 — CAPTCHA is an Agent boundary condition
Blocked/replan legitimately; no automatic solving/bypass.

## D016 — Frame identity is composite
`tabId + frameId + pageInstanceId + elementRef`.

## D017 — All-frame raw does not imply multi-frame Agent Episode
Episode stays top-frame until contract explicitly changes.

## D018 — SPA route changes need semantic re-anchor
route-change + semantic snapshot.

## D019 — Stream silence must be observable
collector-stream-health exists for diagnostics.

## D020 — Socket mirror is post-persist transport
IndexedDB first, socket second.

## D021 — Socket resume uses server durable sequence
Server returns `resumeFromSeq`; extension replays from IndexedDB.

## D022 — Server rejects sequence gaps and tolerates duplicates
`<= lastSeq` duplicate ignored; gap → resync.

## D023 — WebSocket disconnect is not immediately browser-session end
Use grace period because MV3/runtime/network can reconnect.

## D024 — Continuous server JSONL is the preferred development archive
Manual gzip remains fallback; production storage architecture can evolve later.

---

# 15. Engineering diary — key regressions/milestones

## 2026-08-25 — persistent journal introduced
Needed because repo became multi-product and long-running.

## V0.6.1 — temporary auto-export
Offscreen gzip/download adapter added for development convenience.

## V0.7 — Action Semantics
Added Action Target Resolver, hover lifecycle, pageSeq/sourceSeq, offline hover-preview derivation.

## CAPTCHA/iframe regression
Native test exposed missing iframe observation and established CAPTCHA as blocked boundary.

## V0.7.1 — export recovery
Status-indexed recovery + download completion diagnostics were added, but download remained fragile.

## YouTube Playables regression
Resolved actionable target was often better than raw child text/img target. Actionable-parent labels can still be empty; semantic label propagation remains backlog with privacy considerations.

## Google Search embedded YouTube regression
Embedded video and gray overlay exposed need for frame-aware capture and direct stream-health diagnostics.

## V0.7.2 — Frame-Aware Stream Diagnostics
Added all-frame raw, frame/document identity, route re-anchors, stream-health, gzip-aware analyzer.

## V0.8 — Socket Mirror
Native popup showed a closed session with:

```text
autoExport=failed
Cannot read properties of undefined (reading 'download')
```

Decision: stop optimizing Downloads adapter. Add localhost WebSocket server + resume/ACK/replay protocol. Remove offscreen auto-export runtime and permissions. Keep IndexedDB as safety source and manual gzip fallback.

Next gate:

```text
start socket server
→ Chrome V0.8 native test
→ confirm connected + growing JSONL
→ stop/restart server → resume no duplicate/gap
→ close Chrome → server finalizes after grace
→ analyze native socket JSONL
```

---

# 16. Maintenance rule

Update this journal when:

- module responsibility changes;
- a new contract/protocol is introduced;
- a difficult bug reveals an invariant;
- a temporary mechanism is added/removed;
- migration/version changes future lookup entry points;
- CI/browser validation path changes.

Do not turn this into a dump of every commit.
