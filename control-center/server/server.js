const http = require('http');
const WebSocket = require('ws');

const HOST = process.env.WS_HOST || '127.0.0.1';
const PORT = Number(process.env.WS_PORT || 3000);
const HEARTBEAT_INTERVAL = 20000;
const STALE_AFTER = 65000;

const extensions = new Map(); // agentId -> ws
const clients = new Set();
const pending = new Map(); // commandId -> { owner, agentId }

function isOpen(ws) { return ws && ws.readyState === WebSocket.OPEN; }
function sendJson(ws, payload) {
  if (!isOpen(ws)) return false;
  try { ws.send(JSON.stringify(payload)); return true; }
  catch (e) { console.error('Send error:', e.message); return false; }
}
function agentsSnapshot() {
  return [...extensions.entries()].map(([agentId, ws]) => ({
    agentId,
    connected: isOpen(ws),
    connectedAt: ws.connectedAt || null,
    lastSeen: ws.lastSeen || null,
    meta: ws.meta || {}
  })).filter(x => x.connected);
}

const httpServer = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true, websocket: true, brokerVersion: 3, agents: agentsSnapshot().length }));
    return;
  }
  if (req.method === 'GET' && req.url === '/agents') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true, brokerVersion: 3, agents: agentsSnapshot() }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: 'Not found' }));
});

const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws, req) => {
  ws.role = null;
  ws.agentId = null;
  ws.lastSeen = Date.now();
  ws.connectedAt = new Date().toISOString();
  console.log('🔌 Client connected:', req.socket.remoteAddress || 'unknown');

  ws.on('message', raw => {
    ws.lastSeen = Date.now();
    let data;
    try { data = JSON.parse(raw.toString()); }
    catch (_) { return sendJson(ws, { type: 'error', message: 'Invalid JSON' }); }

    if (data.type === 'heartbeat' || data.type === 'heartbeat_ack') {
      if (data.type === 'heartbeat') sendJson(ws, { type: 'heartbeat_ack', ts: Date.now() });
      return;
    }

    if (data.type === 'register' && data.role === 'extension') {
      const agentId = String(data.agentId || '').trim();
      if (!agentId) return sendJson(ws, { type: 'error', message: 'agentId is required for extension registration' });
      const older = extensions.get(agentId);
      if (older && older !== ws && isOpen(older)) {
        sendJson(older, { type: 'status', message: 'Replaced by newer connection for same agentId' });
        try { older.close(4001, 'replaced'); } catch (_) {}
      }
      ws.role = 'extension';
      ws.agentId = agentId;
      ws.meta = data.meta || {};
      extensions.set(agentId, ws);
      console.log(`✅ Extension connected agent=${agentId}`);
      sendJson(ws, { type: 'status', message: 'Extension ready', agentId });
      for (const c of clients) sendJson(c, { type: 'agents', agents: agentsSnapshot() });
      return;
    }

    if (data.type === 'register' && data.role === 'web') {
      ws.role = 'web';
      ws.targetAgentId = data.agentId ? String(data.agentId) : null;
      clients.add(ws);
      const ready = ws.targetAgentId ? isOpen(extensions.get(ws.targetAgentId)) : agentsSnapshot().length === 1;
      sendJson(ws, { type: 'status', message: ready ? 'Extension ready' : 'Waiting for selected extension', agentId: ws.targetAgentId || null });
      return;
    }

    if (data.type === 'result' && ws.role === 'extension') {
      const item = pending.get(data.commandId);
      if (item && item.agentId === ws.agentId) {
        pending.delete(data.commandId);
        sendJson(item.owner, data);
      }
      return;
    }

    if (data.type === 'status' && ws.role === 'extension') {
      ws.meta = { ...(ws.meta || {}), ...(data.meta || {}), tabs: data.tabs || ws.meta?.tabs || [] };
      for (const c of clients) sendJson(c, { ...data, agentId: ws.agentId });
      return;
    }

    if (data.type === 'command' && clients.has(ws)) {
      if (!data.commandId) return sendJson(ws, { type: 'error', message: 'commandId is required' });
      let agentId = data.agentId || ws.targetAgentId;
      if (!agentId) {
        const current = agentsSnapshot();
        if (current.length === 1) agentId = current[0].agentId;
      }
      agentId = agentId ? String(agentId) : '';
      const ext = extensions.get(agentId);
      if (!agentId || !isOpen(ext)) return sendJson(ws, { type: 'error', commandId: data.commandId, message: 'Selected extension is not connected' });
      if (pending.has(data.commandId)) return sendJson(ws, { type: 'error', commandId: data.commandId, message: 'Duplicate commandId' });
      pending.set(data.commandId, { owner: ws, agentId });
      if (!sendJson(ext, { type: 'command', commandId: data.commandId, payload: data.payload })) {
        pending.delete(data.commandId);
        sendJson(ws, { type: 'error', commandId: data.commandId, message: 'Could not send command to extension' });
      }
      return;
    }

    sendJson(ws, { type: 'error', message: 'Unregistered or unsupported message' });
  });

  ws.on('close', (code, reason) => {
    console.log(`🔌 Socket closed role=${ws.role || 'unregistered'} code=${code} reason=${reason?.toString() || 'none'}`);
    if (ws.role === 'extension' && ws.agentId && extensions.get(ws.agentId) === ws) {
      extensions.delete(ws.agentId);
      for (const c of clients) sendJson(c, { type: 'agents', agents: agentsSnapshot() });
    }
    clients.delete(ws);
    for (const [id, item] of pending) if (item.owner === ws) pending.delete(id);
  });
  ws.on('error', err => console.error('WebSocket client error:', err.message));
});

setInterval(() => {
  const now = Date.now();
  for (const [agentId, ext] of [...extensions]) {
    if (!isOpen(ext)) { extensions.delete(agentId); continue; }
    if (now - (ext.lastSeen || 0) > STALE_AFTER) {
      console.warn(`⚠️ Extension heartbeat stale agent=${agentId}; terminating`);
      ext.terminate();
    } else sendJson(ext, { type: 'heartbeat', ts: now });
  }
  for (const c of [...clients]) if (!isOpen(c)) clients.delete(c);
}, HEARTBEAT_INTERVAL);

httpServer.listen(PORT, HOST, () => {
  console.log(`✅ Broker v3 health: http://${HOST}:${PORT}/health`);
  console.log(`✅ Broker v3 agents: http://${HOST}:${PORT}/agents`);
  console.log(`✅ WebSocket broker: ws://${HOST}:${PORT}`);
});
httpServer.on('error', err => { console.error('Server error:', err.message); process.exitCode = 1; });
