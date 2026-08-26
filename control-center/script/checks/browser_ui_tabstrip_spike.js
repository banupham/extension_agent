'use strict';

const assert = require('assert');
const {
  parseArgs,
  validateRequest,
  preflightText,
  powershellArgs
} = require('../browser_ui_tabstrip_spike.js');

const parsed = parseArgs([
  '--action', 'switchTab',
  '--title', 'UI TAB ALPHA',
  '--tab-title', 'UI TAB BETA'
]);
assert.strictEqual(parsed.action, 'switchTab');
assert.strictEqual(parsed.title, 'UI TAB ALPHA');
assert.strictEqual(parsed['tab-title'], 'UI TAB BETA');

const switchRequest = validateRequest(parsed);
assert.deepStrictEqual(switchRequest, {
  action: 'switchTab',
  title: 'UI TAB ALPHA',
  targetTabTitle: 'UI TAB BETA'
});
assert.match(preflightText(switchRequest), /real Windows mouse/i);
assert.match(preflightText(switchRequest), /UI TAB BETA/);

const closeRequest = validateRequest({
  action: 'closeTab',
  title: 'UI TAB BETA',
  'tab-title': 'UI TAB DISPOSABLE'
});
assert.strictEqual(closeRequest.targetTabTitle, 'UI TAB DISPOSABLE');

const openRequest = validateRequest({ action: 'openNewTab', title: 'UI TAB BETA' });
assert.strictEqual(openRequest.targetTabTitle, '');

assert.throws(() => validateRequest({ action: 'switchTab', title: 'UI TAB ALPHA' }), /--tab-title/);
assert.throws(() => validateRequest({ action: 'closeTab', title: 'UI TAB BETA' }), /--tab-title/);
assert.throws(() => validateRequest({ action: 'openNewTab' }), /--title/);
assert.throws(() => validateRequest({ action: 'back', title: 'UI TAB ALPHA' }), /switchTab_openNewTab_or_closeTab/);

const psArgs = powershellArgs(switchRequest);
assert.deepStrictEqual(psArgs.slice(0, 3), ['-NoProfile', '-ExecutionPolicy', 'Bypass']);
assert.strictEqual(psArgs[3], '-EncodedCommand');
const decoded = Buffer.from(psArgs[4], 'base64').toString('utf16le');
assert.match(decoded, /browser_ui_tabstrip_spike\.ps1/);
assert.match(decoded, /-Action 'switchTab'/);
assert.match(decoded, /-TitleContains 'UI TAB ALPHA'/);
assert.match(decoded, /-TargetTabTitle 'UI TAB BETA'/);

const openDecoded = Buffer.from(powershellArgs(openRequest)[4], 'base64').toString('utf16le');
assert.match(openDecoded, /-Action 'openNewTab'/);
assert.ok(!openDecoded.includes('-TargetTabTitle'));

console.log('Browser UI tab-strip spike contract: PASS');
