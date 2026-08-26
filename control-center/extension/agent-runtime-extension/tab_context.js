'use strict';

(function initAgentTabContext(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AgentTabContext = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  function isWebTab(tab) {
    return Number.isInteger(Number(tab?.id)) && /^https?:/i.test(String(tab?.url || ''));
  }

  function publicTab(tab) {
    return {
      tabId: Number(tab.id),
      windowId: Number.isInteger(Number(tab.windowId)) ? Number(tab.windowId) : null,
      active: !!tab.active,
      highlighted: !!tab.highlighted,
      audible: !!tab.audible,
      discarded: !!tab.discarded,
      status: tab.status || null,
      title: tab.title || '',
      url: tab.url || ''
    };
  }

  function normalizeHost(value) {
    return String(value || '').trim().toLowerCase().replace(/^www\./, '');
  }

  function hostOf(url) {
    try { return normalizeHost(new URL(String(url || '')).hostname); }
    catch (_) { return ''; }
  }

  function matchesScope(tab, scope = {}) {
    if (!isWebTab(tab)) return false;
    const host = normalizeHost(scope.hostname || scope.host);
    const urlIncludes = String(scope.urlIncludes || '').trim().toLowerCase();
    const titleIncludes = String(scope.titleIncludes || '').trim().toLowerCase();
    const tabHost = hostOf(tab.url);
    if (host && !(tabHost === host || tabHost.endsWith(`.${host}`))) return false;
    if (urlIncludes && !String(tab.url || '').toLowerCase().includes(urlIncludes)) return false;
    if (titleIncludes && !String(tab.title || '').toLowerCase().includes(titleIncludes)) return false;
    return true;
  }

  function createTabContext(chromeApi) {
    if (!chromeApi?.tabs?.query) throw new Error('chrome_tabs_api_required');

    async function listWebTabs() {
      const tabs = await chromeApi.tabs.query({});
      return tabs.filter(isWebTab);
    }

    async function activeTab() {
      const lastFocusedWindow = await chromeApi.windows?.getLastFocused?.({ windowTypes: ['normal'] }).catch(() => null);
      if (Number.isInteger(Number(lastFocusedWindow?.id))) {
        const tabs = await chromeApi.tabs.query({ active: true, windowId: Number(lastFocusedWindow.id) });
        const preferred = tabs.find(isWebTab) || tabs[0];
        if (preferred) return preferred;
      }
      const activeTabs = await chromeApi.tabs.query({ active: true });
      return activeTabs.find(isWebTab) || activeTabs[0] || null;
    }

    async function select(scope = {}) {
      const mode = String(scope.mode || 'active');
      if (mode === 'active') {
        const tab = await activeTab();
        return tab ? [tab] : [];
      }
      if (mode === 'tab') {
        const tabId = Number(scope.tabId);
        if (!Number.isInteger(tabId)) throw new Error('tab_scope_tab_id_required');
        const tab = await chromeApi.tabs.get(tabId).catch(() => null);
        return tab && isWebTab(tab) ? [tab] : [];
      }
      const tabs = await listWebTabs();
      if (mode === 'visible') return tabs.filter(tab => !!tab.active);
      if (mode === 'matching') return tabs.filter(tab => matchesScope(tab, scope));
      if (mode === 'all') return tabs;
      throw new Error(`unsupported_tab_scope:${mode}`);
    }

    async function list(scope = { mode: 'all' }) {
      return (await select(scope)).map(publicTab);
    }

    return { activeTab, listWebTabs, select, list };
  }

  return { isWebTab, publicTab, matchesScope, createTabContext };
});
