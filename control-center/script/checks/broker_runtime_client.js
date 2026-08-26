'use strict';

const assert = require('assert');
const { createBrokerRuntimeClient } = require('../../manager/agent/broker_runtime_client.js');

class MockWebSocket {
  static OPEN = 1;
  constructor() {
    this.readyState = 0;
    this.sent = [];
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    });
  }
  send(text) {
    const msg = JSON.parse(text);
    this.sent.push(msg);
    if (msg.type !== 'command') return;
    queueMicrotask(() => {
      let result;
      if (msg.payload.action === 'agentListTabs') {
        result = { ok: true, tabs: [{ tabId: 7, active: true, title: 'Facebook', url: 'https://facebook.com/' }] };
      } else if (msg.payload.action === 'agentObserveTabs') {
        result = { ok: true, observations: [{ ok: true, tab: { tabId: 7 }, observation: { observationId: 'obs-7' } }] };
      } else if (msg.payload.action === 'agentObserve') {
        result = { ok: true, observation: { observationId: 'obs-1', interactiveElements: [] } };
      } else if (msg.payload.action === 'agentExecutePlan') {
        result = { ok: true, result: { ok: true, stepCount: msg.payload.data.plan.steps.length } };
      } else if (msg.payload.action === 'agentExecuteBrowserAction') {
        result = {
          ok: true,
          result: {
            ok: true,
            actionType: msg.payload.data.action.actionType,
            tab: { tabId: msg.payload.tabId, active: true, url: 'https://facebook.com/' }
          }
        };
      } else {
        result = { ok: true, runtimeVersion: '0.2.1' };
      }
      this.onmessage?.({ data: JSON.stringify({ type: 'result', commandId: msg.commandId, result }) });
    });
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

(async () => {
  const client = createBrokerRuntimeClient({
    url: 'ws://127.0.0.1:3000',
    agentId: 'runtime-test',
    timeoutMs: 1000,
    WebSocketImpl: MockWebSocket
  });

  const tabs = await client.listTabs({ mode: 'matching', hostname: 'facebook.com' });
  assert.strictEqual(tabs[0].tabId, 7);

  const scoped = await client.observeTabs({ mode: 'visible' });
  assert.strictEqual(scoped[0].observation.observationId, 'obs-7');

  const observation = await client.observe();
  assert.strictEqual(observation.observationId, 'obs-1');

  const execution = await client.executePlan({
    observationId: 'obs-1',
    plan: {
      cdpPlanVersion: '0.1.0',
      actionType: 'scrollVertical',
      steps: [{ delayMs: 0, method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', x: 10, y: 10, deltaY: 100, deltaX: 0 } }]
    }
  });
  assert.strictEqual(execution.stepCount, 1);

  const browserExecution = await client.executeBrowserAction({
    tabId: 7,
    action: { browserActionVersion: '0.1.0', actionType: 'switchTab', args: {} }
  });
  assert.strictEqual(browserExecution.ok, true);
  assert.strictEqual(browserExecution.actionType, 'switchTab');
  assert.strictEqual(browserExecution.tab.tabId, 7);

  const status = await client.status();
  assert.strictEqual(status.runtimeVersion, '0.2.1');

  client.close();
  console.log('Manager broker runtime client contract: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
