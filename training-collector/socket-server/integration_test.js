'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocket } = require('ws');

const SERVER = path.join(__dirname, 'server.js');
const PORT = 20000 + (process.pid % 20000);
const ENDPOINT = `ws://127.0.0.1:${PORT}/training-collector`;
const SESSION_ID = `integration-${process.pid}`;
const PROTOCOL = 'training-collector-v1';

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function startServer(dataDir) {
  const child = spawn(process.execPath, [SERVER], {
    cwd: __dirname,
    env: {
      ...process.env,
      TC_SOCKET_HOST: '127.0.0.1',
      TC_SOCKET_PORT: String(PORT),
      TC_SOCKET_DATA_DIR: dataDir,
      TC_SOCKET_FINALIZE_GRACE_MS: '5000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += String(chunk); });
  child.stderr.on('data', chunk => { stderr += String(chunk); });

  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`server_start_timeout\nstdout=${stdout}\nstderr=${stderr}`)), 8000);
    const check = () => {
      if (stdout.includes('[collector] listening')) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout.on('data', check);
    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`server_exited_early:${code}\nstdout=${stdout}\nstderr=${stderr}`));
    });
  });

  return { child, ready, logs: () => ({ stdout, stderr }) };
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode != null) return;
  server.child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => server.child.once('exit', resolve)),
    delay(2000).then(() => { try { server.child.kill('SIGKILL'); } catch {} })
  ]);
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(ENDPOINT);
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      reject(new Error('client_connect_timeout'));
    }, 5000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function send(ws, payload) {
  ws.send(JSON.stringify({ protocol: PROTOCOL, ...payload }));
}

function waitFor(ws, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('message_timeout'));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      ws.off('message', onMessage);
    }
    function onMessage(raw) {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    }
    ws.on('message', onMessage);
  });
}

async function roundTrip(ws, payload, predicate) {
  const waiting = waitFor(ws, predicate);
  send(ws, payload);
  return waiting;
}

function event(seq, type = 'pointer') {
  return {
    rawVersion: '0.7.2',
    sessionSeq: seq,
    type,
    captureSource: 'integration-test',
    tsEpochMs: 1000 + seq,
    pageInstanceId: 'p-test',
    pageSeq: seq,
    sourceSeq: seq
  };
}

async function openSession(ws, eventCount) {
  return roundTrip(ws, {
    type: 'session-open',
    session: {
      schemaVersion: '0.7.2',
      sessionId: SESSION_ID,
      status: 'active',
      startedAt: '2026-08-25T00:00:00.000Z',
      endedAt: null,
      lastSeenAt: '2026-08-25T00:00:01.000Z',
      eventCount,
      chunkCount: 1,
      storageBackend: 'indexeddb'
    }
  }, message => message.type === 'session-ack' && message.sessionId === SESSION_ID);
}

async function main() {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tc-socket-test-'));
  let server = null;
  let ws = null;
  try {
    server = startServer(dataDir);
    await server.ready;
    ws = await connect();

    let ack = await openSession(ws, 3);
    assert.strictEqual(ack.resumeFromSeq, 0);

    ack = await roundTrip(ws, {
      type: 'event-batch', sessionId: SESSION_ID, firstSeq: 1, lastSeq: 2,
      events: [event(1), event(2, 'dom-click')]
    }, message => message.type === 'batch-ack' && message.sessionId === SESSION_ID);
    assert.strictEqual(ack.lastSeq, 2);
    assert.strictEqual(ack.appended, 2);

    ack = await roundTrip(ws, {
      type: 'event-batch', sessionId: SESSION_ID, firstSeq: 1, lastSeq: 2,
      events: [event(1), event(2, 'dom-click')]
    }, message => message.type === 'batch-ack' && message.sessionId === SESSION_ID);
    assert.strictEqual(ack.lastSeq, 2);
    assert.strictEqual(ack.appended, 0);

    const resync = await roundTrip(ws, {
      type: 'event-batch', sessionId: SESSION_ID, firstSeq: 4, lastSeq: 4,
      events: [event(4)]
    }, message => message.type === 'resync' && message.sessionId === SESSION_ID);
    assert.strictEqual(resync.resumeFromSeq, 2);
    assert.strictEqual(resync.expectedSeq, 3);
    assert.strictEqual(resync.receivedSeq, 4);

    ack = await roundTrip(ws, {
      type: 'event-batch', sessionId: SESSION_ID, firstSeq: 3, lastSeq: 3,
      events: [event(3, 'collector-stream-health')]
    }, message => message.type === 'batch-ack' && message.sessionId === SESSION_ID);
    assert.strictEqual(ack.lastSeq, 3);
    assert.strictEqual(ack.appended, 1);

    const closed = await roundTrip(ws, {
      type: 'session-close', sessionId: SESSION_ID, expectedLastSeq: 3,
      endedAt: '2026-08-25T00:01:00.000Z', reason: 'integration_test_close'
    }, message => message.type === 'session-closed' && message.sessionId === SESSION_ID);
    assert.strictEqual(closed.lastSeq, 3);

    ws.close();
    await delay(100);
    await stopServer(server);
    server = null;
    ws = null;

    const rawFile = path.join(dataDir, `${SESSION_ID}.raw.jsonl`);
    const metaFile = path.join(dataDir, `${SESSION_ID}.meta.json`);
    const records = (await fsp.readFile(rawFile, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
    const events = records.filter(record => record.recordType === 'event');
    assert.deepStrictEqual(events.map(item => item.sessionSeq), [1, 2, 3]);
    assert.strictEqual(records.filter(record => record.recordType === 'session').length, 1);
    assert.strictEqual(records.filter(record => record.recordType === 'session-end').length, 1);

    let meta = JSON.parse(await fsp.readFile(metaFile, 'utf8'));
    assert.strictEqual(meta.status, 'closed');
    assert.strictEqual(meta.lastSeq, 3);
    assert.strictEqual(meta.eventCount, 3);

    // Restart server against the same archive. It must scan/recover lastSeq and resume.
    server = startServer(dataDir);
    await server.ready;
    ws = await connect();
    ack = await openSession(ws, 4);
    assert.strictEqual(ack.resumeFromSeq, 3);

    ack = await roundTrip(ws, {
      type: 'event-batch', sessionId: SESSION_ID, firstSeq: 4, lastSeq: 4,
      events: [event(4, 'route-change')]
    }, message => message.type === 'batch-ack' && message.sessionId === SESSION_ID);
    assert.strictEqual(ack.lastSeq, 4);
    assert.strictEqual(ack.appended, 1);

    await roundTrip(ws, {
      type: 'session-close', sessionId: SESSION_ID, expectedLastSeq: 4,
      endedAt: '2026-08-25T00:02:00.000Z', reason: 'integration_test_restart_close'
    }, message => message.type === 'session-closed' && message.sessionId === SESSION_ID);

    meta = JSON.parse(await fsp.readFile(metaFile, 'utf8'));
    assert.strictEqual(meta.status, 'closed');
    assert.strictEqual(meta.lastSeq, 4);
    assert.strictEqual(meta.eventCount, 4);

    const finalRecords = (await fsp.readFile(rawFile, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
    assert.deepStrictEqual(finalRecords.filter(record => record.recordType === 'event').map(item => item.sessionSeq), [1, 2, 3, 4]);
    assert.ok(finalRecords.some(record => record.recordType === 'session-resume'));

    console.log('Training Collector V0.8 socket server integration test OK');
  } finally {
    try { ws?.close(); } catch {}
    await stopServer(server);
    await fsp.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
