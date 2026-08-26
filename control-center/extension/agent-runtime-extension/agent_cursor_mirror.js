'use strict';

(function initAgentCursorMirror(root) {
  const SCOPE = 'AGENT_CURSOR_DEBUG_V01';
  const POINTER_EVENT_TYPES = new Set(['mouseMoved', 'mousePressed', 'mouseReleased']);
  const state = { installed: false, installError: null, mirroredEvents: 0 };

  function publish(chromeApi, tabId, params = {}) {
    const type = String(params?.type || '');
    if (!POINTER_EVENT_TYPES.has(type)) return;
    const x = Number(params?.x), y = Number(params?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const event = { type, x, y, button: params?.button || 'none', clickCount: Number(params?.clickCount || 0), ts: Date.now() };
    state.mirroredEvents += 1;
    queueMicrotask(() => {
      try {
        const pending = chromeApi.tabs.sendMessage(Number(tabId), { scope: SCOPE, type: 'POINTER_EVENT', event });
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      } catch (_) {}
    });
  }

  function install(chromeApi) {
    if (state.installed) return { ...state };
    const debuggerApi = chromeApi?.debugger;
    const original = debuggerApi?.sendCommand;
    if (typeof original !== 'function') {
      state.installError = 'debugger_sendCommand_unavailable';
      return { ...state };
    }
    const bound = original.bind(debuggerApi);
    const wrapped = function agentCursorMirroredSendCommand(target, method, params = {}) {
      const result = bound(target, method, params);
      if (!result || typeof result.then !== 'function') {
        if (method === 'Input.dispatchMouseEvent' && target?.tabId) publish(chromeApi, target.tabId, params);
        return result;
      }
      return result.then(value => {
        if (method === 'Input.dispatchMouseEvent' && target?.tabId) publish(chromeApi, target.tabId, params);
        return value;
      });
    };
    try {
      debuggerApi.sendCommand = wrapped;
      if (debuggerApi.sendCommand !== wrapped) {
        state.installError = 'debugger_sendCommand_not_writable';
        return { ...state };
      }
      state.installed = true;
      state.installError = null;
    } catch (error) {
      state.installError = String(error?.message || error);
    }
    return { ...state };
  }

  root.AgentCursorMirror = { SCOPE, POINTER_EVENT_TYPES, install, publish, status: () => ({ ...state }) };
})(typeof globalThis !== 'undefined' ? globalThis : this);
