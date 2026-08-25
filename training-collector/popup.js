'use strict';

const taskEl = document.getElementById('task');
const statusEl = document.getElementById('status');
const rawStatusEl = document.getElementById('rawStatus');
const previewEl = document.getElementById('preview');

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ scope: 'TRAINING_COLLECTOR_V03', type, ...extra });
}

function showEpisode(state, error) {
  if (error) {
    statusEl.textContent = `Error: ${error}`;
    return;
  }
  const episode = state?.episode;
  statusEl.textContent = episode
    ? `${state.active ? 'Episode recording' : 'Episode stopped'}\n${episode.episodeId}\nTransitions: ${episode.transitions?.length || 0}\nOutcome: ${episode.finalOutcome?.status || '-'}`
    : 'No active task episode';
}

function showRaw(session, error) {
  if (error) {
    rawStatusEl.textContent = `Raw session error: ${error}`;
    return;
  }
  if (!session) {
    rawStatusEl.textContent = 'Raw session unavailable';
    return;
  }
  rawStatusEl.textContent = [
    `Session: ${session.sessionId}`,
    `Schema: ${session.schemaVersion || '-'}`,
    `Status: ${session.status}`,
    `Events: ${session.eventCount || 0}`,
    `Chunks: ${session.chunkCount || 0}`,
    `Started: ${session.startedAt || '-'}`,
    `Last seen: ${session.lastSeenAt || '-'}`
  ].join('\n');
}

async function refresh() {
  const res = await send('GET_STATE');
  showEpisode(res.state, res.error);
  showRaw(res.rawSession, res.error);
}

async function previewRaw() {
  const res = await send('GET_RAW_PREVIEW', { limit: 80 });
  if (!res?.ok) {
    previewEl.hidden = false;
    previewEl.textContent = `Error: ${res?.error || 'preview_failed'}`;
    return;
  }
  previewEl.hidden = false;
  previewEl.textContent = JSON.stringify({ session: res.session, events: res.events }, null, 2);
  showRaw(res.session);
}

function toJsonl(data) {
  const lines = [JSON.stringify({
    recordType: 'session',
    exportVersion: '0.5.0',
    exportedAt: data.exportedAt || new Date().toISOString(),
    session: data.session || null
  })];
  for (const event of Array.isArray(data.events) ? data.events : []) {
    lines.push(JSON.stringify({ recordType: 'event', ...event }));
  }
  return `${lines.join('\n')}\n`;
}

async function exportRaw() {
  rawStatusEl.textContent = 'Preparing temporary JSONL debug export...';
  const res = await send('EXPORT_RAW_SESSION');
  if (!res?.ok || !res.data) {
    showRaw(null, res?.error || 'export_failed');
    return;
  }
  const jsonl = toJsonl(res.data);
  const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `training-collector-${res.data.session?.sessionId || Date.now()}.raw.jsonl`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showRaw(res.data.session);
}

document.getElementById('previewRaw').addEventListener('click', () => previewRaw().catch(error => {
  previewEl.hidden = false;
  previewEl.textContent = String(error?.message || error);
}));

document.getElementById('exportRaw').addEventListener('click', () => exportRaw().catch(error => showRaw(null, String(error?.message || error))));

document.getElementById('start').addEventListener('click', async () => {
  const instruction = taskEl.value.trim();
  const res = await send('START_EPISODE', { task: { instruction, type: 'unspecified', args: {} } });
  showEpisode(res.state, res.error);
  const raw = await send('GET_RAW_STATUS');
  showRaw(raw.session, raw.error);
});

document.getElementById('success').addEventListener('click', async () => {
  const res = await send('STOP_EPISODE', { outcome: { status: 'success' } });
  showEpisode(res.state, res.error);
});

document.getElementById('failed').addEventListener('click', async () => {
  const res = await send('STOP_EPISODE', { outcome: { status: 'failed' } });
  showEpisode(res.state, res.error);
});

document.getElementById('stop').addEventListener('click', async () => {
  const res = await send('STOP_EPISODE', { outcome: { status: 'stopped' } });
  showEpisode(res.state, res.error);
});

refresh().catch(error => {
  const text = String(error?.message || error);
  showEpisode(null, text);
  showRaw(null, text);
});
