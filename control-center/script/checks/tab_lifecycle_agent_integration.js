'use strict';

const assert = require('assert');
const { createStrategy } = require('../../manager/strategy/index.js');
const { heuristicResolveSubgoalTask } = require('../../manager/mission/semantic_goal_resolver.js');
const { createTabContext } = require('../../extension/agent-runtime-extension/tab_context.js');
const { validateAgentAction } = require('../../manager/strategy/agent_action_contract.js');

function observation() {
  return {
    observationId: 'obs-tab-integration',
    url: 'https://alpha.example/',
    title: 'Alpha',
    viewport: { width: 1000, height: 700 },
    scroll: { x: 0, y: 0 },
    interactiveElements: []
  };
}

async function strategyChecks() {
  const fallback = {
    name: 'fallback-test',
    version: '1',
    async decide() {
      return { status: 'blocked', confidence: 0.1, reasonCode: 'fallback_called' };
    }
  };
  const strategy = createStrategy({ provider: fallback });

  const switched = await strategy.decide({
    task: { instruction: 'Chuyển sang tab Google' },
    observation: observation(),
    browserContext: {
      tabs: [
        { tabId: 1, windowId: 10, active: true, title: 'Alpha', url: 'https://alpha.example/' },
        { tabId: 2, windowId: 10, active: false, title: 'Google Search', url: 'https://www.google.com/' }
      ]
    }
  });
  assert.strictEqual(switched.status, 'act');
  assert.strictEqual(switched.action.type, 'switchTab');
  assert.deepStrictEqual(switched.action.args.match, { titleIncludes: 'Google' });
  assert.strictEqual(switched.metadata.decisionSource, 'tab-lifecycle-provider');

  const closed = await strategy.decide({
    task: { instruction: 'Đóng tab Disposable' },
    observation: observation()
  });
  assert.strictEqual(closed.status, 'act');
  assert.strictEqual(closed.action.type, 'closeTab');
  assert.deepStrictEqual(closed.action.args.match, { titleIncludes: 'Disposable' });

  const opened = await strategy.decide({
    task: { instruction: 'Mở tab mới example.com/docs' },
    observation: observation()
  });
  assert.strictEqual(opened.status, 'act');
  assert.strictEqual(opened.action.type, 'openNewTab');
  assert.strictEqual(opened.action.args.url, 'https://example.com/docs');

  assert.throws(
    () => validateAgentAction({ type: 'switchTab', args: { tabId: 123 } }),
    /raw tabId\/windowId/
  );
}

function goalChecks() {
  const switchTask = heuristicResolveSubgoalTask({
    subgoal: { subgoalId: 'tab-switch', instruction: 'Chuyển sang tab Google' },
    semantic: { goalKinds: [] }
  });
  assert.strictEqual(switchTask.type, 'semantic-tab-lifecycle');
  assert.deepStrictEqual(switchTask.args, {
    tabAction: 'switchTab',
    tabMatch: { titleIncludes: 'Google' }
  });
  assert.deepStrictEqual(switchTask.successCriteria, [{
    type: 'browserTab',
    match: { titleIncludes: 'Google' },
    expect: { exists: true, active: true }
  }]);

  const closeTask = heuristicResolveSubgoalTask({
    subgoal: { subgoalId: 'tab-close', instruction: 'Đóng tab Disposable' },
    semantic: { goalKinds: [] }
  });
  assert.deepStrictEqual(closeTask.successCriteria[0].expect, { exists: false });

  const openTask = heuristicResolveSubgoalTask({
    subgoal: { subgoalId: 'tab-open', instruction: 'Mở tab mới https://example.com/docs' },
    semantic: { goalKinds: [] }
  });
  assert.strictEqual(openTask.args.tabAction, 'openNewTab');
  assert.strictEqual(openTask.successCriteria[0].type, 'browserTab');
  assert.strictEqual(openTask.successCriteria[0].expect.active, true);
}

async function runtimeChecks() {
  const tabs = [
    { id: 1, windowId: 10, active: true, title: 'Alpha', url: 'https://alpha.example/' },
    { id: 2, windowId: 10, active: false, title: 'Google Search', url: 'https://www.google.com/' },
    { id: 3, windowId: 10, active: false, title: 'Disposable', url: 'https://disposable.example/' }
  ];
  const chromeApi = {
    tabs: {
      async query(query) {
        if (query?.active && Number.isInteger(Number(query.windowId))) {
          return tabs.filter(tab => tab.active && tab.windowId === Number(query.windowId));
        }
        if (query?.active) return tabs.filter(tab => tab.active);
        return tabs.slice();
      },
      async get(tabId) { return tabs.find(tab => tab.id === Number(tabId)) || null; },
      async update(tabId, change) {
        const tab = tabs.find(item => item.id === Number(tabId));
        if (!tab) throw new Error('tab missing');
        if (change?.active) {
          for (const item of tabs) if (item.windowId === tab.windowId) item.active = false;
          tab.active = true;
        }
        return { ...tab };
      },
      async create(create) {
        for (const item of tabs) if (item.windowId === Number(create.windowId)) item.active = false;
        const tab = {
          id: Math.max(...tabs.map(item => item.id)) + 1,
          windowId: Number(create.windowId),
          active: create.active === true,
          title: 'Opened',
          url: create.url
        };
        tabs.push(tab);
        return { ...tab };
      },
      async remove(tabId) {
        const index = tabs.findIndex(tab => tab.id === Number(tabId));
        if (index < 0) throw new Error('tab missing');
        tabs.splice(index, 1);
      }
    },
    windows: {
      async getLastFocused() { return { id: 10 }; }
    }
  };

  const context = createTabContext(chromeApi);
  const switched = await context.executeBrowserAction({
    tabId: 1,
    action: { actionType: 'switchTab', args: { match: { titleIncludes: 'Google' } } }
  });
  assert.strictEqual(switched.tab.tabId, 2);
  assert.strictEqual(switched.tab.active, true);
  assert.strictEqual(switched.semanticTargeted, true);

  const closed = await context.executeBrowserAction({
    tabId: 2,
    action: { actionType: 'closeTab', args: { match: { titleIncludes: 'Disposable' } } }
  });
  assert.strictEqual(closed.closedTab.tabId, 3);
  assert.strictEqual(tabs.some(tab => tab.id === 3), false);

  const opened = await context.executeBrowserAction({
    tabId: 2,
    action: { actionType: 'openNewTab', args: { url: 'https://example.com/docs' } }
  });
  assert.strictEqual(opened.actionType, 'openNewTab');
  assert.strictEqual(opened.tab.url, 'https://example.com/docs');
}

async function main() {
  await strategyChecks();
  goalChecks();
  await runtimeChecks();
  console.log('Tab lifecycle Agent integration: PASS');
}

if (require.main === module) {
  main().catch(error => {
    console.error('Tab lifecycle Agent integration: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { main };
