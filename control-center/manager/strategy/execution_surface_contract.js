'use strict';

const CONTRACT = require('../../EXECUTION_SURFACE_CONTRACT.json');
const { ACTION_TYPES } = require('./agent_action_contract');

const EXECUTION_SURFACE_CONTRACT_VERSION = CONTRACT.contractVersion;
const EXECUTION_SURFACES = Object.freeze({
  PAGE_CDP: 'page-cdp',
  BROWSER_NATIVE: 'browser-native',
  BROWSER_UI_OS: 'browser-ui-os'
});
const SURFACE_NAMES = new Set(Object.keys(CONTRACT.surfaces));
const BROWSER_NATIVE_DEFAULT_ACTIONS = new Set(CONTRACT.browserNativeDefaultActions || []);
const BROWSER_UI_CHANNELS = new Set(CONTRACT.browserUiOsLease?.allowedInputChannels || []);

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

  // This flag is execution-manager context, never part of the Strategy Agent Action.
  if (context && context.browserUiRequired === true) {
    return EXECUTION_SURFACES.BROWSER_UI_OS;
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

function normalizeInputChannels(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('browser-ui-os control lease requires inputChannels');
  }
  const channels = [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))];
  if (channels.length === 0 || channels.some(channel => !BROWSER_UI_CHANNELS.has(channel))) {
    throw new Error('browser-ui-os control lease has unsupported inputChannels');
  }
  return channels;
}

function buildBrowserUiControlLeaseRequest(input = {}) {
  const targetWindow = typeof input.targetWindow === 'string' ? input.targetWindow.trim() : '';
  if (!targetWindow) throw new Error('browser-ui-os control lease requires targetWindow');

  const estimatedDurationMs = input.estimatedDurationMs == null
    ? null
    : Number(input.estimatedDurationMs);
  if (estimatedDurationMs != null && (!Number.isFinite(estimatedDurationMs) || estimatedDurationMs <= 0)) {
    throw new Error('browser-ui-os control lease estimatedDurationMs must be positive');
  }

  const channels = normalizeInputChannels(input.inputChannels);
  const requirements = executionSurfaceRequirements(EXECUTION_SURFACES.BROWSER_UI_OS);

  return {
    contractVersion: EXECUTION_SURFACE_CONTRACT_VERSION,
    surface: EXECUTION_SURFACES.BROWSER_UI_OS,
    scope: CONTRACT.browserUiOsLease.scope,
    exclusive: requirements.exclusiveDesktopInput,
    consentRequired: requirements.consentRequired,
    targetWindow,
    inputChannels: channels,
    estimatedDurationMs,
    status: 'consent-required'
  };
}

module.exports = {
  EXECUTION_SURFACE_CONTRACT_VERSION,
  EXECUTION_SURFACES,
  validateExecutionSurface,
  selectExecutionSurface,
  executionSurfaceRequirements,
  buildBrowserUiControlLeaseRequest
};
