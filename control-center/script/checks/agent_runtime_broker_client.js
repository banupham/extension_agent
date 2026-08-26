'use strict';

const assert = require('assert');
const { createClient } = require('../../extension/agent-runtime-extension/broker_client.js');

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.sent = [];
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    });
  }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; this.onclose?.({}); }
  emit(payload) { this.onmessage?.({ data: JSON.stringify(payload) }); }
}
MockWebSocket.instances = [];

const commands = [];
const middlewareCalls = [];
const client = createClient({
  server: 'ws://127.0.0.1:3000',
  healthUrl: 'http://127.0.0.1:3000/health',
  fetchImpl: async () => ({ ok: true }),
  WebSocketImpl: MockWebSocket,
  heartbeatMs: 60000,
  reconnectMin: 60000,
  reconnectMax: 60000,
  getIdentity: async () => ({ agentId: 'runtime-test', label: 'Runtime Test' }),
  getMeta: async () => ({ product: 'agent-runtime', runtimeVersion: '0.2.0' }),
  commandMiddleware: async (payload, next) => {
    middlewareCalls.push(payload.action);
    if (payload.action === 'agentExecuteBrowserAction') {
      return { ok: true, result: { ok: true, actionType: payload.data.action.actionType } };
    }
    return next(payload);
  },
  handleCommand: async payload => { commands.push(payload); return { ok: true, echoed: payload.action }; }
});

(async () => {
  await client.connect();
  await new Promise(resolve => setTimeout(resolve, 5));
  const ws = MockWebSocket.instances[0];
  assert(ws);
  assert.strictEqual(client.status().connected, true);
  const registration = ws.sent.find(x => x.type === 'register');
  assert(registration);
  assert.strictEqual(registration.role, 'extension');
  assert.strictEqual(registration.agentId, 'runtime-test');
  assert.strictEqual(registration.meta.product, 'agent-runtime');

  ws.emit({ type: 'command', commandId: 'c1', payload: { action: 'agentObserve' } });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.strictEqual(commands.length, 1);
  assert.deepStrictEqual(middlewareCalls, ['agentObserve']);
  const result = ws.sent.find(x => x.type === 'result' && x.commandId === 'c1');
  assert(result);
  assert.strictEqual(result.result.echoed, 'agentObserve');

  ws.emit({
    type: 'command',
    commandId: 'c2',
    payload: {
      action: 'agentExecuteBrowserAction',
      tabId: 7,
      data: { action: { browserActionVersion: '0.1.0', actionType: 'switchTab', args: {} } }
    }
  });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepStrictEqual(middlewareCalls, ['agentObserve', 'agentExecuteBrowserAction']);
  assert.strictEqual(commands.length, 1, 'intercepted browser action must not fall through to CDP/background handler');
  const browserResult = ws.sent.find(x => x.type === 'result' && x.commandId === 'c2');
  assert(browserResult);
  assert.strictEqual(browserResult.result.result.actionType, 'switchTab');

  ws.emit({ type: 'heartbeat', ts: Date.now() });
  await new Promise(resolve => setTimeout(resolve, 1));
  assert(ws.sent.some(x => x.type === 'heartbeat_ack'));

  client.close();
  console.log('Agent Runtime broker client contract: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
