'use strict';

const assert = require('assert');
const { runOneAction } = require('../../manager/agent/one_action_bridge.js');

function cloneTabs(tabs) {
  return tabs.map(tab => ({ ...tab }));
}

function makeRuntime(initialTabs, boundTabId) {
  let tabs = cloneTabs(initialTabs);
  let observationCounter = 0;
  let executePlanCalls = 0;
  let browserCalls = 0;

  return {
    async observe() {
      observationCounter += 1;
      const tab = tabs.find(item => item.tabId === boundTabId) || initialTabs.find(item => item.tabId === boundTabId);
      return {
        observationId: `tab-obs-${boundTabId}-${observationCounter}`,
        tabId: boundTabId,
        url: tab?.url || 'http://127.0.0.1:8091/',
        title: tab?.title || 'Tab Lifecycle',
        viewport: { width: 1000, height: 700 },
        scroll: { x: 0, y: 0 },
        interactiveElements: []
      };
    },
    async listTabs() {
      return cloneTabs(tabs);
    },
    async executePlan() {
      executePlanCalls += 1;
      throw new Error('tab lifecycle must not call executePlan');
    },
    async executeBrowserAction({ action }) {
      browserCalls += 1;
      if (action.actionType === 'switchTab') {
        const target = tabs.find(item => item.tabId === boundTabId);
        if (!target) throw new Error('switch target missing');
        for (const item of tabs) {
          if (item.windowId === target.windowId) item.active = false;
        }
        target.active = true;
        return { ok: true, actionType: 'switchTab', tab: { ...target } };
      }
      if (action.actionType === 'openNewTab') {
        const anchor = tabs.find(item => item.tabId === boundTabId);
        if (!anchor) throw new Error('open anchor missing');
        for (const item of tabs) {
          if (item.windowId === anchor.windowId) item.active = false;
        }
        const created = {
          tabId: Math.max(...tabs.map(item => item.tabId)) + 1,
          windowId: anchor.windowId,
          active: true,
          title: 'Opened',
          url: action.args.url
        };
        tabs.push(created);
        return { ok: true, actionType: 'openNewTab', tab: { ...created } };
      }
      if (action.actionType === 'closeTab') {
        const index = tabs.findIndex(item => item.tabId === boundTabId);
        if (index < 0) throw new Error('close target missing');
        const [closedTab] = tabs.splice(index, 1);
        return { ok: true, actionType: 'closeTab', closedTab };
      }
      throw new Error(`unsupported:${action.actionType}`);
    },
    stats() {
      return { executePlanCalls, browserCalls, tabs: cloneTabs(tabs) };
    }
  };
}

(async () => {
  const baseTabs = [
    { tabId: 1, windowId: 10, active: true, title: 'Alpha', url: 'http://127.0.0.1:8091/?tab=alpha' },
    { tabId: 2, windowId: 10, active: false, title: 'Beta', url: 'http://127.0.0.1:8091/?tab=beta' },
    { tabId: 3, windowId: 10, active: false, title: 'Disposable', url: 'http://127.0.0.1:8091/?tab=disposable' }
  ];

  const switchRuntime = makeRuntime(baseTabs, 2);
  const switched = await runOneAction({
    runtime: switchRuntime,
    agentAction: { type: 'switchTab' }
  });
  assert.strictEqual(switched.mappedAction.type, 'switchTab');
  assert.strictEqual(switched.cdpPlan, null);
  assert.strictEqual(switched.browserAction.actionType, 'switchTab');
  assert.strictEqual(switched.execution.actionType, 'switchTab');
  assert.strictEqual(switched.afterBrowserContext.tabs.find(tab => tab.tabId === 2).active, true);
  assert.strictEqual(switched.postActionObservation.mode, 'browser-context');
  assert.strictEqual(switched.postActionObservation.semanticChanged, true);
  assert.strictEqual(switched.invariant.reObservedSurface, 'browser-context');
  assert.deepStrictEqual(switchRuntime.stats().executePlanCalls, 0);
  assert.deepStrictEqual(switchRuntime.stats().browserCalls, 1);

  const openRuntime = makeRuntime(baseTabs, 1);
  const opened = await runOneAction({
    runtime: openRuntime,
    agentAction: { type: 'openNewTab', args: { url: 'http://127.0.0.1:8091/?tab=opened' } }
  });
  assert.strictEqual(opened.cdpPlan, null);
  assert.strictEqual(opened.browserAction.actionType, 'openNewTab');
  assert.strictEqual(opened.browserAction.args.url, 'http://127.0.0.1:8091/?tab=opened');
  assert.ok(opened.afterBrowserContext.tabs.some(tab => tab.url.endsWith('?tab=opened')));
  assert.strictEqual(openRuntime.stats().executePlanCalls, 0);
  assert.strictEqual(openRuntime.stats().browserCalls, 1);

  const closeRuntime = makeRuntime(baseTabs, 3);
  const closed = await runOneAction({
    runtime: closeRuntime,
    agentAction: { type: 'closeTab' }
  });
  assert.strictEqual(closed.cdpPlan, null);
  assert.strictEqual(closed.browserAction.actionType, 'closeTab');
  assert.ok(!closed.afterBrowserContext.tabs.some(tab => tab.tabId === 3));
  assert.strictEqual(closed.after, null, 'closed tab must not be page-observed after removal');
  assert.strictEqual(closed.invariant.reObservedAfterExecution, true);
  assert.strictEqual(closeRuntime.stats().executePlanCalls, 0);
  assert.strictEqual(closeRuntime.stats().browserCalls, 1);

  await assert.rejects(() => runOneAction({
    runtime: makeRuntime(baseTabs, 1),
    agentAction: { type: 'openNewTab' }
  }), /openNewTab requires args.url/);

  console.log('Tab lifecycle one-action bridge contract: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
