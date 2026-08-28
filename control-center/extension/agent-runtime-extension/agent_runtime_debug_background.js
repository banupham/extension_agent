'use strict';

importScripts('agent_cursor_mirror.js', 'follow_live_pointer.js');

try {
  const status = AgentCursorMirror.install(chrome);
  if (!status.installed) console.warn('[agent-runtime] cursor mirror inactive:', status.installError || 'unknown');
} catch (error) {
  console.warn('[agent-runtime] cursor mirror install failed:', String(error?.message || error));
}

try {
  const status = AgentFollowLivePointer.install(chrome);
  if (!status.installed) console.warn('[agent-runtime] follow-live pointer inactive:', status.installError || 'unknown');
} catch (error) {
  console.warn('[agent-runtime] follow-live pointer install failed:', String(error?.message || error));
}

async function resolveSelectedTab(payload) {
  if (!globalThis.AgentTabContext?.createTabContext) throw new Error('agent_tab_context_unavailable');
  const context = AgentTabContext.createTabContext(chrome);
  const requestedTabId = Number(payload?.tabId);
  const selectedTab = Number.isInteger(requestedTabId) && requestedTabId > 0
    ? { id: requestedTabId }
    : await context.activeTab();
  if (!selectedTab?.id) throw new Error('no_active_tab');
  return { context, selectedTab };
}

// Browser lifecycle actions and experimental follow-live target tracking are
// intentionally intercepted above the ordinary PAGE_CDP executor. The semantic
// Agent Action remains unchanged; these branches select HOW the action executes.
globalThis.AgentRuntimeBrokerCommandMiddleware = async (payload, next) => {
  if (payload?.action === 'agentExecutePlan' && payload?.data?.plan?.targetTracking === 'follow-live') {
    const plan = payload.data.plan;
    if (!plan.trackingTarget || typeof plan.trackingTarget !== 'object') {
      throw new Error('follow_live_tracking_target_required');
    }
    if (String(plan.trackingTarget.ref || '') !== String(plan.targetRef || '')) {
      throw new Error('follow_live_tracking_target_ref_mismatch');
    }
    const { selectedTab } = await resolveSelectedTab(payload);
    const tabId = Number(selectedTab.id);
    AgentFollowLivePointer.begin(tabId, plan.trackingTarget);
    let ended = false;
    try {
      const result = await next(payload);
      const tracking = AgentFollowLivePointer.end(tabId);
      ended = true;
      if (result?.result && typeof result.result === 'object') {
        result.result.followLiveTracking = tracking;
      } else if (result && typeof result === 'object') {
        result.followLiveTracking = tracking;
      }
      return result;
    } finally {
      if (!ended) AgentFollowLivePointer.end(tabId);
    }
  }

  if (payload?.action === 'agentExecuteBrowserAction') {
    const { context, selectedTab } = await resolveSelectedTab(payload);
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
