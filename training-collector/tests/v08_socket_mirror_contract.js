'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const manifest = JSON.parse(read('manifest.json'));
const background = read('background.js');
const mirror = read('core/socket_mirror.js');
const rawStore = read('core/raw_session_store.js');
const popup = read('popup.js');
const popupHtml = read('popup.html');
const server = read('socket-server/server.js');
const serverPkg = JSON.parse(read('socket-server/package.json'));

assert.strictEqual(manifest.version, '0.8.2');
assert.strictEqual(manifest.minimum_chrome_version, '116');
assert.ok(manifest.name.includes('V0.8 Socket Mirror'));
assert.ok(!manifest.host_permissions.some(pattern => /^wss?:/i.test(pattern)));
assert.ok(!manifest.permissions.includes('offscreen'));
assert.ok(!manifest.permissions.includes('downloads'));
assert.ok(!manifest.permissions.includes('alarms'));
assert.strictEqual(manifest.content_scripts[0].all_frames, true);

assert.ok(background.includes("'core/socket_mirror.js'"));
assert.ok(background.includes("const SOCKET_ENDPOINT = 'ws://127.0.0.1:8765/training-collector'"));
assert.ok(background.includes('ChunkStore.append(candidate, normalizedEvents, batchId)'));
assert.ok(background.includes('SocketMirror?.publish?.(persistedSession, normalizedEvents)'));
assert.ok(background.indexOf('ChunkStore.append(candidate, normalizedEvents, batchId)') < background.indexOf('SocketMirror?.publish?.(persistedSession, normalizedEvents)'));
assert.ok(mirror.includes("message?.type === 'session-closed'"), 'server-confirmed closed sessions must be handled');
assert.ok(mirror.includes('acknowledgedThrough < expectedThrough'), 'closed session cleanup must require full server acknowledgement');
assert.ok(mirror.includes('sessions.delete(sessionId)'), 'fully acknowledged closed sessions must leave the waiting/status queue');
assert.ok(background.includes('replaySession'));
assert.ok(background.includes('getChunkRecord'));
assert.ok(background.includes('registerClosedBacklog'));
assert.ok(background.includes('GET_SOCKET_STATUS'));
assert.ok(!background.includes('AUTO_EXPORT_SCOPE'));

assert.ok(mirror.includes('training-collector-v1'));
assert.ok(mirror.includes("type: 'session-open'"));
assert.ok(mirror.includes("type: 'event-batch'"));
assert.ok(mirror.includes("type: 'session-close'"));
assert.ok(mirror.includes("message?.type === 'session-ack'"));
assert.ok(mirror.includes("message?.type === 'batch-ack'"));
assert.ok(mirror.includes("message?.type === 'resync'"));
assert.ok(mirror.includes('heartbeatMs'));
assert.ok(mirror.includes('replaySession'));
assert.ok(mirror.includes('ackedThrough'));
assert.ok(mirror.includes('const existed = sessions.has(session.sessionId)'));

assert.strictEqual(serverPkg.dependencies.ws, '^8.18.0');
assert.ok(server.includes("const HOST = process.env.TC_SOCKET_HOST || '127.0.0.1'"));
assert.ok(server.includes("path: '/training-collector'"));
assert.ok(server.includes('FINALIZE_GRACE_MS'));
assert.ok(server.includes('scanRawState'));
assert.ok(server.includes("recordType: 'event'"));
assert.ok(server.includes("type: 'resync'"));
assert.ok(server.includes("type: 'batch-ack'"));
assert.ok(server.includes("recordType: 'session-end'"));
assert.ok(server.includes('seq <= cursor'));
assert.ok(server.includes('seq !== cursor + 1'));

assert.ok(rawStore.includes("const VERSION = '0.7.2'"));
assert.ok(rawStore.includes('localhost-websocket-replay-mirror'));
assert.ok(rawStore.includes('manual-chunked-jsonl-gzip-fallback-only'));
assert.ok(popup.includes('GET_SOCKET_STATUS'));
assert.ok(popupHtml.includes('Training Collector V0.8.2 Socket Mirror'), 'popup version label must match the manifest version');
assert.ok(!popup.includes('RETRY_AUTO_EXPORT'));

console.log('Training Collector V0.8.2 socket mirror inheritance contract OK');
