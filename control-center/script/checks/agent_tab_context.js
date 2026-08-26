'use strict';

const assert = require('assert');
const { createTabContext, matchesScope } = require('../../extension/agent-runtime-extension/tab_context.js');

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
    async get(tabId) { return tabs.find(x => x.id === tabId) || null; }
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
  console.log('Agent tab context contract: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
