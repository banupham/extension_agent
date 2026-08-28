'use strict';

(function initSocketMirror(root) {
  const NS = root.TrainingCollectorV08 = root.TrainingCollectorV08 || {};

  function createSocketMirror(options = {}) {
    const endpoint = String(options.endpoint || 'ws://127.0.0.1:8765/training-collector');
    const replaySession = typeof options.replaySession === 'function' ? options.replaySession : async () => {};
    const onTaskReviewAck = typeof options.onTaskReviewAck === 'function' ? options.onTaskReviewAck : null;
    const onPipelineStatus = typeof options.onPipelineStatus === 'function' ? options.onPipelineStatus : null;
    const heartbeatMs = Math.max(10000, Number(options.heartbeatMs || 20000));
    const maxReconnectMs = Math.max(2000, Number(options.maxReconnectMs || 10000));
    const sessions = new Map();
    const taskReviews = new Map();
    let socket = null;
    let started = false;
    let reconnectAttempt = 0;
    let reconnectTimer = null;
    let heartbeatTimer = null;
    let connectedAt = null;
    let lastMessageAt = null;
    let lastError = null;
    let lastTaskReviewAck = null;
    let pipeline = null;

    function nowIso() { return new Date().toISOString(); }
    function isOpen() { return socket && socket.readyState === WebSocket.OPEN; }
    function safeSession(session) {
      if (!session) return null;
      return {
        schemaVersion: session.schemaVersion || null,
        sessionId: session.sessionId,
        status: session.status || 'active',
        startedAt: session.startedAt || null,
        endedAt: session.endedAt || null,
        lastSeenAt: session.lastSeenAt || null,
        endReason: session.endReason || null,
        eventCount: Number(session.eventCount || 0),
        chunkCount: Number(session.chunkCount || 0),
        storageBackend: session.storageBackend || 'indexeddb',
        privacy: session.privacy || null,
        rawModel: session.rawModel || null
      };
    }
    function rowFor(session, closeWhenSynced = false) {
      if (!session?.sessionId) return null;
      let row = sessions.get(session.sessionId);
      if (!row) {
        row = {
          session: safeSession(session),
          serverReady: false,
          syncing: false,
          sentThrough: 0,
          ackedThrough: 0,
          closeWhenSynced: false,
          closeSent: false,
          liveQueue: []
        };
        sessions.set(session.sessionId, row);
      }
      row.session = safeSession(session);
      row.closeWhenSynced = row.closeWhenSynced || !!closeWhenSynced || session.status !== 'active';
      return row;
    }
    function send(payload) {
      if (!isOpen()) return false;
      try {
        socket.send(JSON.stringify(payload));
        return true;
      } catch (error) {
        lastError = String(error?.message || error);
        return false;
      }
    }
    function sendSessionOpen(row) {
      if (!row || !isOpen()) return;
      row.serverReady = false;
      row.syncing = false;
      row.closeSent = false;
      send({ type: 'session-open', protocol: 'training-collector-v1', session: row.session });
    }
    function sendEventBatch(sessionId, events) {
      if (!events?.length) return true;
      const firstSeq = Number(events[0]?.sessionSeq || 0);
      const lastSeq = Number(events[events.length - 1]?.sessionSeq || 0);
      return send({ type: 'event-batch', protocol: 'training-collector-v1', sessionId, firstSeq, lastSeq, events });
    }
    function sendTaskReview(row) {
      if (!row?.review || !isOpen() || row.sent === true) return false;
      const sent = send({
        type: 'task-episode-review',
        protocol: 'training-collector-v1',
        episodeId: row.review.episodeId || null,
        review: row.review
      });
      if (sent) {
        row.sent = true;
        row.sentAt = nowIso();
      }
      return sent;
    }
    async function syncRow(row) {
      if (!row || row.syncing || !row.serverReady || !isOpen()) return;
      row.syncing = true;
      try {
        let cursor = Number(row.ackedThrough || 0);
        await replaySession(row.session.sessionId, cursor, async events => {
          if (!isOpen()) throw new Error('socket_closed_during_replay');
          const fresh = (events || []).filter(event => Number(event?.sessionSeq || 0) > cursor);
          if (!fresh.length) return;
          if (!sendEventBatch(row.session.sessionId, fresh)) throw new Error('socket_send_failed');
          cursor = Number(fresh[fresh.length - 1]?.sessionSeq || cursor);
          row.sentThrough = Math.max(row.sentThrough, cursor);
        });

        const queued = row.liveQueue.splice(0, row.liveQueue.length);
        for (const batch of queued) {
          const fresh = (batch || []).filter(event => Number(event?.sessionSeq || 0) > row.sentThrough);
          if (!fresh.length) continue;
          if (!sendEventBatch(row.session.sessionId, fresh)) throw new Error('socket_send_failed');
          row.sentThrough = Number(fresh[fresh.length - 1]?.sessionSeq || row.sentThrough);
        }

        if (row.closeWhenSynced && !row.closeSent) {
          row.closeSent = send({
            type: 'session-close',
            protocol: 'training-collector-v1',
            sessionId: row.session.sessionId,
            expectedLastSeq: Number(row.session.eventCount || row.sentThrough || 0),
            endedAt: row.session.endedAt || nowIso(),
            reason: row.session.endReason || 'browser_session_closed'
          });
        }
      } catch (error) {
        lastError = String(error?.message || error);
      } finally {
        row.syncing = false;
      }
    }
    function scheduleReconnect() {
      if (!started || reconnectTimer) return;
      const delay = Math.min(maxReconnectMs, 750 * Math.pow(2, Math.min(4, reconnectAttempt)));
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    }
    function stopHeartbeat() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    function startHeartbeat() {
      stopHeartbeat();
      heartbeatTimer = setInterval(() => {
        if (!isOpen()) return;
        send({ type: 'heartbeat', protocol: 'training-collector-v1', at: nowIso() });
      }, heartbeatMs);
    }
    function notifyPipelineStatus(message) {
      if (message?.pipeline && typeof message.pipeline === 'object') pipeline = message.pipeline;
      if (!onPipelineStatus) return;
      Promise.resolve(onPipelineStatus(message)).catch(error => {
        lastError = `pipeline_status_callback_failed:${String(error?.message || error)}`;
      });
    }
    function handleMessage(message) {
      lastMessageAt = nowIso();
      if (message?.type === 'session-ack') {
        const row = sessions.get(String(message.sessionId || ''));
        if (!row) return;
        row.serverReady = true;
        row.ackedThrough = Math.max(0, Number(message.resumeFromSeq || 0));
        row.sentThrough = row.ackedThrough;
        row.closeSent = false;
        syncRow(row);
        return;
      }
      if (message?.type === 'batch-ack') {
        const row = sessions.get(String(message.sessionId || ''));
        if (!row) return;
        row.ackedThrough = Math.max(row.ackedThrough, Number(message.lastSeq || 0));
        return;
      }
      if (message?.type === 'session-closed') {
        const sessionId = String(message.sessionId || '');
        const row = sessions.get(sessionId);
        if (!row || !row.closeWhenSynced) return;
        const acknowledgedThrough = Math.max(row.ackedThrough, Number(message.lastSeq || 0));
        const expectedThrough = Number(row.session?.eventCount || 0);
        if (acknowledgedThrough < expectedThrough) return;
        row.liveQueue.splice(0, row.liveQueue.length);
        sessions.delete(sessionId);
        return;
      }
      if (message?.type === 'resync') {
        const row = sessions.get(String(message.sessionId || ''));
        if (!row) return;
        row.serverReady = true;
        row.ackedThrough = Math.max(0, Number(message.resumeFromSeq || 0));
        row.sentThrough = row.ackedThrough;
        row.closeSent = false;
        syncRow(row);
        return;
      }
      if (message?.type === 'task-episode-review-ack') {
        const episodeId = String(message.episodeId || '');
        lastTaskReviewAck = message;
        if (message.persisted === true || message.permanent === true) taskReviews.delete(episodeId);
        if (message.pipeline) notifyPipelineStatus(message);
        if (onTaskReviewAck) {
          Promise.resolve(onTaskReviewAck(message)).catch(error => {
            lastError = `task_review_ack_callback_failed:${String(error?.message || error)}`;
          });
        }
        return;
      }
      if (message?.type === 'task-episode-review-result' || message?.type === 'pipeline-status') {
        notifyPipelineStatus(message);
      }
    }
    function connect() {
      if (!started || isOpen() || socket?.readyState === WebSocket.CONNECTING) return;
      try {
        socket = new WebSocket(endpoint);
      } catch (error) {
        lastError = String(error?.message || error);
        scheduleReconnect();
        return;
      }
      socket.addEventListener('open', () => {
        connectedAt = nowIso();
        lastError = null;
        reconnectAttempt = 0;
        send({ type: 'client-hello', protocol: 'training-collector-v1', runtime: 'mv3-background', at: connectedAt });
        send({ type: 'pipeline-status-request', protocol: 'training-collector-v1' });
        for (const row of sessions.values()) sendSessionOpen(row);
        for (const row of taskReviews.values()) {
          row.sent = false;
          sendTaskReview(row);
        }
        startHeartbeat();
      });
      socket.addEventListener('message', event => {
        try { handleMessage(JSON.parse(String(event.data || '{}'))); }
        catch (error) { lastError = `bad_server_message:${String(error?.message || error)}`; }
      });
      socket.addEventListener('error', () => { lastError = 'socket_error'; });
      socket.addEventListener('close', event => {
        stopHeartbeat();
        connectedAt = null;
        for (const row of sessions.values()) {
          row.serverReady = false;
          row.syncing = false;
          row.closeSent = false;
        }
        for (const row of taskReviews.values()) row.sent = false;
        lastError = `socket_closed:${Number(event.code || 0)}:${String(event.reason || '')}`;
        scheduleReconnect();
      });
    }
    function start() {
      if (started) return;
      started = true;
      connect();
    }
    function stop() {
      started = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      stopHeartbeat();
      try { socket?.close(1000, 'collector_stop'); } catch {}
      socket = null;
    }
    function registerSession(session, options = {}) {
      if (!session?.sessionId) return null;
      const existed = sessions.has(session.sessionId);
      const row = rowFor(session, !!options.closeWhenSynced);
      if (!row || !isOpen()) return row;
      if (!existed) sendSessionOpen(row);
      else if (options.closeWhenSynced && row.serverReady) syncRow(row);
      return row;
    }
    function publish(session, events) {
      const row = rowFor(session, false);
      if (!row || !events?.length) return;
      const fresh = events.filter(event => Number(event?.sessionSeq || 0) > row.sentThrough);
      if (!fresh.length) return;
      if (!isOpen() || !row.serverReady || row.syncing) {
        row.liveQueue.push(fresh);
        connect();
        return;
      }
      if (sendEventBatch(row.session.sessionId, fresh)) row.sentThrough = Number(fresh[fresh.length - 1]?.sessionSeq || row.sentThrough);
      else row.liveQueue.push(fresh);
    }
    function registerTaskReview(review) {
      const episodeId = String(review?.episodeId || '').trim();
      if (!episodeId) return null;
      const row = {
        review,
        registeredAt: nowIso(),
        sent: false,
        sentAt: null
      };
      taskReviews.set(episodeId, row);
      if (!started) start();
      else if (isOpen()) sendTaskReview(row);
      else connect();
      return row;
    }
    function requestPipelineStatus() {
      if (!isOpen()) {
        connect();
        return false;
      }
      return send({ type: 'pipeline-status-request', protocol: 'training-collector-v1' });
    }
    function status() {
      const bySession = {};
      for (const [sessionId, row] of sessions.entries()) {
        bySession[sessionId] = {
          status: row.session?.status || null,
          eventCount: Number(row.session?.eventCount || 0),
          ackedThrough: Number(row.ackedThrough || 0),
          sentThrough: Number(row.sentThrough || 0),
          queuedBatches: row.liveQueue.length,
          serverReady: !!row.serverReady,
          closeWhenSynced: !!row.closeWhenSynced
        };
      }
      return {
        endpoint,
        state: isOpen() ? 'connected' : (socket?.readyState === WebSocket.CONNECTING ? 'connecting' : 'disconnected'),
        connectedAt,
        lastMessageAt,
        lastError,
        taskReviewOutboxCount: taskReviews.size,
        taskReviewEpisodeIds: [...taskReviews.keys()].slice(0, 20),
        lastTaskReviewAck,
        pipeline,
        sessions: bySession
      };
    }

    return {
      start,
      stop,
      connect,
      registerSession,
      publish,
      registerTaskReview,
      requestPipelineStatus,
      status
    };
  }

  NS.SocketMirror = { createSocketMirror };
})(typeof globalThis !== 'undefined' ? globalThis : this);