'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'teaching_lab_server.js');
const src = fs.readFileSync(file, 'utf8');
const required = [
  '/teaching/delay-confirm-1500','/teaching/delay-next-3000','/teaching/delay-result-2000','/teaching/delay-save-ready','/teaching/delay-menu-load',
  '/teaching/replace-target','/teaching/button-renamed','/teaching/card-replaced','/teaching/stale-target','/teaching/re-render-list',
  '/teaching/ambiguous-identical','/teaching/ambiguous-context','/teaching/same-label-different-role','/teaching/same-label-disabled','/teaching/same-label-context-insufficient',
  '/teaching/moving-horizontal','/teaching/moving-vertical','/teaching/moving-with-distractor','/teaching/moving-then-stop','/teaching/moving-switch-position',
  '/teaching/no-effect-first-click','/teaching/effect-delayed','/teaching/retry-different-action','/teaching/menu-close-recover','/teaching/target-not-found-until-scroll'
];

assert(src.includes("const PORT = Number(process.env.TEACHING_LAB_PORT || 8791)"), 'Teaching Lab must default to port 8791');
for (const route of required) assert(src.includes(`'${route}'`), `missing Teaching Lab route: ${route}`);
assert.strictEqual(required.length, 25);
console.log('Teaching Lab server contract: PASS (25 routes on default port 8791)');
