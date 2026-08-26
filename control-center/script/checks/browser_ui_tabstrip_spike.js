'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
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
assert.match(preflightText(switchRequest), /Window anchor tab title: UI TAB ALPHA/);
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
assert.match(decoded, /browser_ui_switch_tab_spike\.ps1/);
assert.match(decoded, /-AnchorTabTitle 'UI TAB ALPHA'/);
assert.match(decoded, /-TargetTabTitle 'UI TAB BETA'/);
assert.ok(!decoded.includes("-Action 'switchTab'"));
assert.ok(!decoded.includes('-TitleContains'));

const openDecoded = Buffer.from(powershellArgs(openRequest)[4], 'base64').toString('utf16le');
assert.match(openDecoded, /browser_ui_tabstrip_spike\.ps1/);
assert.match(openDecoded, /-Action 'openNewTab'/);
assert.match(openDecoded, /-TitleContains 'UI TAB BETA'/);
assert.ok(!openDecoded.includes('-TargetTabTitle'));

const psSource = fs.readFileSync(path.join(__dirname, '..', 'browser_ui_tabstrip_spike.ps1'), 'utf8');
assert.ok(psSource.includes("if (@('switchTab', 'closeTab') -contains $Action)"));
assert.ok(!psSource.includes("if (['switchTab', 'closeTab'] -contains $Action)"));

const switchPsSource = fs.readFileSync(path.join(__dirname, '..', 'browser_ui_switch_tab_spike.ps1'), 'utf8');
assert.match(switchPsSource, /FindVisibleBrowserWindows\(\)/);
assert.match(switchPsSource, /Resolve-BrowserWindowByTabAnchor/);
assert.match(switchPsSource, /windowResolution = 'Windows\.UIAutomation\.tab-anchor'/);
assert.ok(!switchPsSource.includes('FindVisibleBrowserWindowsContaining'));

const labSource = fs.readFileSync(path.join(__dirname, '..', 'page_cdp_test_lab.js'), 'utf8');
assert.match(labSource, /const browserUiTabCase = \['alpha', 'beta', 'disposable'\]\.includes\(tabCase\)/);
assert.match(labSource, /const preserveBrowserUiTabTitle = \$\{browserUiTabCase \? 'true' : 'false'\}/);
assert.match(labSource, /if \(!preserveBrowserUiTabTitle\) document\.title=text/);

console.log('Browser UI tab-strip spike contract: PASS');
