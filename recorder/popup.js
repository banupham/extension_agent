const $ = id => document.getElementById(id);
let currentTabId = null;
let lastRecording = null;

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

async function bg(cmd, extra = {}) {
  return chrome.runtime.sendMessage({ scope: 'BAR_V3', cmd, ...extra });
}

function slug(s) {
  return String(s || 'recorded-scenario')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'recorded-scenario';
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function gap(current, previous, fallback = 300) {
  if (!previous) return fallback;
  const d = Math.round((current.t || 0) - (previous.tEnd || previous.t || 0));
  return clamp(d || fallback, 50, 5000);
}

function effectiveStartUrl(recording) {
  const original = String(recording?.url || '');
  if (/^https?:\/\//i.test(original)) return original;

  const firstNav = (recording?.events || []).find(ev =>
    ev?.type === 'navigation' && /^https?:\/\//i.test(String(ev.url || ''))
  );
  return firstNav ? String(firstNav.url) : original;
}

function toInteractions(recording) {
  const events = Array.isArray(recording?.events) ? recording.events : [];
  const startUrl = effectiveStartUrl(recording);
  let consumedStartNavigation = false;
  const interactions = [];
  let previous = null;

  for (const ev of events) {
    const delay = gap(ev, previous);

    if (ev.type === 'navigation') {
      // If recording started on chrome://newtab (or another internal page), promote
      // the first real web URL to runCheck.url instead of emitting a redundant openUrl.
      if (!consumedStartNavigation && ev.url === startUrl && startUrl !== String(recording?.url || '')) {
        consumedStartNavigation = true;
        previous = ev;
        continue;
      }

      // Click/Enter normally reproduces its own navigation during replay.
      if (!['likely-click', 'likely-enter'].includes(ev.trigger) && ev.url) {
        interactions.push({
          action: 'openUrl',
          url: ev.url,
          newTab: false,
          delay
        });
      }
      previous = ev;
      continue;
    }

    if (ev.type === 'clickRecorded') {
      const selectors = Array.isArray(ev.selectors) && ev.selectors.length
        ? ev.selectors
        : [ev.selector].filter(Boolean);

      interactions.push({
        action: 'clickRecorded',
        selectors,
        texts: ev.text ? [String(ev.text).toLowerCase()] : [],
        point: {
          rx: Number(ev.point?.rx ?? 0.5),
          ry: Number(ev.point?.ry ?? 0.5)
        },
        fallback: {
          clientX: Number(ev.clientX ?? 0),
          clientY: Number(ev.clientY ?? 0),
          viewportWidth: Number(ev.viewport?.width ?? 0),
          viewportHeight: Number(ev.viewport?.height ?? 0)
        },
        delay
      });
    }

    if (ev.type === 'replaceText') {
      interactions.push({
        action: 'replaceText',
        selector: ev.selector || (Array.isArray(ev.selectors) ? ev.selectors[0] : null),
        text: ev.value || '',
        delay
      });
    }

    if (ev.type === 'setChecked') {
      interactions.push({
        action: 'setChecked',
        selector: ev.selector || (Array.isArray(ev.selectors) ? ev.selectors[0] : null),
        checked: !!ev.checked,
        delay
      });
    }

    if (ev.type === 'selectOption') {
      interactions.push({
        action: 'selectOption',
        selector: ev.selector || (Array.isArray(ev.selectors) ? ev.selectors[0] : null),
        value: ev.value == null ? null : ev.value,
        text: ev.optionText || null,
        index: Number.isInteger(ev.index) ? ev.index : null,
        delay
      });
    }

    if (ev.type === 'keyCombo') {
      interactions.push({
        action: 'keyCombo',
        keys: Array.isArray(ev.keys) ? ev.keys : [],
        delay
      });
    }

    if (ev.type === 'key') {
      interactions.push({
        action: 'pressKey',
        key: ev.key,
        delay
      });
    }

    if (ev.type === 'scroll') {
      const x = Math.round(Number(ev.x) || 0);
      const y = Math.round(Number(ev.y) || 0);
      const last = interactions[interactions.length - 1];

      if (last && last.action === 'scrollTo') {
        // Same uninterrupted gesture/burst: keep the first delay but only the
        // final absolute destination.
        last.x = x;
        last.y = y;
      } else {
        interactions.push({
          action: 'scrollTo',
          x,
          y,
          delay
        });
      }
    }

    previous = ev;
  }

  return interactions;
}

function scenarioSource(recording) {
  const interactions = toInteractions(recording);
  const name = slug(recording?.title || 'recorded-scenario');

  return `const { runCheck } = require('./run_check');

runCheck({
  name: ${JSON.stringify(name)},
  url: ${JSON.stringify(effectiveStartUrl(recording))},
  loadWaitMs: 3000,
  resultWaitMs: 2000,
  interactions: ${JSON.stringify(interactions, null, 2)}
});
`;
}

const EXPORT_DB_NAME = 'bar-v3-export-db';
const EXPORT_STORE = 'handles';
const EXPORT_DIR_KEY = 'export-directory';

function openExportDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(EXPORT_DB_NAME, 1);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(EXPORT_STORE)) {
        db.createObjectStore(EXPORT_STORE);
      }
    };

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
  } finally {
    db.close();
  }
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
  } finally {
    db.close();
  }
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
  } finally {
    db.close();
  }
}

async function ensureExportDirectory() {
  if (!window.showDirectoryPicker) return null;

  let handle = null;
  try {
    handle = await getSavedExportDirectory();
  } catch {
    handle = null;
  }

  if (handle) {
    try {
      let permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission === 'prompt') {
        permission = await handle.requestPermission({ mode: 'readwrite' });
      }
      if (permission === 'granted') return handle;
    } catch {
      await forgetExportDirectory().catch(() => {});
    }
  }

  const picked = await window.showDirectoryPicker({
    id: 'browser-action-recorder-export',
    mode: 'readwrite',
    startIn: 'downloads'
  });

  await saveExportDirectory(picked);
  return picked;
}

async function downloadJs(filename, text) {
  // Preferred path: remember one directory and write directly on future exports.
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
      // AbortError = user cancelled the initial directory picker.
      if (e && e.name === 'AbortError') throw e;

      // If a saved handle became invalid, forget it so next attempt asks again.
      await forgetExportDirectory().catch(() => {});
    }
  }

  // Fallback for environments where File System Access API is unavailable.
  const blob = new Blob([text], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);

  await new Promise((resolve, reject) => {
    chrome.downloads.download({
      url,
      filename,
      saveAs: true
    }, id => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(id);
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
    status(`Đang ghi tab này. Có thể đổi URL hoặc reload mà không mất phiên ghi.`, 'recording');
  } catch (e) {
    status(`Lỗi: ${e.message}`, 'error');
  }
});

$('stop').addEventListener('click', async () => {
  try {
    const tab = await getActiveTab();
    currentTabId = tab.id;
    const r = await bg('stop', { tabId: tab.id });
    if (!r?.ok) throw new Error(r?.error || 'Không thể dừng');
    lastRecording = r.recording;
    status(`Đã dừng • ${lastRecording?.events?.length || 0} sự kiện`, 'stopped');
  } catch (e) {
    status(`Lỗi: ${e.message}`, 'error');
  }
});

$('exportJs').addEventListener('click', async () => {
  try {
    if (!lastRecording) {
      const r = await bg('lastRecording');
      lastRecording = r?.recording || null;
    }
    if (!lastRecording) throw new Error('Chưa có phiên ghi đã Stop');

    const source = scenarioSource(lastRecording);
    const filename = `${slug(lastRecording.title)}.scenario.js`;
    const saved = await downloadJs(filename, source);

    const where = saved?.method === 'directory' && saved.directoryName
      ? ` • ${saved.directoryName}`
      : '';

    status(`Đã tạo ${filename} • ${toInteractions(lastRecording).length} actions${where}`, 'stopped');
  } catch (e) {
    status(`Lỗi: ${e.message}`, 'error');
  }
});

(async () => {
  try {
    const tab = await getActiveTab();
    currentTabId = tab.id;
    const r = await bg('status', { tabId: tab.id });

    if (r?.active) {
      status(`Đang ghi • ${r.count || 0} sự kiện • phiên vẫn tiếp tục qua URL/reload`, 'recording');
    } else {
      status('Sẵn sàng. Start để ghi thao tác trên tab hiện tại.', 'stopped');
    }

    const lr = await bg('lastRecording');
    lastRecording = lr?.recording || null;
  } catch (e) {
    status(`Lỗi: ${e.message}`, 'error');
  }
})();
