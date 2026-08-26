'use strict';

importScripts('target_registry.js', 'cdp_plan_dispatcher.js', 'broker_client.js', 'tab_context.js');

const SCOPE = 'AGENT_RUNTIME_V02';
const LEGACY_SCOPE = 'AGENT_RUNTIME_V01';
const DEBUGGER_VERSION = '1.3';
const TARGET_TTL_MS = 4000;
const TARGET_GEOMETRY_TOLERANCE_PX = 2;
const attachedTabs = new Set();
const pointerByTab = new Map();
const registry = AgentTargetRegistry.createRegistry({ ttlMs: TARGET_TTL_MS });
const tabContext = AgentTabContext.createTabContext(chrome);
let observationCounter = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0))));
const activeTab = () => tabContext.activeTab();

async function attach(tabId) {
  if (attachedTabs.has(tabId)) return { attached: true, tabId };
  await chrome.debugger.attach({ tabId }, DEBUGGER_VERSION);
  attachedTabs.add(tabId);
  return { attached: true, tabId };
}

async function detach(tabId) {
  if (!attachedTabs.has(tabId)) return { attached: false, tabId };
  await chrome.debugger.detach({ tabId }).catch(() => {});
  attachedTabs.delete(tabId);
  registry.invalidateTab(tabId);
  pointerByTab.delete(tabId);
  return { attached: false, tabId };
}

async function command(tabId, method, params = {}) {
  await attach(tabId);
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

function nextObservationId(tabId) {
  observationCounter += 1;
  return `obs-${tabId}-${Date.now()}-${observationCounter}`;
}

async function currentUrl(tabId) {
  const result = await command(tabId, 'Runtime.evaluate', {
    expression: 'location.href',
    returnByValue: true
  });
  return result?.result?.value || null;
}

async function observe(tabId) {
  const expression = `(() => {
    const visible = el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    };
    const safeSelector = el => {
      if (el.id) return '#' + CSS.escape(el.id);
      const testid = el.getAttribute('data-testid');
      if (testid) return '[data-testid="' + CSS.escape(testid) + '"]';
      const name = el.getAttribute('name');
      if (name) return el.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]';
      return null;
    };
    const label = el => {
      const raw = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.innerText || '';
      return String(raw).replace(/\\s+/g, ' ').trim().slice(0, 160);
    };
    const selector = 'a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex]';
    const nodes = [...document.querySelectorAll(selector)].filter(visible).slice(0, 500);
    const active = document.activeElement;
    let focusedRef = null;
    const interactiveElements = nodes.map((el, i) => {
      const r = el.getBoundingClientRect();
      const tag = el.tagName.toLowerCase();
      const ref = 'e' + i;
      if (el === active) focusedRef = ref;
      return {
        ref,
        tag,
        role: el.getAttribute('role') || null,
        label: label(el),
        editable: el.isContentEditable || ['input','textarea','select'].includes(tag),
        enabled: !el.matches(':disabled'),
        visible: true,
        selector: safeSelector(el),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height }
      };
    });
    return {
      schemaVersion: '0.2.0',
      url: location.href,
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      scroll: { x: scrollX, y: scrollY },
      focusedRef,
      interactiveElements
    };
  })()`;
  const result = await command(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  const raw = result?.result?.value || null;
  if (!raw) return null;

  const observationId = nextObservationId(tabId);
  const registered = registry.register({ observationId, tabId, url: raw.url, frameId: 0, targets: raw.interactiveElements || [] });
  return {
    schemaVersion: '0.2.0',
    observationId,
    capturedAt: Date.now(),
    expiresAt: registered.expiresAt,
    tabId: Number(tabId),
    url: raw.url,
    title: raw.title,
    viewport: raw.viewport,
    scroll: raw.scroll,
    focusedRef: raw.focusedRef || null,
    agentPointer: pointerByTab.get(tabId) || null,
    interactiveElements: registered.targets
  };
}

async function observeScopedTabs(scope = { mode: 'visible' }) {
  const tabs = await tabContext.select(scope);
  const maxTabs = Math.min(12, Math.max(1, Number(scope?.maxTabs || 8)));
  const selected = tabs.slice(0, maxTabs);
  const observations = [];
  for (const tab of selected) {
    try {
      const observation = await observe(tab.id);
      observations.push({ ok: true, tab: AgentTabContext.publicTab(tab), observation });
    } catch (error) {
      observations.push({ ok: false, tab: AgentTabContext.publicTab(tab), error: String(error?.message || error) });
    }
  }
  return observations;
}

async function resolveTarget(tabId, action) {
  const url = await currentUrl(tabId);
  return registry.resolve({ tabId, observationId: action?.observationId, targetRef: action?.targetRef, currentUrl: url });
}

function semanticText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function readLiveTarget(tabId, target) {
  const interactiveSelector = 'a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex]';
  const locator = target?.selector
    ? `document.querySelector(${JSON.stringify(target.selector)})`
    : `document.elementFromPoint(${Number(target?.rect?.centerX)}, ${Number(target?.rect?.centerY)})`;
  const climbToInteractive = target?.selector
    ? ''
    : `if (el && !el.matches(interactive)) el = el.closest(interactive);`;
  const expression = `(() => {
    const interactive = ${JSON.stringify(interactiveSelector)};
    const label = el => {
      const raw = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.innerText || '';
      return String(raw).replace(/\\s+/g, ' ').trim().slice(0, 160);
    };
    let el = ${locator};
    ${climbToInteractive}
    if (!el) return { ok:false, reason:'missing' };
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const visible = r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    return {
      ok:true,
      tag:el.tagName.toLowerCase(),
      role:el.getAttribute('role') || null,
      label:label(el),
      enabled:!el.matches(':disabled'),
      visible,
      rect:{ x:r.x, y:r.y, width:r.width, height:r.height }
    };
  })()`;
  const result = await command(tabId, 'Runtime.evaluate', { expression, returnByValue: true });
  return result?.result?.value || null;
}

async function assertTargetGeometryCurrent(tabId, target) {
  const live = await readLiveTarget(tabId, target);
  if (!live?.ok || !live.visible || !live.enabled || !live.rect) {
    throw new Error(`target_geometry_unavailable:${live?.reason || 'not_interactable'}`);
  }
  if (!target?.selector) {
    const identityChanged =
      semanticText(live.tag) !== semanticText(target?.tag) ||
      semanticText(live.role) !== semanticText(target?.role) ||
      semanticText(live.label) !== semanticText(target?.label);
    if (identityChanged) throw new Error('target_geometry_changed');
  }
  if (AgentTargetRegistry.geometryChanged(target?.rect, live.rect, TARGET_GEOMETRY_TOLERANCE_PX)) {
    throw new Error('target_geometry_changed');
  }
  return live;
}

async function guardTargetGeometry(tabId, target) {
  try {
    return await assertTargetGeometryCurrent(tabId, target);
  } catch (error) {
    registry.invalidateTab(tabId);
    throw error;
  }
}

async function movePointer(tabId, x, y) {
  await command(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  pointerByTab.set(tabId, { x, y, ts: Date.now() });
}

async function targetPointer(tabId, action) {
  const target = await resolveTarget(tabId, action);
  await guardTargetGeometry(tabId, target);
  const x = target.rect.centerX, y = target.rect.centerY;
  await movePointer(tabId, x, y);
  return { target, x, y };
}

async function clickTarget(tabId, action, clickCount = 1) {
  const { target, x, y } = await targetPointer(tabId, action);
  const holdMs = Math.min(1200, Math.max(0, Number(action?.behavior?.pointer?.holdMs ?? action?.holdMs ?? 60)));
  const dwellMs = Math.min(1500, Math.max(0, Number(action?.behavior?.pointer?.dwellBeforeDownMs ?? action?.dwellBeforeDownMs ?? 0)));
  if (dwellMs) await sleep(dwellMs);
  await guardTargetGeometry(tabId, target);
  await command(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount });
  if (holdMs) await sleep(holdMs);
  await command(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount });
  registry.invalidateTab(tabId);
  return { ok: true, targetRef: target.ref, observationInvalidated: true };
}

async function navigateHistory(tabId, direction) {
  const history = await command(tabId, 'Page.getNavigationHistory');
  const entries = history?.entries || [];
  const currentIndex = Number(history?.currentIndex ?? -1);
  const targetIndex = direction === 'back' ? currentIndex - 1 : currentIndex + 1;
  const entry = entries[targetIndex];
  if (!entry?.id) throw new Error(`history_${direction}_unavailable`);
  registry.invalidateTab(tabId);
  return command(tabId, 'Page.navigateToHistoryEntry', { entryId: entry.id });
}

function planRequiresTarget(plan) {
  return ['click', 'doubleClick', 'hover', 'moveTo', 'scrollIntoView', 'focus', 'drag', 'toggle', 'dismiss', 'play', 'pause', 'mute', 'unmute', 'setVolume', 'seek'].includes(plan?.actionType);
}

async function executeCdpPlan(tabId, plan, observationId = null) {
  const normalized = AgentCdpPlanDispatcher.validatePlan(plan);
  let guardedTarget = null;
  if (planRequiresTarget(normalized)) {
    const url = await currentUrl(tabId);
    guardedTarget = registry.resolve({ tabId, observationId, targetRef: normalized.targetRef, currentUrl: url });
    await guardTargetGeometry(tabId, guardedTarget);
  }
  const result = await AgentCdpPlanDispatcher.dispatchPlan(
    normalized,
    async (method, params) => {
      if (guardedTarget && method === 'Input.dispatchMouseEvent' && params?.type === 'mousePressed') {
        await guardTargetGeometry(tabId, guardedTarget);
      }
      const value = await command(tabId, method, params);
      if (method === 'Input.dispatchMouseEvent' && params?.type === 'mouseMoved') {
        pointerByTab.set(tabId, { x: Number(params.x), y: Number(params.y), ts: Date.now() });
      }
      return value;
    },
    sleep
  );
  registry.invalidateTab(tabId);
  return { ...result, observationInvalidated: true };
}

async function executeNormalizedAction(tabId, action) {
  if (!action || typeof action.action !== 'string') throw new Error('invalid_action');
  switch (action.action) {
    case 'openUrl':
      if (!action.url) throw new Error('openUrl requires url');
      registry.invalidateTab(tabId);
      return command(tabId, 'Page.navigate', { url: action.url });
    case 'reload':
      registry.invalidateTab(tabId);
      return command(tabId, 'Page.reload', { ignoreCache: false });
    case 'back': return navigateHistory(tabId, 'back');
    case 'forward': return navigateHistory(tabId, 'forward');
    case 'pressKey': {
      const key = String(action.key || '');
      if (!key) throw new Error('pressKey requires key');
      await command(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key });
      await command(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key });
      return { ok: true };
    }
    case 'type':
    case 'typeText':
      await command(tabId, 'Input.insertText', { text: String(action.text || '') });
      return { ok: true };
    case 'moveTo':
    case 'hover': {
      const { target } = await targetPointer(tabId, action);
      return { ok: true, targetRef: target.ref };
    }
    case 'click': return clickTarget(tabId, action, 1);
    case 'doubleClick': return clickTarget(tabId, action, 2);
    case 'focus': {
      const target = await resolveTarget(tabId, action);
      await guardTargetGeometry(tabId, target);
      if (target.selector) {
        const selector = JSON.stringify(target.selector);
        const result = await command(tabId, 'Runtime.evaluate', {
          expression: `(() => { const el = document.querySelector(${selector}); if (!el) return false; el.focus(); return document.activeElement === el; })()`,
          returnByValue: true
        });
        if (result?.result?.value) return { ok: true, targetRef: target.ref };
      }
      await targetPointer(tabId, action);
      await clickTarget(tabId, action, 1);
      return { ok: true, targetRef: target.ref, fallback: 'click-focus' };
    }
    case 'scrollVertical':
    case 'scrollHorizontal': {
      const point = pointerByTab.get(tabId) || { x: 400, y: 300 };
      const amount = Number(action.delta ?? action.amount ?? 480);
      const horizontal = action.action === 'scrollHorizontal';
      await command(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: point.x, y: point.y,
        deltaX: horizontal ? amount : 0, deltaY: horizontal ? 0 : amount
      });
      return { ok: true, axis: horizontal ? 'horizontal' : 'vertical', delta: amount };
    }
    default: throw new Error(`unsupported_action_v02:${action.action}`);
  }
}

async function runtimeStatus(tabId) {
  return {
    ok: true,
    runtimeVersion: '0.2.1',
    architecture: 'task -> browser-context -> observer -> strategy -> behavior -> cdp-plan -> executor',
    attached: attachedTabs.has(tabId),
    tabId,
    targetRegistry: registry.status(tabId),
    tabContext: { version: '0.1.0', explicitTabPreferred: true, activeFallback: true },
    planExecution: { version: '0.1.0', allowlistedOnly: true, liveGeometryGuard: true },
    supportedActions: [
      'agentListTabs', 'agentObserveTabs', 'agentObserve', 'agentExecutePlan', 'agentStatus',
      'openUrl', 'reload', 'back', 'forward',
      'pressKey', 'typeText', 'moveTo', 'hover', 'click', 'doubleClick', 'focus',
      'scrollVertical', 'scrollHorizontal'
    ]
  };
}

async function brokerIdentity() {
  const stored = await chrome.storage.local.get(['agentRuntimeAgentId', 'agentRuntimeLabel']);
  let agentId = stored.agentRuntimeAgentId;
  if (!agentId) {
    agentId = globalThis.crypto?.randomUUID ? `runtime-${crypto.randomUUID()}` : `runtime-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await chrome.storage.local.set({ agentRuntimeAgentId: agentId });
  }
  return { agentId, label: stored.agentRuntimeLabel || 'Agent Runtime V0.2' };
}

async function brokerMeta() {
  const tab = await activeTab();
  return {
    product: 'agent-runtime',
    runtimeVersion: '0.2.1',
    extensionVersion: chrome.runtime.getManifest().version,
    supportedActions: ['agentStatus', 'agentListTabs', 'agentObserveTabs', 'agentObserve', 'agentExecutePlan'],
    activeTab: tab ? { id: tab.id, title: tab.title || '', url: tab.url || '' } : null
  };
}

async function handleBrokerCommand(payload) {
  const action = payload?.action;
  const data = payload?.data || {};

  if (action === 'agentListTabs') {
    return { ok: true, tabs: await tabContext.list(data.scope || { mode: 'all' }) };
  }
  if (action === 'agentObserveTabs') {
    return { ok: true, observations: await observeScopedTabs(data.scope || { mode: 'visible' }) };
  }

  const requestedTab = Number(payload?.tabId);
  const tab = Number.isInteger(requestedTab) ? { id: requestedTab } : await activeTab();
  if (!tab?.id) throw new Error('no_active_tab');
  if (action === 'agentStatus') return runtimeStatus(tab.id);
  if (action === 'agentObserve') return { ok: true, observation: await observe(tab.id) };
  if (action === 'agentExecutePlan') {
    return { ok: true, result: await executeCdpPlan(tab.id, data.plan, data.observationId || null) };
  }
  throw new Error(`unsupported_broker_action:${action || '<empty>'}`);
}

chrome.debugger.onDetach.addListener(source => {
  if (source.tabId) {
    attachedTabs.delete(source.tabId);
    registry.invalidateTab(source.tabId);
    pointerByTab.delete(source.tabId);
  }
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'loading') registry.invalidateTab(tabId);
});
chrome.tabs.onRemoved.addListener(tabId => {
  registry.invalidateTab(tabId);
  pointerByTab.delete(tabId);
  attachedTabs.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (![SCOPE, LEGACY_SCOPE].includes(message?.scope)) return false;
  (async () => {
    if (message.type === 'LIST_TABS') return { ok: true, tabs: await tabContext.list(message.scope || { mode: 'all' }) };
    if (message.type === 'OBSERVE_TABS') return { ok: true, observations: await observeScopedTabs(message.scope || { mode: 'visible' }) };
    const tab = message.tabId ? { id: message.tabId } : await activeTab();
    if (!tab?.id) throw new Error('no_active_tab');
    if (message.type === 'STATUS') return runtimeStatus(tab.id);
    if (message.type === 'ATTACH') return { ok: true, ...(await attach(tab.id)) };
    if (message.type === 'DETACH') return { ok: true, ...(await detach(tab.id)) };
    if (message.type === 'OBSERVE') return { ok: true, observation: await observe(tab.id) };
    if (message.type === 'EXECUTE_PLAN') return { ok: true, result: await executeCdpPlan(tab.id, message.plan, message.observationId || null) };
    if (message.type === 'EXECUTE') return { ok: true, result: await executeNormalizedAction(tab.id, message.action) };
    return { ok: false, error: 'unknown_message' };
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

const broker = AgentBrokerClient.createClient({
  handleCommand: handleBrokerCommand,
  getIdentity: brokerIdentity,
  getMeta: brokerMeta,
  log: message => console.log(`[agent-runtime] ${message}`)
});
broker.connect();