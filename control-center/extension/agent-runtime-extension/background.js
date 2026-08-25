'use strict';

const SCOPE = 'AGENT_RUNTIME_V01';
const DEBUGGER_VERSION = '1.3';
const attachedTabs = new Set();

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
  return { attached: false, tabId };
}

async function command(tabId, method, params = {}) {
  await attach(tabId);
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

async function observe(tabId) {
  const expression = `(() => {
    const visible = el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const safeSelector = el => {
      if (el.id) return '#' + CSS.escape(el.id);
      const name = el.getAttribute('name');
      if (name) return el.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]';
      const testid = el.getAttribute('data-testid');
      if (testid) return '[data-testid="' + CSS.escape(testid) + '"]';
      return el.tagName.toLowerCase();
    };
    const nodes = [...document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex]')].filter(visible).slice(0, 500);
    return {
      schemaVersion: '0.1.0',
      url: location.href,
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      scroll: { x: scrollX, y: scrollY },
      focusedElement: document.activeElement && document.activeElement !== document.body ? safeSelector(document.activeElement) : null,
      interactiveElements: nodes.map((el, i) => {
        const r = el.getBoundingClientRect();
        const tag = el.tagName.toLowerCase();
        return {
          ref: 'e' + i,
          tag,
          role: el.getAttribute('role') || null,
          label: (el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').slice(0, 160),
          editable: el.isContentEditable || ['input','textarea','select'].includes(tag),
          enabled: !el.matches(':disabled'),
          visible: true,
          selector: safeSelector(el),
          rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
        };
      })
    };
  })()`;
  const result = await command(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  return result?.result?.value || null;
}

async function executeNormalizedAction(tabId, action) {
  if (!action || typeof action.action !== 'string') throw new Error('invalid_action');

  switch (action.action) {
    case 'openUrl':
      if (!action.url) throw new Error('openUrl requires url');
      return command(tabId, 'Page.navigate', { url: action.url });

    case 'pressKey': {
      const key = String(action.key || '');
      if (!key) throw new Error('pressKey requires key');
      await command(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key });
      await command(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key });
      return { ok: true };
    }

    case 'type':
      await command(tabId, 'Input.insertText', { text: String(action.text || '') });
      return { ok: true };

    default:
      throw new Error(`unsupported_action_v01:${action.action}`);
  }
}

chrome.debugger.onDetach.addListener(source => {
  if (source.tabId) attachedTabs.delete(source.tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.scope !== SCOPE) return false;
  (async () => {
    const tab = message.tabId ? { id: message.tabId } : await activeTab();
    if (!tab?.id) throw new Error('no_active_tab');

    if (message.type === 'STATUS') {
      return {
        ok: true,
        runtimeVersion: '0.1.0',
        architecture: 'task -> observer -> strategy -> action-contract -> cdp-executor',
        attached: attachedTabs.has(tab.id),
        tabId: tab.id,
        supportedActions: ['openUrl', 'pressKey', 'type']
      };
    }
    if (message.type === 'ATTACH') return { ok: true, ...(await attach(tab.id)) };
    if (message.type === 'DETACH') return { ok: true, ...(await detach(tab.id)) };
    if (message.type === 'OBSERVE') return { ok: true, observation: await observe(tab.id) };
    if (message.type === 'EXECUTE') return { ok: true, result: await executeNormalizedAction(tab.id, message.action) };
    return { ok: false, error: 'unknown_message' };
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});
