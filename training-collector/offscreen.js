'use strict';

const OFFSCREEN_SCOPE = 'TRAINING_COLLECTOR_OFFSCREEN_V06';
const RUNTIME_SCOPE = 'TRAINING_COLLECTOR_V03';

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ scope: RUNTIME_SCOPE, type, ...extra });
}

function safeName(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function exportSession(sessionId) {
  if (typeof CompressionStream !== 'function') throw new Error('CompressionStream unavailable');
  const metaRes = await send('GET_RAW_EXPORT_META', { sessionId });
  if (!metaRes?.ok || !metaRes.data?.session) throw new Error(metaRes?.error || 'export_meta_failed');

  const meta = metaRes.data;
  const session = meta.session;
  const compressor = new CompressionStream('gzip');
  const writer = compressor.writable.getWriter();
  const blobPromise = new Response(compressor.readable, {
    headers: { 'Content-Type': 'application/gzip' }
  }).blob();
  const encoder = new TextEncoder();

  await writer.write(encoder.encode(`${JSON.stringify({
    recordType: 'session',
    exportVersion: session.schemaVersion || meta.exportVersion || '0.7.0',
    exportedAt: meta.exportedAt || new Date().toISOString(),
    autoExport: true,
    session
  })}\n`));

  const chunkCount = Number(session.chunkCount || 0);
  for (let i = 0; i < chunkCount; i += 1) {
    const chunkRes = await send('GET_RAW_EXPORT_CHUNK', { sessionId: session.sessionId, chunkIndex: i });
    if (!chunkRes?.ok || !chunkRes.data) throw new Error(chunkRes?.error || `export_chunk_${i}_failed`);
    for (const event of chunkRes.data.events || []) {
      await writer.write(encoder.encode(`${JSON.stringify({ recordType: 'event', ...event })}\n`));
    }
  }

  await writer.close();
  const blob = await blobPromise;
  const url = URL.createObjectURL(blob);
  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename: `training-collector/training-collector-${safeName(session.sessionId)}.raw.jsonl.gz`,
      conflictAction: 'uniquify',
      saveAs: false
    });
    return { ok: true, downloadId, byteLength: blob.size, eventCount: Number(session.eventCount || 0) };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.scope !== OFFSCREEN_SCOPE || message.type !== 'AUTO_EXPORT_SESSION') return false;
  exportSession(message.sessionId)
    .then(sendResponse)
    .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});
