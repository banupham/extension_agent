'use strict';

const CONTRACT = require('../../EXECUTION_SURFACE_CONTRACT.json');
const { ACTION_TYPES } = require('./agent_action_contract');

const EXECUTION_SURFACE_CONTRACT_VERSION = CONTRACT.contractVersion;
const EXECUTION_SURFACES = Object.freeze({
  PAGE_CDP: 'page-cdp',
  BROWSER_NATIVE: 'browser-native'
});
const SURFACE_NAMES = new Set(Object.keys(CONTRACT.surfaces));
const BROWSER_NATIVE_DEFAULT_ACTIONS = new Set(CONTRACT.browserNativeDefaultActions || []);

function validateExecutionSurface(surface) {
  const normalized = typeof surface === 'string' ? surface.trim() : '';
  if (!SURFACE_NAMES.has(normalized)) {
    throw new Error(`unsupported execution surface: ${normalized || '<empty>'}`);
  }
  return normalized;
}

function selectExecutionSurface(actionType, context = {}) {
  const type = typeof actionType === 'string' ? actionType.trim() : '';
  if (!ACTION_TYPES.has(type)) throw new Error(`unsupported agent action: ${type || '<empty>'}`);

  if (context && context.browserUiRequired === true) {
    throw new Error('browser_ui_os_external_to_main_agent');
  }

  if (BROWSER_NATIVE_DEFAULT_ACTIONS.has(type)) {
    return EXECUTION_SURFACES.BROWSER_NATIVE;
  }

  return EXECUTION_SURFACES.PAGE_CDP;
}

function executionSurfaceRequirements(surface) {
  const normalized = validateExecutionSurface(surface);
  const definition = CONTRACT.surfaces[normalized] || {};
  return {
    contractVersion: EXECUTION_SURFACE_CONTRACT_VERSION,
    surface: normalized,
    scope: definition.scope || null,
    exclusiveDesktopInput: definition.exclusiveDesktopInput === true,
    consentRequired: definition.consentRequired === true,
    maxConcurrentDesktopInputOwners: Number.isInteger(definition.maxConcurrentDesktopInputOwners)
      ? definition.maxConcurrentDesktopInputOwners
      : null
  };
}

function buildBrowserUiControlLeaseRequest() {
  throw new Error('browser_ui_os_external_to_main_agent');
}

module.exports = {
  EXECUTION_SURFACE_CONTRACT_VERSION,
  EXECUTION_SURFACES,
  validateExecutionSurface,
  selectExecutionSurface,
  executionSurfaceRequirements,
  buildBrowserUiControlLeaseRequest
};
