'use strict';

const CLIENT_VERSION = '0.1.1';

function resolveWebSocketImpl(options) {
  if (options?.WebSocketImpl) return options.WebSocketImpl;
  // Native manager runtime depends on control-center/package.json -> ws.
  // Tests can inject a mock without requiring ws at module-load time.
  return require('ws');
}

function createBrokerRuntimeClient(options = {}) {
  const url = options.url || 'ws://127.0.0.1:3000';
  const targetAgentId = options.agentId || null;
  const timeoutMs = Number(options.timeoutMs || 10000);
  const WebSocketImpl = resolveWebSocketImpl(options);
  let socket = null;
  let connected = false;
  let sequence = 0;
  const pending = new Map();

  function commandId() {
    sequence += 1;
    return `agent-runtime-${Date.now()}-${sequence}`;
  }

  function cleanupPending(error) {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  }

  async function connect() {
    if (connected && socket?.readyState === WebSocketImpl.OPEN) return;
    await new Promise((resolve, reject) => {
      socket = new WebSocketImpl(url);
      const timer = setTimeout(() => reject(new Error('broker_connect_timeout')), timeoutMs);
      socket.onopen = () => {
        clearTimeout(timer);
        connected = true;
        socket.send(JSON.stringify({ type: 'register', role: 'web', agentId: targetAgentId || undefined }));
        resolve();
      };
      socket.onerror = error => {
        clearTimeout(timer);
        if (!connected) reject(error instanceof Error ? error : new Error('broker_connect_error'));
      };
      socket.onclose = () => {
        connected = false;
        cleanupPending(new Error('broker_connection_closed'));
      };
      socket.onmessage = event => {
        let message;
        try { message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString()); }
        catch (_) { return; }
        const id = message.commandId;
        if (!id || !pending.has(id)) return;
        const item = pending.get(id);
        pending.delete(id);
        clearTimeout(item.timer);
        if (message.type === 'error') item.reject(new Error(message.message || 'broker_command_error'));
        else if (message.type === 'result') item.resolve(message.result);
      };
    });
  }

  async function sendCommand(payload) {
    await connect();
    if (!socket || socket.readyState !== WebSocketImpl.OPEN) throw new Error('broker_not_connected');
    const id = commandId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('broker_command_timeout'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ type: 'command', commandId: id, agentId: targetAgentId || undefined, payload }));
    });
  }

  async function observe(tabId = null) {
    const result = await sendCommand({ action: 'agentObserve', tabId: Number.isInteger(Number(tabId)) ? Number(tabId) : undefined });
    if (!result?.ok || !result?.observation) throw new Error(result?.error || 'agent_observe_failed');
    return result.observation;
  }

  async function executePlan({ observationId, plan, tabId = null }) {
    const result = await sendCommand({
      action: 'agentExecutePlan',
      tabId: Number.isInteger(Number(tabId)) ? Number(tabId) : undefined,
      data: { observationId, plan }
    });
    if (!result?.ok) throw new Error(result?.error || 'agent_execute_plan_failed');
    return result.result || result;
  }

  async function status(tabId = null) {
    return sendCommand({ action: 'agentStatus', tabId: Number.isInteger(Number(tabId)) ? Number(tabId) : undefined });
  }

  function close() {
    cleanupPending(new Error('broker_client_closed'));
    connected = false;
    try { socket?.close(); } catch (_) {}
    socket = null;
  }

  return {
    clientVersion: CLIENT_VERSION,
    connect,
    close,
    sendCommand,
    observe,
    executePlan,
    status
  };
}

module.exports = { CLIENT_VERSION, resolveWebSocketImpl, createBrokerRuntimeClient };
