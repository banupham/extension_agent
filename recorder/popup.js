const $ = id => document.getElementById(id);
let currentTabId = null;
let lastRecording = null;
const IDLE_WAIT_THRESHOLD_MS = 1200;

function status(text, cls = '') {
  const el = $('status');
  el.textContent = text;
  el.className = `status ${cls}`.trim();
}
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Không tìm thấy tab đang mở');
  return tab;
}
async function bg(cmd, extra = {}) { return chrome.runtime.sendMessage({ scope: 'BAR_V3', cmd, ...extra }); }
function slug(s) {
  return String(s || 'recorded-scenario').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'recorded-scenario';
}
function n(v, fallback = 0) { const x = Number(v); return Number.isFinite(x) ? x : fallback; }
function eventEnd(ev) { return n(ev?.tEnd ?? ev?.t, 0); }
function exactGap(current, previous) {
  const currentT = n(current?.t, 0);
  if (!previous) return Math.max(0, currentT);
  return Math.max(0, Math.round(currentT - eventEnd(previous)));
}
function effectiveStartUrl(recording) {
  const original = String(recording?.url || '');
  if (/^https?:\/\//i.test(original)) return original;
  const firstNav = (recording?.events || []).find(ev => ev?.type === 'navigation' && /^https?:\/\//i.test(String(ev.url || '')));
  return firstNav ? String(firstNav.url) : original;
}
function compactTarget(ev) {
  return {
    tag: ev.tag || null,
    text: ev.text || null,
    selectors: Array.isArray(ev.selectors) ? ev.selectors : [ev.selector].filter(Boolean),
    rect: ev.rect || null,
    attributes: ev.attributes || null
  };
}
function recordedMeta(ev, gapMs) {
  return {
    seq: ev.seq ?? null,
    eventType: ev.type || null,
    atMs: n(ev.t, 0),
    gapFromPreviousMs: n(ev.gapFromPreviousMs, gapMs),
    pageUrl: ev.pageUrl || null,
    target: compactTarget(ev),
    pointerGesture: ev.pointerGesture || null,
    mousePath: ev.mousePath || null,
    editTrace: ev.editTrace || null,
    reconstruction: ev.reconstruction || null,
    scrollTrace: ev.scrollTrace || null,
    keyboard: ['key', 'keyCombo'].includes(ev.type) ? {
      key: ev.key || null,
      code: ev.code || null,
      location: ev.location ?? null,
      repeat: !!ev.repeat,
      modifiers: ev.modifiers || null
    } : null
  };
}
function timingMeta(gapMs) {
  return {
    recordedGapMs: gapMs,
    kind: gapMs >= IDLE_WAIT_THRESHOLD_MS ? 'idle' : (gapMs >= 350 ? 'transition' : 'immediate'),
    randomizable: true
  };
}
function addGap(interactions, action, gapMs, recorded) {
  const gap = Math.max(0, Math.round(n(gapMs, 0)));
  if (gap >= IDLE_WAIT_THRESHOLD_MS) {
    interactions.push({
      action: 'wait',
      ms: gap,
      delay: 0,
      timing: { recordedGapMs: gap, kind: 'idle', randomizable: true },
      recorded: { kind: 'idle-gap', ...(recorded || {}) }
    });
    action.delay = 0;
  } else {
    action.delay = gap;
  }
  action.timing = timingMeta(gap);
  interactions.push(action);
}
function pushTimed(interactions, action, ev, anchor) {
  const gapMs = exactGap(ev, anchor);
  addGap(interactions, action, gapMs, {
    beforeSeq: ev.seq ?? null,
    beforeEventType: ev.type || null,
    fromSeq: anchor?.seq ?? null
  });
  action.recorded = recordedMeta(ev, gapMs);
}
function opAction(op) {
  if (op.kind === 'type') return { action: 'type', text: String(op.text ?? '') };
  if (op.kind === 'pressKey') return { action: 'pressKey', key: String(op.key || '') };
  if (op.kind === 'keyCombo') return { action: 'keyCombo', keys: Array.isArray(op.keys) ? op.keys : [] };
  return null;
}
function pushTextEdit(interactions, ev, anchor) {
  const selector = ev.selector || (Array.isArray(ev.selectors) ? ev.selectors[0] : null);
  const trace = ev.editTrace || {};
  const ops = Array.isArray(trace.operations) ? trace.operations : [];
  const reconstructable = ev.reconstruction?.reconstructable === true && ops.length > 0;

  if (!reconstructable) {
    pushTimed(interactions, {
      action: 'replaceText',
      selector,
      text: String(ev.finalValue ?? '')
    }, ev, anchor);
    interactions[interactions.length - 1].recorded.textReplayMode = 'replaceText-fallback';
    return { t: eventEnd(ev), seq: ev.seq };
  }

  let opAnchor = anchor;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const action = opAction(op);
    if (!action) continue;
    const virtual = {
      t: n(op.t, n(ev.t, 0)),
      tEnd: n(op.t, n(ev.t, 0)),
      seq: ev.seq,
      type: `text-op:${op.kind}`
    };
    const gapMs = exactGap(virtual, opAnchor);
    addGap(interactions, action, gapMs, {
      kind: 'text-operation-gap',
      parentSeq: ev.seq ?? null,
      operationIndex: i,
      operationKind: op.kind
    });
    action.recorded = {
      parentSeq: ev.seq ?? null,
      eventType: 'textEditRecorded',
      textReplayMode: 'keyboard-operations',
      operationIndex: i,
      operation: op,
      target: compactTarget(ev),
      editSummary: trace.summary || null,
      initialValue: ev.initialValue ?? trace.initialValue ?? null,
      finalValue: ev.finalValue ?? trace.finalValue ?? null
    };
    opAnchor = virtual;
  }
  return { t: eventEnd(ev), tEnd: eventEnd(ev), seq: ev.seq };
}

function toInteractions(recording) {
  const events = Array.isArray(recording?.events) ? recording.events : [];
  const startUrl = effectiveStartUrl(recording);
  let consumedStartNavigation = false;
  let timingAnchor = null;
  const interactions = [];

  for (const ev of events) {
    if (!ev || !ev.type) continue;

    if (ev.type === 'navigation') {
      if (!consumedStartNavigation && ev.url === startUrl && startUrl !== String(recording?.url || '')) {
        consumedStartNavigation = true;
        timingAnchor = ev;
        continue;
      }
      if (!['likely-click', 'likely-enter'].includes(ev.trigger) && ev.url) {
        pushTimed(interactions, { action: 'openUrl', url: ev.url, newTab: false }, ev, timingAnchor);
        timingAnchor = ev;
      }
      continue;
    }

    if (ev.type === 'clickRecorded') {
      const selectors = Array.isArray(ev.selectors) && ev.selectors.length ? ev.selectors : [ev.selector].filter(Boolean);
      pushTimed(interactions, {
        action: 'clickRecorded',
        selectors,
        texts: ev.text ? [String(ev.text).toLowerCase()] : [],
        point: { rx: n(ev.point?.rx, 0.5), ry: n(ev.point?.ry, 0.5) },
        fallback: {
          clientX: n(ev.clientX, 0), clientY: n(ev.clientY, 0),
          viewportWidth: n(ev.viewport?.width, 0), viewportHeight: n(ev.viewport?.height, 0)
        },
        mouseGesture: ev.mousePath?.metrics || null
      }, ev, timingAnchor);
      timingAnchor = ev;
      continue;
    }

    if (ev.type === 'textEditRecorded') {
      timingAnchor = pushTextEdit(interactions, ev, timingAnchor);
      continue;
    }

    // Legacy recordings remain import/export compatible.
    if (ev.type === 'replaceText') {
      pushTimed(interactions, {
        action: 'replaceText',
        selector: ev.selector || (Array.isArray(ev.selectors) ? ev.selectors[0] : null),
        text: ev.value || ''
      }, ev, timingAnchor);
      timingAnchor = ev;
      continue;
    }

    if (ev.type === 'setChecked') {
      pushTimed(interactions, {
        action: 'setChecked',
        selector: ev.selector || (Array.isArray(ev.selectors) ? ev.selectors[0] : null),
        checked: !!ev.checked
      }, ev, timingAnchor);
      timingAnchor = ev;
      continue;
    }

    if (ev.type === 'selectOption') {
      pushTimed(interactions, {
        action: 'selectOption',
        selector: ev.selector || (Array.isArray(ev.selectors) ? ev.selectors[0] : null),
        value: ev.value == null ? null : ev.value,
        text: ev.optionText || null,
        index: Number.isInteger(ev.index) ? ev.index : null
      }, ev, timingAnchor);
      timingAnchor = ev;
      continue;
    }

    if (ev.type === 'keyCombo') {
      pushTimed(interactions, { action: 'keyCombo', keys: Array.isArray(ev.keys) ? ev.keys : [] }, ev, timingAnchor);
      timingAnchor = ev;
      continue;
    }

    if (ev.type === 'key') {
      pushTimed(interactions, { action: 'pressKey', key: ev.key }, ev, timingAnchor);
      timingAnchor = ev;
      continue;
    }

    if (ev.type === 'scroll') {
      pushTimed(interactions, {
        action: 'scrollTo',
        x: Math.round(n(ev.x, 0)),
        y: Math.round(n(ev.y, 0)),
        gesture: ev.scrollTrace?.metrics || null
      }, ev, timingAnchor);
      timingAnchor = ev;
    }
  }

  return interactions;
}

function scenarioSource(recording) {
  const interactions = toInteractions(recording);
  const name = slug(recording?.title || 'recorded-scenario');
  const recordingMeta = {
    recorderVersion: recording?.recorderVersion || '4.0.0',
    timingModel: recording?.timingModel || 'detailed-input-mouse-v3',
    capturedAt: recording?.capturedAt || null,
    stoppedAt: recording?.stoppedAt || null,
    durationMs: n(recording?.durationMs, 0),
    sourceEventCount: Array.isArray(recording?.events) ? recording.events.length : 0,
    exportedActionCount: interactions.length,
    idleWaitThresholdMs: IDLE_WAIT_THRESHOLD_MS
  };
  return `const { runCheck } = require('./run_check');\n\nrunCheck({\n  name: ${JSON.stringify(name)},\n  url: ${JSON.stringify(effectiveStartUrl(recording))},\n  loadWaitMs: 3000,\n  resultWaitMs: 2000,\n  recordingMeta: ${JSON.stringify(recordingMeta, null, 2)},\n  interactions: ${JSON.stringify(interactions, null, 2)}\n});\n`;
}

const EXPORT_DB_NAME = 'bar-v3-export-db';
const EXPORT_STORE = 'handles';
const EXPORT_DIR_KEY = 'export-directory';
function openExportDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(EXPORT_DB_NAME, 1);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(EXPORT_STORE)) db.createObjectStore(EXPORT_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function getSavedExportDirectory() {
  const db = await openExportDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(EXPORT_STORE, 'readonly');
      const req = tx.objectStore(EXPORT_STORE).get(EXPORT_DIR_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}
async function saveExportDirectory(handle) {
  const db = await openExportDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(EXPORT_STORE, 'readwrite');
      tx.objectStore(EXPORT_STORE).put(handle, EXPORT_DIR_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
async function forgetExportDirectory() {
  const db = await openExportDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(EXPORT_STORE, 'readwrite');
      tx.objectStore(EXPORT_STORE).delete(EXPORT_DIR_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
async function ensureExportDirectory() {
  if (!window.showDirectoryPicker) return null;
  let handle = null;
  try { handle = await getSavedExportDirectory(); } catch { handle = null; }
  if (handle) {
    try {
      let permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission === 'prompt') permission = await handle.requestPermission({ mode: 'readwrite' });
      if (permission === 'granted') return handle;
    } catch { await forgetExportDirectory().catch(() => {}); }
  }
  const picked = await window.showDirectoryPicker({ id: 'browser-action-recorder-export', mode: 'readwrite', startIn: 'downloads' });
  await saveExportDirectory(picked);
  return picked;
}
async function downloadJs(filename, text) {
  if (window.showDirectoryPicker) {
    try {
      const dir = await ensureExportDirectory();
      if (dir) {
        const fileHandle = await dir.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(text);
        await writable.close();
        return { method: 'directory', directoryName: dir.name, filename };
      }
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      await forgetExportDirectory().catch(() => {});
    }
  }
  const blob = new Blob([text], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  await new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, saveAs: true }, id => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message)); else resolve(id);
    });
  });
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  return { method: 'downloads', filename };
}

$('start').addEventListener('click', async () => {
  try {
    const tab = await getActiveTab();
    currentTabId = tab.id;
    const r = await bg('start', { tabId: tab.id });
    if (!r?.ok) throw new Error(r?.error || 'Không thể bắt đầu');
    lastRecording = null;
    status('Đang ghi V4.0 • detailed keys, Backspace/Delete, mouse path, waits và gesture metrics.', 'recording');
  } catch (e) { status(`Lỗi: ${e.message}`, 'error'); }
});
$('stop').addEventListener('click', async () => {
  try {
    const tab = await getActiveTab();
    currentTabId = tab.id;
    const r = await bg('stop', { tabId: tab.id });
    if (!r?.ok) throw new Error(r?.error || 'Không thể dừng');
    lastRecording = r.recording;
    status(`Đã dừng • ${lastRecording?.events?.length || 0} sự kiện • ${Math.round(n(lastRecording?.durationMs, 0) / 100) / 10}s`, 'stopped');
  } catch (e) { status(`Lỗi: ${e.message}`, 'error'); }
});
$('exportJs').addEventListener('click', async () => {
  try {
    if (!lastRecording) {
      const r = await bg('lastRecording');
      lastRecording = r?.recording || null;
    }
    if (!lastRecording) throw new Error('Chưa có phiên ghi đã Stop');
    const interactions = toInteractions(lastRecording);
    const source = scenarioSource(lastRecording);
    const filename = `${slug(lastRecording.title)}.scenario.js`;
    const saved = await downloadJs(filename, source);
    const waits = interactions.filter(x => x.action === 'wait').length;
    const backspaces = interactions.filter(x => x.action === 'pressKey' && x.key === 'Backspace').length;
    const gestures = interactions.filter(x => x.action === 'scrollTo' && x.gesture).length;
    const where = saved?.method === 'directory' && saved.directoryName ? ` • ${saved.directoryName}` : '';
    status(`Đã tạo ${filename} • ${interactions.length} actions • ${backspaces} Backspace • ${waits} waits • ${gestures} scroll gestures${where}`, 'stopped');
  } catch (e) { status(`Lỗi: ${e.message}`, 'error'); }
});

(async () => {
  try {
    const tab = await getActiveTab();
    currentTabId = tab.id;
    const r = await bg('status', { tabId: tab.id });
    status(r?.active ? `Đang ghi • ${r.count || 0} sự kiện • Detailed Input V4.0` : 'Sẵn sàng. Start để ghi Detailed Input + Mouse Path V4.0.', r?.active ? 'recording' : 'stopped');
    const lr = await bg('lastRecording');
    lastRecording = lr?.recording || null;
  } catch (e) { status(`Lỗi: ${e.message}`, 'error'); }
})();
