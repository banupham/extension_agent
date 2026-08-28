'use strict';

const assert = require('assert');
const { createStrategy } = require('../../manager/strategy/index.js');
const { heuristicResolveSubgoalTask } = require('../../manager/mission/semantic_goal_resolver.js');
const { createTabContext } = require('../../extension/agent-runtime-extension/tab_context.js');
const { validateAgentAction } = require('../../manager/strategy/agent_action_contract.js');
const { executeBoundedEpisodeLoop } = require('../../manager/agent/bounded_episode_loop.js');

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

function fallbackProvider() {
  return {
    name: 'fallback-test',
    version: '1',
    async decide() {
      return { status: 'blocked', confidence: 0.1, reasonCode: 'fallback_called' };
    }
  };
}

async function strategyChecks() {
  const strategy = createStrategy({ provider: fallbackProvider() });

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

function publicTab(tab) {
  return {
    tabId: tab.tabId,
    windowId: tab.windowId,
    active: tab.active,
    title: tab.title,
    url: tab.url
  };
}

function tabMatches(tab, match) {
  if (match.title != null && tab.title !== match.title) return false;
  if (match.titleIncludes != null && !tab.title.toLowerCase().includes(match.titleIncludes.toLowerCase())) return false;
  if (match.url != null && tab.url !== match.url) return false;
  if (match.urlIncludes != null && !tab.url.toLowerCase().includes(match.urlIncludes.toLowerCase())) return false;
  return true;
}

function episodeRuntime(initialTabs) {
  let tabs = initialTabs.map(tab => ({ ...tab }));
  let observationCounter = 0;
  return {
    async observe() {
      observationCounter += 1;
      const active = tabs.find(tab => tab.active) || tabs[0] || { title: '', url: '' };
      return {
        observationId: `episode-tab-obs-${observationCounter}`,
        url: active.url,
        title: active.title,
        viewport: { width: 1000, height: 700 },
        scroll: { x: 0, y: 0 },
        interactiveElements: []
      };
    },
    async listTabs() {
      return tabs.map(publicTab);
    },
    async executePlan() {
      throw new Error('tab lifecycle must not use PAGE_CDP');
    },
    async executeBrowserAction({ action }) {
      if (action.actionType === 'openNewTab') {
        for (const tab of tabs) tab.active = false;
        const created = {
          tabId: Math.max(0, ...tabs.map(tab => tab.tabId)) + 1,
          windowId: 10,
          active: true,
          title: 'Opened',
          url: action.args.url
        };
        tabs.push(created);
        return { ok: true, actionType: action.actionType, tab: publicTab(created) };
      }
      const matches = tabs.filter(tab => tabMatches(tab, action.args.match));
      if (matches.length !== 1) throw new Error('semantic tab target must be unique');
      const target = matches[0];
      if (action.actionType === 'switchTab') {
        for (const tab of tabs) if (tab.windowId === target.windowId) tab.active = false;
        target.active = true;
        return { ok: true, actionType: action.actionType, tab: publicTab(target) };
      }
      if (action.actionType === 'closeTab') {
        tabs = tabs.filter(tab => tab !== target);
        if (!tabs.some(tab => tab.active) && tabs[0]) tabs[0].active = true;
        return { ok: true, actionType: action.actionType, closedTab: publicTab(target) };
      }
      throw new Error(`unsupported:${action.actionType}`);
    }
  };
}

async function runTabEpisode(instruction, initialTabs, expectedAction) {
  const task = heuristicResolveSubgoalTask({
    subgoal: { subgoalId: `episode-${expectedAction}`, instruction },
    semantic: { goalKinds: [] }
  });
  const result = await executeBoundedEpisodeLoop({
    runtime: episodeRuntime(initialTabs),
    strategy: createStrategy({ provider: fallbackProvider() }),
    task,
    postActionSettle: false
  });
  assert.strictEqual(result.steps.length, 1);
  assert.strictEqual(result.steps[0].action.type, expectedAction);
  assert.strictEqual(result.steps[0].effect.status, 'effect_observed');
  assert.ok(result.steps[0].effect.meaningfulCodes.includes('browser_context_changed'));
  assert.strictEqual(result.finalOutcome.taskSucceeded, true);
  assert.strictEqual(result.finalBudget.reasonCode, 'goal_satisfied');
  assert.strictEqual(result.finalBudget.terminal, true);
  return result;
}

async function endToEndChecks() {
  const base = [
    { tabId: 1, windowId: 10, active: true, title: 'Alpha', url: 'https://alpha.example/' },
    { tabId: 2, windowId: 10, active: false, title: 'Google Search', url: 'https://www.google.com/' },
    { tabId: 3, windowId: 10, active: false, title: 'Disposable', url: 'https://disposable.example/' }
  ];
  await runTabEpisode('Chuyển sang tab Google', base, 'switchTab');
  await runTabEpisode('Mở tab mới https://example.com/docs', base, 'openNewTab');
  await runTabEpisode('Đóng tab Disposable', base, 'closeTab');
}

async function main() {
  await strategyChecks();
  goalChecks();
  await runtimeChecks();
  await endToEndChecks();
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
