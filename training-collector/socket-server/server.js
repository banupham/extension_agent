'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const readline = require('readline');
const { WebSocketServer } = require('ws');

const HOST = process.env.TC_SOCKET_HOST || '127.0.0.1';
const PORT = Number(process.env.TC_SOCKET_PORT || 8765);
const DATA_DIR = path.resolve(process.env.TC_SOCKET_DATA_DIR || path.join(__dirname, '..', 'socket-data'));
const FINALIZE_GRACE_MS = Math.max(5000, Number(process.env.TC_SOCKET_FINALIZE_GRACE_MS || 45000));
const MAX_PAYLOAD = Math.max(1024 * 1024, Number(process.env.TC_SOCKET_MAX_PAYLOAD || 16 * 1024 * 1024));
const sessions = new Map();

function nowIso() { return new Date().toISOString(); }
function safeName(value) { return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_'); }
function rawPath(sessionId) { return path.join(DATA_DIR, `${safeName(sessionId)}.raw.jsonl`); }
function metaPath(sessionId) { return path.join(DATA_DIR, `${safeName(sessionId)}.meta.json`); }

async function ensureDataDir() { await fsp.mkdir(DATA_DIR, { recursive: true }); }
async function atomicJson(file, value) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fsp.rename(temp, file);
}

async function scanRawState(sessionId) {
  const file = rawPath(sessionId);
  let lastSeq = 0;
  let eventCount = 0;
  let hasSessionHeader = false;
  try {
    const input = fs.createReadStream(file, { encoding: 'utf8' });
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (record.recordType === 'session') hasSessionHeader = true;
      if (record.recordType !== 'event') continue;
      const seq = Number(record.sessionSeq || 0);
      if (Number.isFinite(seq) && seq > lastSeq) lastSeq = seq;
      eventCount += 1;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return { lastSeq, eventCount, hasSessionHeader };
}

async function loadSession(sessionId) {
  if (sessions.has(sessionId)) return sessions.get(sessionId);
  await ensureDataDir();
  let meta = null;
  try { meta = JSON.parse(await fsp.readFile(metaPath(sessionId), 'utf8')); } catch {}
  const scanned = await scanRawState(sessionId);
  const state = {
    sessionId,
    session: meta?.session || null,
    lastSeq: Math.max(Number(meta?.lastSeq || 0), scanned.lastSeq),
    eventCount: Math.max(Number(meta?.eventCount || 0), scanned.eventCount),
    hasSessionHeader: scanned.hasSessionHeader,
    status: meta?.status || 'open',
    connectedClients: new Set(),
    finalizeTimer: null,
    chain: Promise.resolve(),
    updatedAt: meta?.updatedAt || null,
    endedAt: meta?.endedAt || null,
    endReason: meta?.endReason || null
  };
  sessions.set(sessionId, state);
  return state;
}

function publicMeta(state) {
  return {
    protocol: 'training-collector-v1',
    sessionId: state.sessionId,
    session: state.session,
    lastSeq: state.lastSeq,
    eventCount: state.eventCount,
    status: state.status,
    updatedAt: state.updatedAt,
    endedAt: state.endedAt,
    endReason: state.endReason
  };
}

async function persistMeta(state) {
  state.updatedAt = nowIso();
  await atomicJson(metaPath(state.sessionId), publicMeta(state));
}

async function appendRecord(state, record) {
  await fsp.appendFile(rawPath(state.sessionId), `${JSON.stringify(record)}\n`, 'utf8');
}

function queueState(state, job) {
  const next = state.chain.then(job);
  state.chain = next.catch(() => {});
  return next;
}

function send(ws, payload) {
  if (ws.readyState !== ws.OPEN) return;
  try { ws.send(JSON.stringify(payload)); } catch {}
}

async function openSession(ws, message) {
  const session = message?.session;
  if (!session?.sessionId) throw new Error('missing_session_id');
  const state = await loadSession(String(session.sessionId));
  if (state.finalizeTimer) clearTimeout(state.finalizeTimer);
  state.finalizeTimer = null;
  state.connectedClients.add(ws);
  ws.sessionIds.add(state.sessionId);
  state.session = session;

  await queueState(state, async () => {
    if (!state.hasSessionHeader) {
      await appendRecord(state, {
        recordType: 'session',
        protocol: 'training-collector-v1',
        receivedAt: nowIso(),
        session
      });
      state.hasSessionHeader = true;
    } else if (state.status !== 'open') {
      await appendRecord(state, {
        recordType: 'session-resume',
        protocol: 'training-collector-v1',
        receivedAt: nowIso(),
        sessionId: state.sessionId,
        previousStatus: state.status
      });
    }
    state.status = 'open';
    state.endedAt = null;
    state.endReason = null;
    await persistMeta(state);
  });

  send(ws, {
    type: 'session-ack',
    protocol: 'training-collector-v1',
    sessionId: state.sessionId,
    resumeFromSeq: state.lastSeq
  });
}

async function appendBatch(ws, message) {
  const sessionId = String(message?.sessionId || '');
  if (!sessionId) throw new Error('missing_session_id');
  const events = Array.isArray(message?.events) ? message.events : [];
  const state = await loadSession(sessionId);
  state.connectedClients.add(ws);
  ws.sessionIds.add(sessionId);

  await queueState(state, async () => {
    const lines = [];
    let cursor = state.lastSeq;
    for (const event of events) {
      const seq = Number(event?.sessionSeq || 0);
      if (!Number.isInteger(seq) || seq <= 0) continue;
      if (seq <= cursor) continue;
      if (seq !== cursor + 1) {
        send(ws, {
          type: 'resync',
          protocol: 'training-collector-v1',
          sessionId,
          resumeFromSeq: state.lastSeq,
          expectedSeq: state.lastSeq + 1,
          receivedSeq: seq
        });
        return;
      }
      lines.push(JSON.stringify({ recordType: 'event', ...event }));
      cursor = seq;
    }
    if (lines.length) {
      await fsp.appendFile(rawPath(sessionId), `${lines.join('\n')}\n`, 'utf8');
      state.lastSeq = cursor;
      state.eventCount += lines.length;
      state.status = 'open';
      await persistMeta(state);
    }
    send(ws, {
      type: 'batch-ack',
      protocol: 'training-collector-v1',
      sessionId,
      lastSeq: state.lastSeq,
      appended: lines.length
    });
  });
}

async function finalizeSession(state, details = {}) {
  await queueState(state, async () => {
    if (state.status === 'closed' && Number(details.expectedLastSeq || 0) <= state.lastSeq) return;
    const expectedLastSeq = Number(details.expectedLastSeq || 0);
    if (expectedLastSeq > state.lastSeq) return;
    state.status = 'closed';
    state.endedAt = details.endedAt || nowIso();
    state.endReason = details.reason || 'socket_disconnect_grace_elapsed';
    await appendRecord(state, {
      recordType: 'session-end',
      protocol: 'training-collector-v1',
      sessionId: state.sessionId,
      endedAt: state.endedAt,
      reason: state.endReason,
      lastSeq: state.lastSeq,
      eventCount: state.eventCount
    });
    await persistMeta(state);
    console.log(`[collector] finalized ${state.sessionId} events=${state.eventCount} lastSeq=${state.lastSeq} reason=${state.endReason}`);
  });
}

async function closeSession(ws, message) {
  const sessionId = String(message?.sessionId || '');
  if (!sessionId) throw new Error('missing_session_id');
  const state = await loadSession(sessionId);
  const expectedLastSeq = Number(message?.expectedLastSeq || 0);
  if (expectedLastSeq > state.lastSeq) {
    send(ws, { type: 'resync', protocol: 'training-collector-v1', sessionId, resumeFromSeq: state.lastSeq });
    return;
  }
  await finalizeSession(state, {
    expectedLastSeq,
    endedAt: message?.endedAt || nowIso(),
    reason: message?.reason || 'browser_session_closed'
  });
  send(ws, { type: 'session-closed', protocol: 'training-collector-v1', sessionId, lastSeq: state.lastSeq });
}

function scheduleDisconnectFinalize(state) {
  if (state.finalizeTimer || state.connectedClients.size > 0) return;
  state.finalizeTimer = setTimeout(() => {
    state.finalizeTimer = null;
    if (state.connectedClients.size > 0) return;
    finalizeSession(state, {
      expectedLastSeq: state.lastSeq,
      endedAt: nowIso(),
      reason: 'socket_disconnect_grace_elapsed'
    }).catch(error => console.error('[collector] finalize error', error));
  }, FINALIZE_GRACE_MS);
}

async function main() {
  await ensureDataDir();
  const wss = new WebSocketServer({ host: HOST, port: PORT, maxPayload: MAX_PAYLOAD, path: '/training-collector' });

  wss.on('connection', (ws, request) => {
    ws.sessionIds = new Set();
    console.log(`[collector] connected ${request.socket.remoteAddress}`);

    ws.on('message', async data => {
      let message;
      try { message = JSON.parse(String(data)); }
      catch { return send(ws, { type: 'error', error: 'invalid_json' }); }
      try {
        if (message?.protocol && message.protocol !== 'training-collector-v1') throw new Error('unsupported_protocol');
        if (message.type === 'client-hello') return send(ws, { type: 'client-hello-ack', protocol: 'training-collector-v1', at: nowIso() });
        if (message.type === 'heartbeat') return send(ws, { type: 'heartbeat-ack', protocol: 'training-collector-v1', at: nowIso() });
        if (message.type === 'session-open') return await openSession(ws, message);
        if (message.type === 'event-batch') return await appendBatch(ws, message);
        if (message.type === 'session-close') return await closeSession(ws, message);
        send(ws, { type: 'error', error: 'unknown_message_type' });
      } catch (error) {
        console.error('[collector] message error', error);
        send(ws, { type: 'error', error: String(error?.message || error) });
      }
    });

    ws.on('close', () => {
      console.log('[collector] disconnected');
      for (const sessionId of ws.sessionIds) {
        const state = sessions.get(sessionId);
        if (!state) continue;
        state.connectedClients.delete(ws);
        scheduleDisconnectFinalize(state);
      }
    });
  });

  console.log(`[collector] listening ws://${HOST}:${PORT}/training-collector`);
  console.log(`[collector] data ${DATA_DIR}`);
  console.log(`[collector] disconnect finalize grace ${FINALIZE_GRACE_MS} ms`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
