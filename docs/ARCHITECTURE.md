# Architecture

```text
Scenario .js
    |
    v
run_check.js
    |  WebSocket client, TARGET_AGENT_ID
    v
Broker server :3000
    |
    +---- agent A -> Chrome/GPM extension
    +---- agent B -> Chrome/GPM extension
    +---- agent C -> Chrome/GPM extension

Control Center :8788
    |
    +-- scenario registry
    +-- run queue / scheduler
    +-- per-agent worker
    +-- run diagnostics
    +-- browser launcher registry
```

## Run lifecycle V3.8

```text
run_created
  -> batch_task_created
  -> parallel_enqueued / sequential_enqueued
  -> worker_start
  -> worker_dequeued
  -> execute_task_enter
  -> child_spawn_request
  -> child_spawned
  -> runner_plan
  -> runner_progress ...
  -> runner_summary
  -> run_finalizing(done|failed)
  -> child_exit
```

Nếu card nằm `queued`, mở diagnostic. Event cuối cho biết trạng thái:

- `waiting_agent_offline`: agent đã mất kết nối.
- `missing_runtime_task`: record persisted nhưng task runtime không còn, thường sau restart.
- `watchdog_requeued`: watchdog vừa đưa task lại queue.
- `watchdog_worker_restart`: queue có task nhưng worker không tồn tại; worker được restart.
- `queued_worker_busy`: agent đang bận một run khác.

## Root cause Runs & logs V3.7

`saveState()` từng thay `state.runs` bằng các object clone mỗi lần ghi state. Worker tiếp tục cập nhật object cũ còn dashboard đọc clone cũ ở trạng thái `queued`. V3.8 giữ nguyên object identity trong RAM và chỉ clone ở bước serialize ra disk.
