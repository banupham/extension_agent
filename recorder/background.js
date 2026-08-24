const SESSION_KEY = 'bar_v3_sessions';
const LAST_RECORDING_KEY = 'bar_v3_last_recording';

let sessions = {};

async function loadSessions() {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  sessions = stored[SESSION_KEY] || {};
}

async function saveSessions() {
  await chrome.storage.session.set({ [SESSION_KEY]: sessions });
}

function sessionFor(tabId) {
  return sessions[String(tabId)] || null;
}

function cleanUrl(url) {
  return typeof url === 'string' ? url : '';
}

async function startSession(tab) {
  const tabId = tab.id;
  if (!Number.isInteger(tabId)) throw new Error('Invalid tab');

  sessions[String(tabId)] = {
    tabId,
    active: true,
    startedAtEpoch: Date.now(),
    startedUrl: cleanUrl(tab.url),
    title: tab.title || '',
    currentUrl: cleanUrl(tab.url),
    currentTitle: tab.title || '',
    events: [],
    lastEventT: 0
  };

  await saveSessions();
  return sessions[String(tabId)];
}

async function stopSession(tabId) {
  const s = sessionFor(tabId);
  if (!s) throw new Error('No recording session for this tab');

  s.active = false;
  s.stoppedAtEpoch = Date.now();

  const recording = {
    url: s.startedUrl,
    title: s.title || s.currentTitle || 'Recorded workflow',
    capturedAt: new Date(s.startedAtEpoch).toISOString(),
    stoppedAt: new Date(s.stoppedAtEpoch).toISOString(),
    tabId: s.tabId,
    events: s.events
  };

  await chrome.storage.local.set({ [LAST_RECORDING_KEY]: recording });
  await saveSessions();
  return recording;
}

async function appendEvent(tabId, event) {
  const s = sessionFor(tabId);
  if (!s || !s.active || !event || typeof event !== 'object') return false;

  const relative = Math.max(0, Date.now() - s.startedAtEpoch);
  const item = {
    ...event,
    t: Number.isFinite(event.t) ? event.t : relative,
    pageUrl: event.pageUrl || s.currentUrl || ''
  };

  s.events.push(item);
  s.lastEventT = item.t;
  if (s.events.length > 10000) s.events.splice(0, s.events.length - 10000);

  await saveSessions();
  return true;
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.session.set({ [SESSION_KEY]: {} });
});

chrome.runtime.onStartup.addListener(loadSessions);
loadSessions().catch(() => {});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.scope !== 'BAR_V3') return;

  (async () => {
    if (msg.cmd === 'contentReady') {
      const tabId = sender.tab?.id;
      const s = Number.isInteger(tabId) ? sessionFor(tabId) : null;
      sendResponse({
        ok: true,
        active: !!s?.active,
        startedAtEpoch: s?.startedAtEpoch || null,
        count: s?.events?.length || 0
      });
      return;
    }

    if (msg.cmd === 'event') {
      const tabId = sender.tab?.id;
      if (!Number.isInteger(tabId)) return sendResponse({ ok: false });
      const ok = await appendEvent(tabId, msg.event);
      sendResponse({ ok });
      return;
    }

    if (msg.cmd === 'start') {
      const tab = await chrome.tabs.get(msg.tabId);
      const s = await startSession(tab);
      try {
        await chrome.tabs.sendMessage(tab.id, {
          scope: 'BAR_V3',
          cmd: 'sessionState',
          active: true,
          startedAtEpoch: s.startedAtEpoch
        });
      } catch {}
      sendResponse({ ok: true, count: 0 });
      return;
    }

    if (msg.cmd === 'stop') {
      const recording = await stopSession(msg.tabId);
      try {
        await chrome.tabs.sendMessage(msg.tabId, {
          scope: 'BAR_V3',
          cmd: 'sessionState',
          active: false
        });
      } catch {}
      sendResponse({ ok: true, recording });
      return;
    }

    if (msg.cmd === 'status') {
      const s = sessionFor(msg.tabId);
      sendResponse({
        ok: true,
        active: !!s?.active,
        count: s?.events?.length || 0,
        currentUrl: s?.currentUrl || ''
      });
      return;
    }

    if (msg.cmd === 'lastRecording') {
      const stored = await chrome.storage.local.get(LAST_RECORDING_KEY);
      sendResponse({ ok: true, recording: stored[LAST_RECORDING_KEY] || null });
      return;
    }
  })().catch(err => sendResponse({ ok: false, error: err.message }));

  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const s = sessionFor(tabId);
  if (!s || !s.active) return;

  let changed = false;

  if (changeInfo.url && changeInfo.url !== s.currentUrl) {
    const previousUrl = s.currentUrl;
    s.currentUrl = changeInfo.url;
    s.currentTitle = tab.title || s.currentTitle;

    const nowT = Date.now() - s.startedAtEpoch;
    const last = s.events[s.events.length - 1];
    const recentTrigger =
      last && Number.isFinite(last.t) && nowT - last.t >= 0 && nowT - last.t <= 2500;
    const likelyClickNavigation = recentTrigger && ['click', 'clickRecorded'].includes(last.type);
    const likelyKeyNavigation = recentTrigger && last.type === 'key' && last.key === 'Enter';

    s.events.push({
      t: nowT,
      type: 'navigation',
      fromUrl: previousUrl || '',
      url: changeInfo.url,
      trigger: likelyClickNavigation
        ? 'likely-click'
        : (likelyKeyNavigation ? 'likely-enter' : 'external-or-address-bar')
    });
    changed = true;
  }

  if (changeInfo.title) {
    s.currentTitle = changeInfo.title;
    changed = true;
  }

  if (changed) await saveSessions();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const s = sessionFor(tabId);
  if (!s) return;

  if (s.active) {
    s.active = false;
    s.stoppedAtEpoch = Date.now();
    const recording = {
      url: s.startedUrl,
      title: s.title || s.currentTitle || 'Recorded workflow',
      capturedAt: new Date(s.startedAtEpoch).toISOString(),
      stoppedAt: new Date(s.stoppedAtEpoch).toISOString(),
      tabId: s.tabId,
      events: s.events
    };
    await chrome.storage.local.set({ [LAST_RECORDING_KEY]: recording });
  }

  delete sessions[String(tabId)];
  await saveSessions();
});
