'use strict';

const taskEl = document.getElementById('task');
const statusEl = document.getElementById('status');
const rawStatusEl = document.getElementById('rawStatus');
const previewEl = document.getElementById('preview');
const sessionsEl = document.getElementById('sessions');

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ scope: 'TRAINING_COLLECTOR_V03', type, ...extra });
}

function showEpisode(state, error) {
  if (error) { statusEl.textContent = `Error: ${error}`; return; }
  const episode = state?.episode;
  statusEl.textContent = episode
    ? `${state.active ? 'Episode recording' : 'Episode stopped'}\n${episode.episodeId}\nTransitions: ${episode.transitions?.length || 0}\nOutcome: ${episode.finalOutcome?.status || '-'}`
    : 'No active task episode';
}

function showRaw(session, error) {
  if (error) { rawStatusEl.textContent = `Raw session error: ${error}`; return; }
  if (!session) { rawStatusEl.textContent = 'Raw session unavailable'; return; }
  rawStatusEl.textContent = [
    `Session: ${session.sessionId}`,
    `Schema: ${session.schemaVersion || '-'}`,
    `Storage: ${session.storageBackend || '-'}`,
    `Status: ${session.status}`,
    `Events: ${session.eventCount || 0}`,
    `Chunks: ${session.chunkCount || 0}`,
    `Started: ${session.startedAt || '-'}`,
    `Last seen: ${session.lastSeenAt || '-'}`
  ].join('\n');
}

function sessionText(session) {
  const auto = session.autoExport || {};
  return [
    session.sessionId,
    `status=${session.status} events=${session.eventCount || 0} chunks=${session.chunkCount || 0}`,
    `autoExport=${auto.status || '-'} attempts=${auto.attempts || 0}`,
    auto.downloadId != null ? `downloadId=${auto.downloadId} downloadState=${auto.downloadState || '-'}` : null,
    auto.error ? `error=${auto.error}` : null
  ].filter(Boolean).join('\n');
}

async function loadSessions() {
  const res = await send('GET_RECENT_RAW_SESSIONS');
  sessionsEl.textContent = '';
  if (!res?.ok) {
    sessionsEl.textContent = `Error: ${res?.error || 'session_list_failed'}`;
    return;
  }
  const rows = Array.isArray(res.sessions) ? res.sessions : [];
  if (!rows.length) {
    sessionsEl.textContent = 'No raw sessions found';
    return;
  }
  for (const session of rows) {
    const row = document.createElement('div');
    row.className = 'session-row';
    const text = document.createElement('div');
    text.textContent = sessionText(session);
    row.appendChild(text);
    if (session.status !== 'active' && Number(session.eventCount || 0) > 0 && session.autoExport?.status !== 'complete') {
      const retry = document.createElement('button');
      retry.textContent = 'Retry Auto Export';
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        retry.textContent = 'Retrying...';
        try {
          const result = await send('RETRY_AUTO_EXPORT', { sessionId: session.sessionId });
          if (!result?.ok || result.result?.ok === false) throw new Error(result?.result?.error || result?.error || 'retry_failed');
          await loadSessions();
        } catch (error) {
          retry.textContent = `Failed: ${String(error?.message || error)}`;
          retry.disabled = false;
        }
      });
      row.appendChild(retry);
    }
    sessionsEl.appendChild(row);
  }
}

async function refresh() {
  const res = await send('GET_STATE');
  showEpisode(res.state, res.error);
  showRaw(res.rawSession, res.error);
  await loadSessions();
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

async function exportRaw() {
  if (typeof CompressionStream !== 'function') throw new Error('CompressionStream is unavailable in this Chrome version');
  rawStatusEl.textContent = 'Streaming IndexedDB chunks to JSONL.gz...';
  const metaRes = await send('GET_RAW_EXPORT_META');
  if (!metaRes?.ok || !metaRes.data?.session) throw new Error(metaRes?.error || 'export_meta_failed');
  const meta = metaRes.data;
  const session = meta.session;
  const compressor = new CompressionStream('gzip');
  const writer = compressor.writable.getWriter();
  const blobPromise = new Response(compressor.readable, { headers: { 'Content-Type': 'application/gzip' } }).blob();
  const encoder = new TextEncoder();

  await writer.write(encoder.encode(`${JSON.stringify({
    recordType: 'session',
    exportVersion: session.schemaVersion || meta.exportVersion || '0.7.0',
    exportedAt: meta.exportedAt || new Date().toISOString(),
    session
  })}\n`));

  const chunkCount = Number(session.chunkCount || 0);
  for (let i = 0; i < chunkCount; i += 1) {
    rawStatusEl.textContent = `Streaming chunk ${i + 1}/${chunkCount}...`;
    const chunkRes = await send('GET_RAW_EXPORT_CHUNK', { sessionId: session.sessionId, chunkIndex: i });
    if (!chunkRes?.ok || !chunkRes.data) throw new Error(chunkRes?.error || `export_chunk_${i}_failed`);
    for (const event of chunkRes.data.events || []) {
      await writer.write(encoder.encode(`${JSON.stringify({ recordType: 'event', ...event })}\n`));
    }
  }

  await writer.close();
  const blob = await blobPromise;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `training-collector-${session.sessionId || Date.now()}.raw.jsonl.gz`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  rawStatusEl.textContent = `Exported ${session.eventCount || 0} events as JSONL.gz`;
  showRaw(session);
}

document.getElementById('previewRaw').addEventListener('click', () => previewRaw().catch(error => {
  previewEl.hidden = false;
  previewEl.textContent = String(error?.message || error);
}));
document.getElementById('exportRaw').addEventListener('click', () => exportRaw().catch(error => showRaw(null, String(error?.message || error))));
document.getElementById('refreshSessions').addEventListener('click', () => loadSessions().catch(error => { sessionsEl.textContent = String(error?.message || error); }));

document.getElementById('start').addEventListener('click', async () => {
  const instruction = taskEl.value.trim();
  const res = await send('START_EPISODE', { task: { instruction, type: 'unspecified', args: {} } });
  showEpisode(res.state, res.error);
  const raw = await send('GET_RAW_STATUS');
  showRaw(raw.session, raw.error);
});

document.getElementById('success').addEventListener('click', async () => showEpisode((await send('STOP_EPISODE', { outcome: { status: 'success' } })).state));
document.getElementById('failed').addEventListener('click', async () => showEpisode((await send('STOP_EPISODE', { outcome: { status: 'failed' } })).state));
document.getElementById('stop').addEventListener('click', async () => showEpisode((await send('STOP_EPISODE', { outcome: { status: 'stopped' } })).state));

refresh().catch(error => {
  const text = String(error?.message || error);
  showEpisode(null, text);
  showRaw(null, text);
  sessionsEl.textContent = text;
});
