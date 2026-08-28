'use strict';

const assert = require('assert');
const path = require('path');

const lab = require(path.join(__dirname, 'teaching_lab_server.js'));
const ids = Object.keys(lab.SCENARIOS);
const families = ids.map(id => lab.SCENARIOS[id].family);

assert.strictEqual(lab.PORT, 8791, 'Teaching Lab must default to port 8791');
assert.deepStrictEqual(ids, ['TL01', 'TL02', 'TL03', 'TL04', 'TL05']);
assert.deepStrictEqual(families, ['DELAY', 'REPLACE', 'AMBIGUITY', 'MOVING', 'RECOVERY']);
assert.strictEqual(new Set(families).size, 5, 'each core scenario must teach a distinct capability');

for (const id of ids) {
  const scenario = lab.SCENARIOS[id];
  assert(scenario.task && scenario.expected && scenario.type, `${id} must be a complete data-driven scenario`);
  const html = lab.renderScenario(id, scenario);
  assert(html.includes(`${id} | ${scenario.task}`), `${id} page must expose the exact Task Episode instruction`);
}

console.log('Teaching Lab server contract: PASS (5 structured core scenarios on port 8791)');
