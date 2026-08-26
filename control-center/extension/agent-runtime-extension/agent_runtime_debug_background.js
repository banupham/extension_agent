'use strict';

importScripts('agent_cursor_mirror.js');

try {
  const status = AgentCursorMirror.install(chrome);
  if (!status.installed) console.warn('[agent-runtime] cursor mirror inactive:', status.installError || 'unknown');
} catch (error) {
  console.warn('[agent-runtime] cursor mirror install failed:', String(error?.message || error));
}

// Browser lifecycle actions are intentionally intercepted above the CDP executor.
// background.js imports tab_context.js before the broker client is created, so this
// middleware can resolve the active/internal tab only when a command actually arrives.
globalThis.AgentRuntimeBrokerCommandMiddleware = async (payload, next) => {
  if (payload?.action === 'agentExecuteBrowserAction') {
    if (!globalThis.AgentTabContext?.createTabContext) throw new Error('agent_tab_context_unavailable');
    const context = AgentTabContext.createTabContext(chrome);
    const requestedTabId = Number(payload?.tabId);
    const selectedTab = Number.isInteger(requestedTabId) && requestedTabId > 0
      ? { id: requestedTabId }
      : await context.activeTab();
    if (!selectedTab?.id) throw new Error('no_active_tab');
    const result = await context.executeBrowserAction({
      tabId: Number(selectedTab.id),
      action: payload?.data?.action || {}
    });
    return { ok: true, result };
  }

  const result = await next(payload);
  if (payload?.action === 'agentStatus' && result && typeof result === 'object') {
    const supported = Array.isArray(result.supportedActions) ? result.supportedActions : [];
    result.supportedActions = [...new Set([
      ...supported,
      'agentExecuteBrowserAction',
      'switchTab',
      'openNewTab',
      'closeTab'
    ])];
  }
  return result;
};

importScripts('background.js');
