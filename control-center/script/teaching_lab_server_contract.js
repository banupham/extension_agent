'use strict';

// Deprecated compatibility shim. The Teaching Lab now owns its self-test.
// Keep this file temporarily so existing local commands do not break while
// callers migrate to: node control-center/script/teaching_lab_server.js --self-test

const { spawnSync } = require('child_process');
const path = require('path');

const target = path.join(__dirname, 'teaching_lab_server.js');
const result = spawnSync(process.execPath, [target, '--self-test'], { stdio: 'inherit' });
process.exit(Number.isInteger(result.status) ? result.status : 1);
