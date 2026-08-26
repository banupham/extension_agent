'use strict';

const assert = require('assert');
const { createTabContext, matchesScope, normalizeBrowserAction } = require('../../extension/agent-runtime-extension/tab_context.js');

const tabs = [
  { id: 1, windowId: 10, active: true, title: 'Facebook', url: 'https://web.facebook.com/home' },
  { id: 2, windowId: 10, active: false, title: 'Google', url: 'https://www.google.com/' },
  { id: 3, windowId: 11, active: true, title: 'Facebook Messages', url: 'https://www.facebook.com/messages/' },
  { id: 4, windowId: 11, active: false, title: 'Extensions', url: 'chrome://extensions/' }
];

const chromeApi = {
  tabs: {
    async query(query) {
      if (query?.active && Number.isInteger(query?.windowId)) return tabs.filter(x => x.active && x.windowId === query.windowId);
      if (query?.active) return tabs.filter(x => x.active);
      return tabs.slice();
    },
    async get(tabId) { return tabs.find(x => x.id === tabId) || null; },
    async update(tabId, change) {
      const tab = tabs.find(x => x.id === tabId);
      if (!tab) throw new Error('tab missing');
      if (change?.active) {
        for (const item of tabs) {
          if (item.windowId === tab.windowId) item.active = false;
        }
        tab.active = true;
      }
      return { ...tab };
    },
    async create(create) {
      const id = Math.max(...tabs.map(x => x.id)) + 1;
      if (create?.active) {
        for (const item of tabs) {
          if (item.windowId === create.windowId) item.active = false;
        }
      }
      const tab = {
        id,
        windowId: create.windowId ?? 10,
        active: create.active === true,
        title: 'New Tab',
        url: create.url || 'about:blank'
      };
      tabs.push(tab);
      return { ...tab };
    },
    async remove(tabId) {
      const index = tabs.findIndex(x => x.id === tabId);
      if (index < 0) throw new Error('tab missing');
      tabs.splice(index, 1);
    }
  },
  windows: {
    async getLastFocused() { return { id: 10 }; }
  }
};

(async () => {
  const context = createTabContext(chromeApi);
  const active = await context.activeTab();
  assert.strictEqual(active.id, 1);

  const visible = await context.list({ mode: 'visible' });
  assert.deepStrictEqual(visible.map(x => x.tabId), [1, 3]);

  const facebook = await context.list({ mode: 'matching', hostname: 'facebook.com' });
  assert.deepStrictEqual(facebook.map(x => x.tabId), [1, 3]);

  const explicit = await context.list({ mode: 'tab', tabId: 2 });
  assert.deepStrictEqual(explicit.map(x => x.tabId), [2]);

  const all = await context.list({ mode: 'all' });
  assert.deepStrictEqual(all.map(x => x.tabId), [1, 2, 3]);

  assert.strictEqual(matchesScope(tabs[0], { hostname: 'facebook.com' }), true);
  assert.strictEqual(matchesScope(tabs[1], { hostname: 'facebook.com' }), false);

  assert.strictEqual(normalizeBrowserAction({ actionType: 'switchTab' }).actionType, 'switchTab');
  assert.throws(() => normalizeBrowserAction({ actionType: 'openNewTab', args: {} }), /args.url/);
  assert.throws(() => normalizeBrowserAction({ actionType: 'openNewTab', args: { url: 'chrome:\/\/extensions' } }), /http\(s\)/);

  const switched = await context.executeBrowserAction({ tabId: 2, action: { actionType: 'switchTab' } });
  assert.strictEqual(switched.actionType, 'switchTab');
  assert.strictEqual(switched.tab.tabId, 2);
  assert.strictEqual(switched.tab.active, true);
  assert.strictEqual(tabs.find(x => x.id === 1).active, false);

  const opened = await context.executeBrowserAction({
    tabId: 2,
    action: { actionType: 'openNewTab', args: { url: 'http://127.0.0.1:8091/?tab=opened' } }
  });
  assert.strictEqual(opened.actionType, 'openNewTab');
  assert.strictEqual(opened.tab.url, 'http://127.0.0.1:8091/?tab=opened');
  assert.strictEqual(opened.tab.windowId, 10);
  assert.strictEqual(opened.tab.active, true);
  assert.ok(tabs.some(x => x.id === opened.tab.tabId));

  const closed = await context.executeBrowserAction({
    tabId: opened.tab.tabId,
    action: { actionType: 'closeTab' }
  });
  assert.strictEqual(closed.actionType, 'closeTab');
  assert.strictEqual(closed.closedTab.tabId, opened.tab.tabId);
  assert.ok(!tabs.some(x => x.id === opened.tab.tabId));

  console.log('Agent tab context contract: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
