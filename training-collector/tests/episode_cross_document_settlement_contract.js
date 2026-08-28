'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

assert.strictEqual(manifest.version, '0.8.3');
assert(content.includes("send('EPISODE_DOCUMENT_READY'"), 'new top document must announce readiness for the active episode');
assert(content.includes('strategyObservation: strategyObservation('), 'document-ready settlement must send a sanitized Strategy observation');
assert(background.includes("if (message.type === 'EPISODE_DOCUMENT_READY')"), 'background must handle document readiness');
assert(background.includes("settlementReason: 'next_document_ready'"), 'cross-document pending transitions need explicit provenance');
assert(background.includes("startsWith(`${pageInstanceId}-`)"), 'the new document must not settle its own in-flight transitions');
assert(background.includes('sender.tab?.id !== state.episode.tabId'), 'settlement must remain scoped to the episode tab');

console.log('Episode cross-document settlement contract: PASS');
