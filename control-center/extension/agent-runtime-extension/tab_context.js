'use strict';

(function initAgentTabContext(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AgentTabContext = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const TAB_LIFECYCLE_ACTIONS = new Set(['switchTab', 'openNewTab', 'closeTab']);
  const TAB_MATCH_KEYS = new Set(['title', 'titleIncludes', 'url', 'urlIncludes']);

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

  function normalizeTabMatch(match) {
    if (!match || typeof match !== 'object' || Array.isArray(match)) throw new Error('browser_tab_match_object_required');
    const out = {};
    for (const [key, value] of Object.entries(match)) {
      if (!TAB_MATCH_KEYS.has(key)) throw new Error(`browser_tab_match_key_unsupported:${key}`);
      const text = typeof value === 'string' ? value.trim() : '';
      if (!text) throw new Error(`browser_tab_match_value_required:${key}`);
      out[key] = text;
    }
    if (!Object.keys(out).length) throw new Error('browser_tab_match_required');
    return out;
  }

  function tabMatches(tab, match) {
    if (!isWebTab(tab)) return false;
    if (match.title != null && String(tab.title || '') !== match.title) return false;
    if (match.titleIncludes != null && !String(tab.title || '').toLowerCase().includes(String(match.titleIncludes).toLowerCase())) return false;
    if (match.url != null && String(tab.url || '') !== match.url) return false;
    if (match.urlIncludes != null && !String(tab.url || '').toLowerCase().includes(String(match.urlIncludes).toLowerCase())) return false;
    return true;
  }

  function normalizeBrowserAction(action = {}) {
    const actionType = String(action.actionType || action.type || '').trim();
    if (!TAB_LIFECYCLE_ACTIONS.has(actionType)) {
      throw new Error(`unsupported_browser_tab_action:${actionType || '<empty>'}`);
    }
    const args = action.args && typeof action.args === 'object' && !Array.isArray(action.args)
      ? { ...action.args }
      : {};
    if (Object.prototype.hasOwnProperty.call(args, 'tabId') || Object.prototype.hasOwnProperty.call(args, 'windowId')) {
      throw new Error('browser_tab_action_raw_identity_forbidden');
    }
    if (actionType === 'openNewTab') {
      const url = String(args.url || '').trim();
      if (!url) throw new Error('openNewTab requires args.url');
      let parsed;
      try { parsed = new URL(url); }
      catch (_) { throw new Error('openNewTab requires valid url'); }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('openNewTab requires http(s) url');
      args.url = url;
    }
    if (['switchTab', 'closeTab'].includes(actionType) && args.match != null) {
      args.match = normalizeTabMatch(args.match);
    }
    return { browserActionVersion: '0.2.0', actionType, args };
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

    async function resolveSemanticTarget(action, fallbackTabId) {
      if (action?.args?.match) {
        const matches = (await listWebTabs()).filter(tab => tabMatches(tab, action.args.match));
        if (matches.length === 0) throw new Error(`${action.actionType}_semantic_target_not_found`);
        if (matches.length > 1) throw new Error(`${action.actionType}_semantic_target_ambiguous`);
        return matches[0];
      }
      const tabId = Number(fallbackTabId);
      if (!Number.isInteger(tabId) || tabId <= 0) throw new Error('browser_tab_action_tab_id_required');
      const tab = await chromeApi.tabs.get(tabId).catch(() => null);
      if (!tab) throw new Error(`${action.actionType} target tab not found`);
      return tab;
    }

    async function executeBrowserAction(input = {}) {
      const action = normalizeBrowserAction(input.action || input);
      const requestedTabId = Number(input.tabId);

      if (action.actionType === 'switchTab') {
        const before = await resolveSemanticTarget(action, requestedTabId);
        const updated = await chromeApi.tabs.update(before.id, { active: true });
        return {
          ok: true,
          browserActionVersion: action.browserActionVersion,
          actionType: action.actionType,
          semanticTargeted: !!action.args.match,
          tab: publicTab(updated || before)
        };
      }

      if (action.actionType === 'openNewTab') {
        if (typeof chromeApi.tabs.create !== 'function') throw new Error('chrome_tabs_create_required');
        let anchor = null;
        if (Number.isInteger(requestedTabId) && requestedTabId > 0) {
          anchor = await chromeApi.tabs.get(requestedTabId).catch(() => null);
        }
        if (!anchor) anchor = await activeTab();
        if (!anchor) throw new Error('openNewTab anchor tab not found');
        const created = await chromeApi.tabs.create({
          url: action.args.url,
          active: true,
          ...(Number.isInteger(Number(anchor.windowId)) ? { windowId: Number(anchor.windowId) } : {})
        });
        if (!created?.id) throw new Error('openNewTab did not return created tab');
        return {
          ok: true,
          browserActionVersion: action.browserActionVersion,
          actionType: action.actionType,
          semanticTargeted: true,
          tab: publicTab(created)
        };
      }

      if (typeof chromeApi.tabs.remove !== 'function') throw new Error('chrome_tabs_remove_required');
      const closing = await resolveSemanticTarget(action, requestedTabId);
      await chromeApi.tabs.remove(closing.id);
      return {
        ok: true,
        browserActionVersion: action.browserActionVersion,
        actionType: action.actionType,
        semanticTargeted: !!action.args.match,
        closedTab: publicTab(closing)
      };
    }

    return { activeTab, listWebTabs, select, list, resolveSemanticTarget, executeBrowserAction };
  }

  return {
    TAB_LIFECYCLE_ACTIONS,
    TAB_MATCH_KEYS,
    isWebTab,
    publicTab,
    matchesScope,
    normalizeTabMatch,
    tabMatches,
    normalizeBrowserAction,
    createTabContext
  };
});
