'use strict';

const assert = require('assert');
const { SCENARIOS, DEFAULT_PORT } = require('./teaching_lab_server.js');

assert.strictEqual(DEFAULT_PORT, 8791, 'Teaching Lab default port must remain isolated from Control Center');
assert.ok(SCENARIOS && typeof SCENARIOS === 'object', 'Teaching Lab must expose SCENARIOS');
assert.strictEqual(Object.keys(SCENARIOS).length, 5, 'Teaching Lab must stay compact: exactly five core scenarios');
assert.deepStrictEqual(Object.keys(SCENARIOS), ['TL01', 'TL02', 'TL03', 'TL04', 'TL05']);

const kinds = Object.values(SCENARIOS).map(item => item.kind);
assert.deepStrictEqual(kinds, ['delay', 'replace', 'ambiguity', 'moving', 'recovery']);

console.log(`Teaching Lab server contract: PASS (${Object.keys(SCENARIOS).length} structured core scenarios on port ${DEFAULT_PORT})`);
