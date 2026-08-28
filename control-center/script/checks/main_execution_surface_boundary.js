'use strict';

const assert = require('assert');
const {
  EXECUTION_SURFACE_CONTRACT_VERSION,
  EXECUTION_SURFACES,
  validateExecutionSurface,
  selectExecutionSurface,
  executionSurfaceRequirements,
  buildBrowserUiControlLeaseRequest
} = require('../../manager/strategy/execution_surface_contract.js');

assert.strictEqual(EXECUTION_SURFACE_CONTRACT_VERSION, '0.2.0');
assert.deepStrictEqual(EXECUTION_SURFACES, {
  PAGE_CDP: 'page-cdp',
  BROWSER_NATIVE: 'browser-native'
});

assert.strictEqual(validateExecutionSurface('page-cdp'), 'page-cdp');
assert.strictEqual(validateExecutionSurface('browser-native'), 'browser-native');
assert.throws(() => validateExecutionSurface('browser-ui-os'), /unsupported execution surface/);

assert.strictEqual(selectExecutionSurface('click'), 'page-cdp');
assert.strictEqual(selectExecutionSurface('typeText'), 'page-cdp');
assert.strictEqual(selectExecutionSurface('switchTab'), 'browser-native');
assert.strictEqual(selectExecutionSurface('openNewTab'), 'browser-native');
assert.strictEqual(selectExecutionSurface('closeTab'), 'browser-native');
assert.throws(
  () => selectExecutionSurface('click', { browserUiRequired: true }),
  /browser_ui_os_external_to_main_agent/
);
assert.throws(
  () => buildBrowserUiControlLeaseRequest({ targetWindow: 'x', inputChannels: ['pointer'] }),
  /browser_ui_os_external_to_main_agent/
);

const page = executionSurfaceRequirements('page-cdp');
assert.strictEqual(page.exclusiveDesktopInput, false);
assert.strictEqual(page.consentRequired, false);
const native = executionSurfaceRequirements('browser-native');
assert.strictEqual(native.exclusiveDesktopInput, false);
assert.strictEqual(native.consentRequired, false);

console.log('Main execution surface boundary: PASS');
