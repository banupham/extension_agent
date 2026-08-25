'use strict';

const assert = require('assert');
require('../core/raw_session_store.js');

const Store = globalThis.TrainingCollectorV03.RawSessionStore;
assert(Store, 'RawSessionStore should be registered');
assert.strictEqual(Store.VERSION, '0.3.0');
assert.strictEqual(Store.CHUNK_SIZE, 250);

const session = Store.createSession('browser-test', '2026-08-25T00:00:00.000Z');
assert.strictEqual(session.sessionId, 'browser-test');
assert.strictEqual(session.status, 'active');
assert.strictEqual(session.eventCount, 0);
assert.strictEqual(session.privacy.rawTextValuesStored, false);
assert.strictEqual(session.privacy.passwordValuesStored, false);
assert.strictEqual(session.privacy.cookiesStored, false);
assert.strictEqual(session.privacy.authorizationStored, false);

assert.strictEqual(Store.sessionKey('abc'), 'tcRawSessionV03:abc');
assert.strictEqual(Store.chunkKey('abc', 2), 'tcRawChunkV03:abc:2');

const event = Store.normalizeEvent({ type: 'pointer', tsEpochMs: 123, x: 1, y: 2 });
assert.strictEqual(event.rawVersion, '0.3.0');
assert.strictEqual(event.type, 'pointer');
assert.strictEqual(event.x, 1);

console.log('Training Collector V0.3 raw session contract OK');
