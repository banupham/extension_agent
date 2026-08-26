'use strict';

const CONTRACT = require('../../AGENT_ACTION_CONTRACT.json');

const AGENT_ACTION_CONTRACT_VERSION = CONTRACT.contractVersion;
const ACTION_TYPES = new Set(Object.values(CONTRACT.actionFamilies).flat());
const TARGET_REQUIRED = new Set([
  'click', 'doubleClick', 'hover', 'moveTo', 'drag',
  'scrollIntoView', 'focus', 'replaceText', 'clear',
  'selectOption', 'setChecked', 'toggle', 'submit',
  'play', 'pause', 'mute', 'unmute', 'setVolume', 'seek',
  'changePlaybackRate', 'hoverAndObserve', 'dismiss'
]);
const EXECUTION_INTERNAL_FIELDS = [
  'surface',
  'executionSurface',
  'executionVariant',
  'mechanism',
  'controlLease',
  'hwnd'
];

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateAgentAction(action) {
  if (!isPlainObject(action)) throw new Error('agent action must be an object');
  const type = typeof action.type === 'string' ? action.type.trim() : '';
  if (!ACTION_TYPES.has(type)) throw new Error(`unsupported agent action: ${type || '<empty>'}`);
  const targetRef = typeof action.targetRef === 'string' && action.targetRef.trim() ? action.targetRef.trim() : null;
  if (TARGET_REQUIRED.has(type) && !targetRef) throw new Error(`${type} requires targetRef`);
  if (Object.prototype.hasOwnProperty.call(action, 'selector')) throw new Error('agent action must not use selector as primary targeting');
  if (Object.prototype.hasOwnProperty.call(action, 'x') || Object.prototype.hasOwnProperty.call(action, 'y')) {
    throw new Error('agent action must not emit raw coordinates');
  }
  if (Object.prototype.hasOwnProperty.call(action, 'cdpMethod')) throw new Error('agent action must not emit raw CDP methods');
  for (const field of EXECUTION_INTERNAL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(action, field)) {
      throw new Error(`agent action must not choose execution surface/variant: ${field}`);
    }
  }

  return {
    contractVersion: AGENT_ACTION_CONTRACT_VERSION,
    type,
    targetRef,
    args: isPlainObject(action.args) ? action.args : {},
    intent: typeof action.intent === 'string' ? action.intent : null,
    expectedOutcome: isPlainObject(action.expectedOutcome) ? action.expectedOutcome : {}
  };
}

function behaviorFamilyFor(type) {
  if (['click', 'doubleClick', 'toggle', 'submit', 'play', 'pause', 'mute', 'unmute', 'dismiss'].includes(type)) return 'pointer-click';
  if (['hover', 'hoverAndObserve', 'moveTo'].includes(type)) return 'pointer-hover';
  if (type === 'drag' || ['setVolume', 'seek'].includes(type)) return 'pointer-drag';
  if (type === 'scrollVertical') return 'scroll-vertical';
  if (type === 'scrollHorizontal') return 'scroll-horizontal';
  if (type === 'scrollIntoView') return 'scroll-target-acquisition';
  if (['typeText', 'replaceText', 'clear'].includes(type)) return 'keyboard-text';
  if (['pressKey', 'keyCombo'].includes(type)) return 'keyboard-key';
  if (type === 'focus') return 'focus-acquisition';
  if (['selectOption', 'setChecked'].includes(type)) return 'form-control';
  if (type === 'changePlaybackRate') return 'media-control';
  if (['waitAndObserve'].includes(type)) return 'observation-wait';
  if (['navigate', 'back', 'forward', 'reload', 'switchTab', 'openNewTab', 'closeTab'].includes(type)) return 'navigation';
  return 'generic';
}

function cdpPrimitiveFor(type) {
  const map = {
    navigate: ['Page.navigate'],
    back: ['Page.getNavigationHistory', 'Page.navigateToHistoryEntry'],
    forward: ['Page.getNavigationHistory', 'Page.navigateToHistoryEntry'],
    reload: ['Page.reload'],
    switchTab: ['chrome.tabs.update'],
    openNewTab: ['chrome.tabs.create'],
    closeTab: ['chrome.tabs.remove'],
    click: ['Input.dispatchMouseEvent'],
    doubleClick: ['Input.dispatchMouseEvent'],
    hover: ['Input.dispatchMouseEvent'],
    moveTo: ['Input.dispatchMouseEvent'],
    drag: ['Input.dispatchMouseEvent'],
    scrollVertical: ['Input.dispatchMouseEvent(mouseWheel)'],
    scrollHorizontal: ['Input.dispatchMouseEvent(mouseWheel)'],
    scrollIntoView: ['Input.dispatchMouseEvent(mouseWheel)'],
    focus: ['Runtime.callFunctionOn|DOM.focus'],
    typeText: ['Input.dispatchKeyEvent|Input.insertText'],
    replaceText: ['Input.dispatchMouseEvent|Input.dispatchKeyEvent|Input.insertText'],
    clear: ['Input.dispatchMouseEvent|Input.dispatchKeyEvent'],
    pressKey: ['Input.dispatchKeyEvent'],
    keyCombo: ['Input.dispatchKeyEvent'],
    selectOption: ['Runtime.callFunctionOn'],
    setChecked: ['Input.dispatchMouseEvent|Runtime.callFunctionOn'],
    toggle: ['Input.dispatchMouseEvent'],
    submit: ['Input.dispatchMouseEvent|Input.dispatchKeyEvent'],
    play: ['Input.dispatchMouseEvent'],
    pause: ['Input.dispatchMouseEvent'],
    mute: ['Input.dispatchMouseEvent'],
    unmute: ['Input.dispatchMouseEvent'],
    setVolume: ['Input.dispatchMouseEvent'],
    seek: ['Input.dispatchMouseEvent'],
    changePlaybackRate: ['Input.dispatchMouseEvent|Input.dispatchKeyEvent'],
    hoverAndObserve: ['Input.dispatchMouseEvent', 'Runtime.evaluate'],
    waitAndObserve: ['Runtime.evaluate'],
    dismiss: ['Input.dispatchMouseEvent|Input.dispatchKeyEvent']
  };
  return map[type] || [];
}

function mapAgentAction(action) {
  const normalized = validateAgentAction(action);
  return {
    ...normalized,
    behaviorFamily: behaviorFamilyFor(normalized.type),
    cdpPrimitives: cdpPrimitiveFor(normalized.type)
  };
}

module.exports = {
  AGENT_ACTION_CONTRACT_VERSION,
  ACTION_TYPES,
  validateAgentAction,
  behaviorFamilyFor,
  cdpPrimitiveFor,
  mapAgentAction
};