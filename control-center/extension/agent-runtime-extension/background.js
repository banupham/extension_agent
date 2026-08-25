'use strict';

importScripts('target_registry.js', 'cdp_plan_dispatcher.js');

const SCOPE = 'AGENT_RUNTIME_V02';
const LEGACY_SCOPE = 'AGENT_RUNTIME_V01';
const DEBUGGER_VERSION = '1.3';
const TARGET_TTL_MS = 4000;
const attachedTabs = new Set();
const pointerByTab = new Map();
const registry = AgentTargetRegistry.createRegistry({ ttlMs: TARGET_TTL_MS });
let observationCounter = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0))));

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

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
  const registered = registry.register({
    observationId,
    tabId,
    url: raw.url,
    frameId: 0,
    targets: raw.interactiveElements || []
  });
  return {
    schemaVersion: '0.2.0',
    observationId,
    capturedAt: Date.now(),
    expiresAt: registered.expiresAt,
    url: raw.url,
    title: raw.title,
    viewport: raw.viewport,
    scroll: raw.scroll,
    focusedRef: raw.focusedRef || null,
    interactiveElements: registered.targets
  };
}

async function resolveTarget(tabId, action) {
  const url = await currentUrl(tabId);
  return registry.resolve({
    tabId,
    observationId: action?.observationId,
    targetRef: action?.targetRef,
    currentUrl: url
  });
}

async function movePointer(tabId, x, y) {
  await command(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  pointerByTab.set(tabId, { x, y, ts: Date.now() });
}

async function targetPointer(tabId, action) {
  const target = await resolveTarget(tabId, action);
  const x = target.rect.centerX;
  const y = target.rect.centerY;
  await movePointer(tabId, x, y);
  return { target, x, y };
}

async function clickTarget(tabId, action, clickCount = 1) {
  const { target, x, y } = await targetPointer(tabId, action);
  const holdMs = Math.min(1200, Math.max(0, Number(action?.behavior?.pointer?.holdMs ?? action?.holdMs ?? 60)));
  const dwellMs = Math.min(1500, Math.max(0, Number(action?.behavior?.pointer?.dwellBeforeDownMs ?? action?.dwellBeforeDownMs ?? 0)));
  if (dwellMs) await sleep(dwellMs);
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
  return ['click', 'doubleClick', 'hover', 'moveTo', 'focus', 'drag', 'toggle', 'dismiss', 'play', 'pause', 'mute', 'unmute', 'setVolume', 'seek'].includes(plan?.actionType);
}

async function executeCdpPlan(tabId, plan, observationId = null) {
  const normalized = AgentCdpPlanDispatcher.validatePlan(plan);
  if (planRequiresTarget(normalized)) {
    const url = await currentUrl(tabId);
    registry.resolve({ tabId, observationId, targetRef: normalized.targetRef, currentUrl: url });
  }
  const result = await AgentCdpPlanDispatcher.dispatchPlan(
    normalized,
    async (method, params) => {
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
        type: 'mouseWheel',
        x: point.x,
        y: point.y,
        deltaX: horizontal ? amount : 0,
        deltaY: horizontal ? 0 : amount
      });
      return { ok: true, axis: horizontal ? 'horizontal' : 'vertical', delta: amount };
    }

    default:
      throw new Error(`unsupported_action_v02:${action.action}`);
  }
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
    const tab = message.tabId ? { id: message.tabId } : await activeTab();
    if (!tab?.id) throw new Error('no_active_tab');

    if (message.type === 'STATUS') {
      return {
        ok: true,
        runtimeVersion: '0.2.0',
        architecture: 'task -> observer -> strategy -> behavior -> cdp-plan -> executor',
        attached: attachedTabs.has(tab.id),
        tabId: tab.id,
        targetRegistry: registry.status(tab.id),
        planExecution: { version: '0.1.0', allowlistedOnly: true },
        supportedActions: [
          'openUrl', 'reload', 'back', 'forward',
          'pressKey', 'type', 'typeText',
          'moveTo', 'hover', 'click', 'doubleClick', 'focus',
          'scrollVertical', 'scrollHorizontal'
        ]
      };
    }
    if (message.type === 'ATTACH') return { ok: true, ...(await attach(tab.id)) };
    if (message.type === 'DETACH') return { ok: true, ...(await detach(tab.id)) };
    if (message.type === 'OBSERVE') return { ok: true, observation: await observe(tab.id) };
    if (message.type === 'EXECUTE_PLAN') return { ok: true, result: await executeCdpPlan(tab.id, message.plan, message.observationId || null) };
    if (message.type === 'EXECUTE') return { ok: true, result: await executeNormalizedAction(tab.id, message.action) };
    return { ok: false, error: 'unknown_message' };
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});
