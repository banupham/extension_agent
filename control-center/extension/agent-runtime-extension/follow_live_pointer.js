'use strict';

(function initAgentFollowLivePointer(root) {
  const TRACKING_MODE = 'follow-live';
  const POINTER_EVENT_TYPES = new Set(['mouseMoved', 'mousePressed', 'mouseReleased']);
  const trackingByTab = new Map();
  const installState = { installed: false, installError: null };
  let installedChrome = null;
  let restoreSendCommand = null;
  let activeWrapper = null;

  function finite(value, fallback = null) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function normalizeRect(rect) {
    const x = finite(rect?.x), y = finite(rect?.y), width = finite(rect?.width), height = finite(rect?.height);
    if (x == null || y == null || width == null || height == null || width <= 0 || height <= 0) return null;
    return { x, y, width, height, centerX: x + width / 2, centerY: y + height / 2 };
  }

  function normalizeTarget(target) {
    const rect = normalizeRect(target?.rect);
    if (!target?.ref || !rect) throw new Error('follow_live_tracking_target_invalid');
    const frameDepth = Number.isInteger(Number(target?.frameDepth)) ? Number(target.frameDepth) : 0;
    if (frameDepth !== 0) throw new Error('follow_live_tracking_top_document_only');
    return {
      ref: String(target.ref),
      tag: normalizeText(target.tag),
      role: normalizeText(target.role),
      label: normalizeText(target.label),
      frameDepth,
      rect
    };
  }

  function summary(state) {
    if (!state) return null;
    return {
      mode: state.mode,
      tabId: state.tabId,
      targetRef: state.target?.ref || null,
      samples: state.samples,
      correctionCount: state.correctionCount,
      maxDeltaPx: state.maxDeltaPx,
      lastProgress: state.lastProgress,
      lastLiveRect: state.lastLiveRect ? { ...state.lastLiveRect } : null,
      elapsedMs: Math.max(0, Date.now() - state.startedAt)
    };
  }

  function stateFor(tabId) {
    return trackingByTab.get(Number(tabId)) || null;
  }

  function trackingProgress(state, params) {
    const observed = state.target.rect;
    const x = finite(params?.x, observed.centerX);
    const y = finite(params?.y, observed.centerY);
    const remaining = Math.hypot(x - observed.centerX, y - observed.centerY);
    if (state.originDistance == null) state.originDistance = Math.max(1, remaining);
    let progress = clamp(1 - remaining / state.originDistance, 0, 1);
    if (progress >= 0.82) progress = 1;
    progress = Math.max(state.lastProgress, progress);
    state.lastProgress = progress;
    return progress;
  }

  function correctedPointerParams(state, params, liveRect) {
    const observed = state.target.rect;
    const live = normalizeRect(liveRect);
    if (!live) throw new Error('follow_live_target_geometry_unavailable');
    const dx = live.centerX - observed.centerX;
    const dy = live.centerY - observed.centerY;
    const delta = Math.hypot(dx, dy);
    state.samples += 1;
    state.maxDeltaPx = Math.max(state.maxDeltaPx, delta);
    state.lastLiveRect = live;
    if (delta > 0.5) state.correctionCount += 1;

    const type = String(params?.type || '');
    const progress = type === 'mouseMoved' ? trackingProgress(state, params) : 1;
    if (type !== 'mouseMoved') state.lastProgress = 1;
    return {
      ...params,
      x: finite(params?.x, observed.centerX) + dx * progress,
      y: finite(params?.y, observed.centerY) + dy * progress
    };
  }

  async function readLiveTarget(boundSendCommand, targetHandle, state) {
    const wanted = state.target;
    const expression = `(() => {
      const interactive = 'a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex]';
      const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const label = el => normalize(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.innerText || '');
      const visible = el => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      };
      const wanted = {
        tag: ${JSON.stringify(wanted.tag)},
        role: ${JSON.stringify(wanted.role)},
        label: ${JSON.stringify(wanted.label)}
      };
      const candidates = [...document.querySelectorAll(interactive)].filter(el => {
        if (!visible(el) || el.matches(':disabled')) return false;
        const tag = normalize(el.tagName);
        const role = normalize(el.getAttribute('role'));
        if (wanted.tag && tag !== wanted.tag) return false;
        if (wanted.role && role !== wanted.role) return false;
        return label(el) === wanted.label;
      });
      if (candidates.length !== 1) {
        return { ok:false, reason:candidates.length ? 'ambiguous' : 'missing', candidateCount:candidates.length };
      }
      const r = candidates[0].getBoundingClientRect();
      return { ok:true, rect:{ x:r.x, y:r.y, width:r.width, height:r.height } };
    })()`;
    const result = await boundSendCommand(targetHandle, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    const live = result?.result?.value || null;
    if (!live?.ok || !live?.rect) {
      throw new Error(`follow_live_target_${live?.reason || 'unavailable'}:${state.target.ref}`);
    }
    return live.rect;
  }

  function activateWrapper() {
    if (!installedChrome || activeWrapper) return;
    const debuggerApi = installedChrome.debugger;
    const original = debuggerApi?.sendCommand;
    if (typeof original !== 'function') throw new Error('debugger_sendCommand_unavailable');
    const bound = original.bind(debuggerApi);
    const wrapped = async function followLiveTrackedSendCommand(targetHandle, method, params = {}) {
      const tabId = Number(targetHandle?.tabId);
      const state = stateFor(tabId);
      const type = String(params?.type || '');
      if (!state || method !== 'Input.dispatchMouseEvent' || !POINTER_EVENT_TYPES.has(type)) {
        return bound(targetHandle, method, params);
      }
      const liveRect = await readLiveTarget(bound, targetHandle, state);
      const corrected = correctedPointerParams(state, params, liveRect);
      return bound(targetHandle, method, corrected);
    };
    debuggerApi.sendCommand = wrapped;
    if (debuggerApi.sendCommand !== wrapped) throw new Error('debugger_sendCommand_not_writable');
    restoreSendCommand = original;
    activeWrapper = wrapped;
  }

  function restoreWrapperIfIdle() {
    if (trackingByTab.size || !installedChrome || !activeWrapper) return;
    const debuggerApi = installedChrome.debugger;
    if (debuggerApi?.sendCommand === activeWrapper && typeof restoreSendCommand === 'function') {
      debuggerApi.sendCommand = restoreSendCommand;
    }
    restoreSendCommand = null;
    activeWrapper = null;
  }

  function begin(tabId, target) {
    const id = Number(tabId);
    if (!Number.isInteger(id) || id <= 0) throw new Error('follow_live_tracking_tab_required');
    if (trackingByTab.has(id)) throw new Error('follow_live_tracking_already_active');
    const normalizedTarget = normalizeTarget(target);
    const state = {
      mode: TRACKING_MODE,
      tabId: id,
      target: normalizedTarget,
      originDistance: null,
      lastProgress: 0,
      samples: 0,
      correctionCount: 0,
      maxDeltaPx: 0,
      lastLiveRect: null,
      startedAt: Date.now()
    };
    trackingByTab.set(id, state);
    try {
      activateWrapper();
    } catch (error) {
      trackingByTab.delete(id);
      throw error;
    }
    return summary(state);
  }

  function end(tabId) {
    const id = Number(tabId);
    const state = trackingByTab.get(id) || null;
    trackingByTab.delete(id);
    restoreWrapperIfIdle();
    return summary(state);
  }

  function install(chromeApi) {
    if (installState.installed) return { ...installState };
    if (typeof chromeApi?.debugger?.sendCommand !== 'function') {
      installState.installError = 'debugger_sendCommand_unavailable';
      return { ...installState };
    }
    installedChrome = chromeApi;
    installState.installed = true;
    installState.installError = null;
    return { ...installState };
  }

  root.AgentFollowLivePointer = {
    TRACKING_MODE,
    POINTER_EVENT_TYPES,
    install,
    begin,
    end,
    stateFor,
    normalizeRect,
    normalizeTarget,
    trackingProgress,
    correctedPointerParams,
    status: tabId => summary(stateFor(tabId))
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
