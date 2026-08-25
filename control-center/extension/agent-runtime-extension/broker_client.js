'use strict';

(function initAgentBroker(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AgentBrokerClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const DEFAULT_SERVER = 'ws://127.0.0.1:3000';
  const DEFAULT_HEALTH = 'http://127.0.0.1:3000/health';

  function createClient(options = {}) {
    const server = options.server || DEFAULT_SERVER;
    const healthUrl = options.healthUrl || DEFAULT_HEALTH;
    const role = 'extension';
    const reconnectMin = Number(options.reconnectMin || 3000);
    const reconnectMax = Number(options.reconnectMax || 30000);
    const heartbeatMs = Number(options.heartbeatMs || 20000);
    const handleCommand = options.handleCommand;
    const getIdentity = options.getIdentity;
    const getMeta = options.getMeta;
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const WebSocketImpl = options.WebSocketImpl || globalThis.WebSocket;
    const log = typeof options.log === 'function' ? options.log : () => {};

    if (typeof handleCommand !== 'function') throw new Error('broker handleCommand required');
    if (typeof getIdentity !== 'function') throw new Error('broker getIdentity required');
    if (typeof getMeta !== 'function') throw new Error('broker getMeta required');

    let socket = null;
    let reconnectDelay = reconnectMin;
    let reconnectTimer = null;
    let heartbeatTimer = null;
    let connecting = false;

    function isOpen() { return socket && socket.readyState === WebSocketImpl.OPEN; }
    function send(payload) {
      if (!isOpen()) return false;
      try { socket.send(JSON.stringify(payload)); return true; }
      catch (_) { return false; }
    }
    function stopHeartbeat() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    function startHeartbeat() {
      stopHeartbeat();
      heartbeatTimer = setInterval(() => send({ type: 'heartbeat', role, ts: Date.now() }), heartbeatMs);
    }
    function scheduleReconnect() {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const delay = reconnectDelay;
      reconnectDelay = Math.min(reconnectMax, reconnectDelay * 2);
      reconnectTimer = setTimeout(connect, delay);
    }
    async function healthReady() {
      if (typeof fetchImpl !== 'function') return true;
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 1200) : null;
      try {
        const response = await fetchImpl(healthUrl, { method: 'GET', cache: 'no-store', signal: controller?.signal });
        return !!response?.ok;
      } catch (_) { return false; }
      finally { if (timer) clearTimeout(timer); }
    }
    async function register() {
      const identity = await getIdentity();
      const meta = await getMeta();
      send({ type: 'register', role, agentId: identity.agentId, meta: { ...meta, label: identity.label || '' } });
    }
    async function onMessage(event) {
      let message;
      try { message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)); }
      catch (_) { return; }
      if (message.type === 'heartbeat') {
        send({ type: 'heartbeat_ack', role, ts: Date.now() });
        return;
      }
      if (message.type !== 'command') return;
      try {
        const result = await handleCommand(message.payload || {});
        send({ type: 'result', commandId: message.commandId, result });
      } catch (error) {
        send({ type: 'result', commandId: message.commandId, result: { ok: false, error: String(error?.message || error) } });
      }
    }
    async function connect() {
      if (connecting || isOpen() || socket?.readyState === WebSocketImpl.CONNECTING) return;
      connecting = true;
      const ready = await healthReady();
      connecting = false;
      if (!ready) { scheduleReconnect(); return; }
      socket = new WebSocketImpl(server);
      socket.onopen = async () => {
        reconnectDelay = reconnectMin;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        await register();
        startHeartbeat();
        log('agent-runtime broker connected');
      };
      socket.onmessage = onMessage;
      socket.onerror = () => {};
      socket.onclose = () => {
        stopHeartbeat();
        socket = null;
        scheduleReconnect();
      };
    }
    function close() {
      stopHeartbeat();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      try { socket?.close(); } catch (_) {}
      socket = null;
    }
    function status() {
      return { connected: isOpen(), server, reconnectDelay };
    }

    return { connect, close, status, send };
  }

  return { DEFAULT_SERVER, DEFAULT_HEALTH, createClient };
});
