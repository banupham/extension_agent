'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const idb = read('core/indexeddb_chunk_store.js');
const sender = read('core/reliable_sender.js');
const background = read('background.js');
const popup = read('popup.js');
const offscreen = read('offscreen.js');
const manifest = JSON.parse(read('manifest.json'));

assert.equal(manifest.version, '0.6.1');
assert.ok(manifest.name.includes('V0.6.1'));
assert.ok(manifest.permissions.includes('offscreen'));
assert.ok(manifest.permissions.includes('alarms'));
assert.ok(manifest.content_scripts[0].js.includes('core/reliable_sender.js'));

assert.ok(idb.includes("const DB_NAME = 'trainingCollectorRawV06'"));
assert.ok(idb.includes("const RECEIPT_STORE = 'batchReceipts'"));
assert.ok(idb.includes("keyPath: ['sessionId', 'batchId']"));
assert.ok(idb.includes('chunkIndex'));
assert.ok(idb.includes('checksumEvents'));
assert.ok(idb.includes('fnv1a32:'));
assert.ok(idb.includes('verifySession'));
assert.ok(idb.includes('sequence_gap_between_chunks'));

assert.ok(sender.includes("send('RAW_BATCH'"));
assert.ok(sender.includes('res?.ack'));
assert.ok(sender.includes('chrome.storage.session'));
assert.ok(sender.includes('retryMs'));

assert.ok(background.includes("importScripts('core/episode_builder.js', 'core/raw_session_store.js', 'core/indexeddb_chunk_store.js')"));
assert.ok(background.includes('ChunkStore.append'));
assert.ok(background.includes('GET_RAW_EXPORT_CHUNK'));
assert.ok(background.includes('VERIFY_RAW_SESSION'));
assert.ok(background.includes('batchId'));
assert.ok(background.includes('duplicate'));
assert.ok(background.includes('integrity'));
assert.ok(background.includes('AUTO_EXPORT_MAX_ATTEMPTS'));
assert.ok(background.includes("reasons: ['BLOBS']"));
assert.ok(background.includes('autoExportClosedSessions'));
assert.ok(background.includes("status: 'complete'"));
assert.ok(background.includes('temporaryDevelopmentAdapter'));

assert.ok(popup.includes("new CompressionStream('gzip')"));
assert.ok(popup.includes('GET_RAW_EXPORT_META'));
assert.ok(popup.includes('GET_RAW_EXPORT_CHUNK'));
assert.ok(popup.includes('.raw.jsonl.gz'));

assert.ok(offscreen.includes("new CompressionStream('gzip')"));
assert.ok(offscreen.includes('AUTO_EXPORT_SESSION'));
assert.ok(offscreen.includes('chrome.downloads.download'));
assert.ok(offscreen.includes('training-collector/'));
assert.ok(offscreen.includes('autoExport: true'));

console.log('Training Collector V0.6.1 storage reliability + temporary auto export contract OK');
