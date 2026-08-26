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
    const interactiveSelector = 'a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex]';
    const visible = el => {
      const r = el.getBoundingClientRect();
      const view = el.ownerDocument?.defaultView || window;
      const s = view.getComputedStyle(el);
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
    const optionState = el => [...el.options].slice(0, 100).map((option, index) => ({
      index,
      value: String(option.value ?? ''),
      label: String(option.label || option.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
      disabled: !!option.disabled,
      selected: !!option.selected
    }));
    const interactiveElements = [];
    let focusedRef = null;
    let framesVisited = 0;
    let framesSkipped = 0;

    const walk = (doc, offsetX, offsetY, framePath, depth) => {
      if (!doc || depth > 8 || interactiveElements.length >= 500) return;
      let frameUrl = null;
      try { frameUrl = String(doc.location?.href || ''); } catch (_) {}
      const active = doc.activeElement;
      const nodes = [...doc.querySelectorAll(interactiveSelector)].filter(visible);
      for (const el of nodes) {
        if (interactiveElements.length >= 500) break;
        const r = el.getBoundingClientRect();
        const tag = el.tagName.toLowerCase();
        const inputType = tag === 'input' ? String(el.type || '').toLowerCase() : null;
        const checkable = tag === 'input' && ['checkbox', 'radio'].includes(inputType);
        const isSelect = tag === 'select';
        const isRange = tag === 'input' && inputType === 'range';
        const ref = 'e' + interactiveElements.length;
        if (el === active) focusedRef = ref;
        interactiveElements.push({
          ref,
          framePath: [...framePath],
          frameDepth: depth,
          frameUrl,
          tag,
          role: el.getAttribute('role') || null,
          label: label(el),
          editable: el.isContentEditable || ['input','textarea','select'].includes(tag),
          enabled: !el.matches(':disabled'),
          visible: true,
          inputType,
          checked: checkable ? !!el.checked : null,
          selectedValue: isSelect ? String(el.value ?? '') : null,
          selectedIndex: isSelect ? Number(el.selectedIndex) : null,
          options: isSelect ? optionState(el) : [],
          rangeValue: isRange ? Number(el.value) : null,
          rangeMin: isRange ? Number(el.min || '0') : null,
          rangeMax: isRange ? Number(el.max || '100') : null,
          rangeStep: isRange ? (el.step === 'any' ? 'any' : Number(el.step || '1')) : null,
          selector: safeSelector(el),
          rect: { x: offsetX + r.x, y: offsetY + r.y, width: r.width, height: r.height }
        });
      }

      const frames = [...doc.querySelectorAll('iframe,frame')];
      frames.forEach((owner, index) => {
        if (depth >= 8 || interactiveElements.length >= 500 || !visible(owner)) return;
        try {
          const child = owner.contentDocument;
          if (!child) { framesSkipped += 1; return; }
          const r = owner.getBoundingClientRect();
          framesVisited += 1;
          walk(
            child,
            offsetX + r.x + Number(owner.clientLeft || 0),
            offsetY + r.y + Number(owner.clientTop || 0),
            [...framePath, index],
            depth + 1
          );
        } catch (_) {
          framesSkipped += 1;
        }
      });
    };

    walk(document, 0, 0, [], 0);
    return {
      schemaVersion: '0.2.0',
      url: location.href,
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      scroll: { x: scrollX, y: scrollY },
      frameSummary: { visited: framesVisited, skipped: framesSkipped },
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
    frameSummary: raw.frameSummary || { visited: 0, skipped: 0 },
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

function optionStateSignature(options) {
  if (!Array.isArray(options)) return '';
  return JSON.stringify(options.map(option => ({
    index: Number(option?.index),
    value: String(option?.value ?? ''),
    label: String(option?.label ?? ''),
    disabled: option?.disabled === true
  })));
}

function targetFormStateChanged(target, live) {
  if (typeof target?.checked === 'boolean' && live?.checked !== target.checked) return true;
  if (target?.tag === 'select') {
    if (Number.isInteger(Number(target.selectedIndex)) && Number(live?.selectedIndex) !== Number(target.selectedIndex)) return true;
    if (target.selectedValue != null && String(live?.selectedValue ?? '') !== String(target.selectedValue)) return true;
    if (Array.isArray(target.options) && optionStateSignature(target.options) !== optionStateSignature(live?.options)) return true;
  }
  if (target?.tag === 'input' && String(target?.inputType || '').toLowerCase() === 'range') {
    if (target.rangeValue != null && Number(live?.rangeValue) !== Number(target.rangeValue)) return true;
    if (target.rangeMin != null && Number(live?.rangeMin) !== Number(target.rangeMin)) return true;
    if (target.rangeMax != null && Number(live?.rangeMax) !== Number(target.rangeMax)) return true;
    if (target.rangeStep != null && String(live?.rangeStep) !== String(target.rangeStep)) return true;
  }
  return false;
}

async function readLiveTarget(tabId, target) {
  const interactiveSelector = 'a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex]';
  const framePath = Array.isArray(target?.framePath) ? target.framePath : [];
  const selector = typeof target?.selector === 'string' ? target.selector : null;
  const topX = Number(target?.rect?.centerX);
  const topY = Number(target?.rect?.centerY);
  const expression = `(() => {
    const interactive = ${JSON.stringify(interactiveSelector)};
    const framePath = ${JSON.stringify(framePath)};
    const targetSelector = ${JSON.stringify(selector)};
    const topPoint = { x:${topX}, y:${topY} };
    const label = el => {
      const raw = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.innerText || '';
      return String(raw).replace(/\\s+/g, ' ').trim().slice(0, 160);
    };
    const optionState = el => [...el.options].slice(0, 100).map((option, index) => ({
      index,
      value: String(option.value ?? ''),
      label: String(option.label || option.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
      disabled: !!option.disabled,
      selected: !!option.selected
    }));
    let doc = document;
    let offsetX = 0;
    let offsetY = 0;
    try {
      for (const frameIndex of framePath) {
        const frames = [...doc.querySelectorAll('iframe,frame')];
        const owner = frames[Number(frameIndex)];
        if (!owner) return { ok:false, reason:'frame_missing' };
        const r = owner.getBoundingClientRect();
        const child = owner.contentDocument;
        if (!child) return { ok:false, reason:'frame_unavailable' };
        offsetX += r.x + Number(owner.clientLeft || 0);
        offsetY += r.y + Number(owner.clientTop || 0);
        doc = child;
      }
    } catch (_) {
      return { ok:false, reason:'frame_unavailable' };
    }
    let frameUrl = null;
    try { frameUrl = String(doc.location?.href || ''); } catch (_) {}
    let el = targetSelector
      ? doc.querySelector(targetSelector)
      : doc.elementFromPoint(topPoint.x - offsetX, topPoint.y - offsetY);
    if (el && !targetSelector && !el.matches(interactive)) el = el.closest(interactive);
    if (!el) return { ok:false, reason:'missing' };
    const r = el.getBoundingClientRect();
    const view = el.ownerDocument?.defaultView || window;
    const s = view.getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    const inputType = tag === 'input' ? String(el.type || '').toLowerCase() : null;
    const checkable = tag === 'input' && ['checkbox', 'radio'].includes(inputType);
    const isSelect = tag === 'select';
    const isRange = tag === 'input' && inputType === 'range';
    const visible = r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    return {
      ok:true,
      frameDepth:framePath.length,
      frameUrl,
      tag,
      role:el.getAttribute('role') || null,
      label:label(el),
      enabled:!el.matches(':disabled'),
      visible,
      inputType,
      checked:checkable ? !!el.checked : null,
      selectedValue:isSelect ? String(el.value ?? '') : null,
      selectedIndex:isSelect ? Number(el.selectedIndex) : null,
      options:isSelect ? optionState(el) : [],
      rangeValue:isRange ? Number(el.value) : null,
      rangeMin:isRange ? Number(el.min || '0') : null,
      rangeMax:isRange ? Number(el.max || '100') : null,
      rangeStep:isRange ? (el.step === 'any' ? 'any' : Number(el.step || '1')) : null,
      rect:{ x:offsetX + r.x, y:offsetY + r.y, width:r.width, height:r.height }
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
  if (target?.frameUrl && live?.frameUrl && target.frameUrl !== live.frameUrl) {
    throw new Error('target_frame_changed');
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
  if (targetFormStateChanged(target, live)) throw new Error('target_state_changed');
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
  return [
    'click', 'doubleClick', 'hover', 'moveTo', 'scrollIntoView', 'focus', 'drag',
    'replaceText', 'clear', 'setChecked', 'selectOption', 'toggle', 'submit',
    'dismiss', 'hoverAndObserve', 'play', 'pause', 'mute', 'unmute',
    'setVolume', 'seek', 'changePlaybackRate'
  ].includes(plan?.actionType);
}

async function executeCdpPlan(tabId, plan, observationId = null) {
  const normalized = AgentCdpPlanDispatcher.validatePlan(plan);
  let guardedTarget = null;
  let guardedDestination = null;
  if (planRequiresTarget(normalized)) {
    const url = await currentUrl(tabId);
    guardedTarget = registry.resolve({ tabId, observationId, targetRef: normalized.targetRef, currentUrl: url });
    await guardTargetGeometry(tabId, guardedTarget);
    if (normalized.actionType === 'drag') {
      guardedDestination = registry.resolve({ tabId, observationId, targetRef: normalized.destinationRef, currentUrl: url });
      await guardTargetGeometry(tabId, guardedDestination);
    }
  }
  const result = await AgentCdpPlanDispatcher.dispatchPlan(
    normalized,
    async (method, params) => {
      if (guardedTarget && method === 'Input.dispatchMouseEvent' && params?.type === 'mousePressed') {
        await guardTargetGeometry(tabId, guardedTarget);
      }
      if (guardedDestination && method === 'Input.dispatchMouseEvent' && params?.type === 'mouseReleased') {
        await guardTargetGeometry(tabId, guardedDestination);
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
      if (target.selector && (!target.framePath || target.framePath.length === 0)) {
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
