'use strict';

const assert = require('assert');
require('../core/raw_session_store.js');

const Store = globalThis.TrainingCollectorV03.RawSessionStore;
assert(Store, 'RawSessionStore should be registered');
assert.strictEqual(Store.VERSION, '0.7.2');
assert.strictEqual(Store.CHUNK_SIZE, 1000);

const session = Store.createSession('browser-test', '2026-08-25T00:00:00.000Z');
assert.strictEqual(session.sessionId, 'browser-test');
assert.strictEqual(session.status, 'active');
assert.strictEqual(session.eventCount, 0);
assert.strictEqual(session.storageBackend, 'indexeddb');
assert.strictEqual(session.privacy.rawTextValuesStored, false);
assert.strictEqual(session.privacy.passwordValuesStored, false);
assert.strictEqual(session.privacy.cookiesStored, false);
assert.strictEqual(session.privacy.authorizationStored, false);
assert.strictEqual(session.rawModel.dom, 'compact-targetRef-events-with-first-seen-descriptors');
assert.ok(session.rawModel.hover.includes('dom-hover-enter-dwell-leave'));
assert.strictEqual(session.rawModel.mutation, '120ms-structural-mutation-bursts');
assert.strictEqual(session.rawModel.correlation, 'targetRef-at-capture-time-with-first-seen-descriptor');
assert.ok(session.rawModel.actionTargetResolution.includes('rawTargetRef'));
assert.ok(session.rawModel.actionTargetResolution.includes('resolvedTargetRef'));
assert.ok(session.rawModel.frames.includes('frameId'));
assert.ok(session.rawModel.frames.includes('documentId'));
assert.ok(session.rawModel.navigation.includes('route-change'));
assert.ok(session.rawModel.streamHealth.includes('collector-stream'));
assert.ok(session.rawModel.timeline.includes('pageSeq'));
assert.ok(session.rawModel.timeline.includes('sourceSeq'));
assert.ok(session.rawModel.timeline.includes('sessionSeq'));
assert.ok(session.rawModel.persistence.includes('indexeddb'));
assert.ok(session.rawModel.persistence.includes('batch-ack'));
assert.ok(session.rawModel.persistence.includes('localhost-websocket-replay-mirror'));
assert.ok(session.rawModel.socketMirror.includes('session-open-resume-event-batch-ack-replay'));
assert.strictEqual(session.rawModel.export, 'manual-chunked-jsonl-gzip-fallback-only');

assert.strictEqual(Store.sessionKey('abc'), 'tcRawSessionV03:abc');
assert.strictEqual(Store.chunkKey('abc', 2), 'tcRawChunkV03:abc:2');

const event = Store.normalizeEvent({ type: 'pointer', tsEpochMs: 123, pageSeq: 7, sourceSeq: 6, x: 1, y: 2, targetRef: 'e1' });
assert.strictEqual(event.rawVersion, '0.7.2');
assert.strictEqual(event.type, 'pointer');
assert.strictEqual(event.x, 1);
assert.strictEqual(event.targetRef, 'e1');
assert.strictEqual(event.pageSeq, 7);
assert.strictEqual(event.sourceSeq, 6);

console.log('Training Collector V0.8 runtime / raw schema 0.7.2 contract OK');
