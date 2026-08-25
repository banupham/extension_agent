(() => {
  if (window.__BAR_V4_CONTENT__) return;
  window.__BAR_V4_CONTENT__ = true;

  const S = {
    active: false,
    startedAtEpoch: 0,
    scrollTimer: null,
    scrollSamples: [],
    wheelSamples: [],
    scrollStartedAt: null,
    pendingInputs: new Map(),
    pointerDown: new Map(),
    lastPointerGesture: null,
    lastPointerActivity: null,
    mousePath: [],
    lastMouseSampleAt: 0
  };

  const MOUSE_SAMPLE_MIN_MS = 16;
  const MOUSE_PATH_WINDOW_MS = 2500;
  const MOUSE_PATH_MAX = 240;

  function relativeNow() {
    if (!S.startedAtEpoch) return 0;
    return Math.max(0, Date.now() - S.startedAtEpoch);
  }
  function escCss(s) {
    try { return CSS.escape(String(s)); }
    catch { return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }
  }
  function looksDynamicId(id) {
    const s = String(id || '');
    if (!s) return true;
    if (/^[_:-]/.test(s) && s.length > 10) return true;
    if (s.length > 48) return true;
    if ((s.match(/\d/g) || []).length >= 5) return true;
    if (/^[A-Za-z0-9_-]{20,}$/.test(s) && !/[a-z]{4,}/i.test(s)) return true;
    return false;
  }
  function clickableTarget(el) {
    if (!(el instanceof Element)) return null;
    return el.closest('a, button, input, select, textarea, summary, label, [role="button"], [role="link"], [onclick], [tabindex]') || el;
  }
  function attrSelector(el, attr) {
    const v = el.getAttribute(attr);
    if (!v) return null;
    const escaped = String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `${el.tagName.toLowerCase()}[${attr}="${escaped}"]`;
  }
  function selectorCandidates(el) {
    if (!(el instanceof Element)) return [];
    const out = [];
    if (el.id && !looksDynamicId(el.id)) out.push(`#${escCss(el.id)}`);
    for (const attr of ['data-testid', 'data-test', 'data-qa', 'name', 'aria-label', 'placeholder', 'role', 'type']) {
      const s = attrSelector(el, attr);
      if (!s) continue;
      try { if (document.querySelectorAll(s).length === 1) out.push(s); } catch {}
    }
    if (el instanceof HTMLAnchorElement && el.getAttribute('href')) {
      const rawHref = el.getAttribute('href');
      const escaped = String(rawHref).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const s = `a[href="${escaped}"]`;
      try { if (document.querySelectorAll(s).length === 1) out.push(s); } catch {}
    }
    if (el.classList?.length) {
      const cls = [...el.classList].filter(x => x && !/\d{3,}/.test(x)).slice(0, 2).map(escCss);
      if (cls.length) {
        const s = `${el.tagName.toLowerCase()}.${cls.join('.')}`;
        try { if (document.querySelectorAll(s).length === 1) out.push(s); } catch {}
      }
    }
    let node = el;
    const parts = [];
    for (let depth = 0; node && node.nodeType === 1 && depth < 5; depth++, node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter(x => x.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      const s = parts.join(' > ');
      try { if (document.querySelectorAll(s).length === 1) { out.push(s); break; } } catch {}
    }
    return [...new Set(out)].slice(0, 6);
  }
  function elementInfo(el) {
    if (!(el instanceof Element)) return {};
    const selectors = selectorCandidates(el);
    const r = el.getBoundingClientRect();
    return {
      selectors,
      selector: selectors[0] || el.tagName.toLowerCase(),
      tag: el.tagName,
      text: (el.innerText || el.textContent || '').trim().slice(0, 160),
      attributes: {
        id: el.id || null,
        name: el.getAttribute('name'),
        role: el.getAttribute('role'),
        type: el.getAttribute('type'),
        ariaLabel: el.getAttribute('aria-label'),
        placeholder: el.getAttribute('placeholder'),
        href: el.getAttribute('href')
      },
      rect: {
        x: Math.round(r.x * 10) / 10,
        y: Math.round(r.y * 10) / 10,
        width: Math.round(r.width * 10) / 10,
        height: Math.round(r.height * 10) / 10
      }
    };
  }
  function fieldKey(el) {
    if (!(el instanceof Element)) return null;
    const info = elementInfo(el);
    return info.selector || info.selectors?.[0] || null;
  }
  function fieldValue(el) {
    return el?.isContentEditable ? el.innerText : (el?.value ?? '');
  }
  function trimTrace(arr, max = 160) { return arr.length > max ? arr.slice(arr.length - max) : arr; }
  function round(n, digits = 2) {
    const p = 10 ** digits;
    return Math.round(Number(n || 0) * p) / p;
  }
  function isEditable(el) {
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || !!el?.isContentEditable;
  }
  function ensurePending(el) {
    const key = fieldKey(el);
    if (!key) return null;
    const now = relativeNow();
    let pending = S.pendingInputs.get(key);
    if (!pending) {
      pending = {
        element: el,
        selector: key,
        info: elementInfo(el),
        initialValue: fieldValue(el),
        value: fieldValue(el),
        startedAt: now,
        updatedAt: now,
        changes: [],
        operations: [],
        uncertainReasons: []
      };
      S.pendingInputs.set(key, pending);
    }
    return pending;
  }
  function pushOperation(el, op) {
    const pending = ensurePending(el);
    if (!pending) return;
    pending.element = el;
    pending.info = elementInfo(el);
    pending.updatedAt = Number(op.t ?? relativeNow());
    pending.operations.push(op);
    pending.operations = trimTrace(pending.operations, 240);
  }
  function queueFieldValue(el, inputType = null) {
    const pending = ensurePending(el);
    if (!pending) return;
    const now = relativeNow();
    const value = fieldValue(el);
    pending.element = el;
    pending.info = elementInfo(el);
    pending.value = value;
    pending.inputType = inputType;
    pending.updatedAt = now;
    pending.changes.push({
      t: now,
      inputType: inputType || null,
      value,
      length: String(value ?? '').length,
      selectionStart: Number.isInteger(el.selectionStart) ? el.selectionStart : null,
      selectionEnd: Number.isInteger(el.selectionEnd) ? el.selectionEnd : null
    });
    pending.changes = trimTrace(pending.changes, 160);
    if (['insertFromPaste', 'insertFromDrop', 'insertReplacementText', 'insertCompositionText', 'deleteByCut', 'historyUndo', 'historyRedo'].includes(inputType)) {
      pending.uncertainReasons.push(inputType);
      pending.uncertainReasons = [...new Set(pending.uncertainReasons)];
    }
  }
  function textSummary(pending) {
    const ops = pending.operations || [];
    return {
      backspaceCount: ops.filter(x => x.kind === 'pressKey' && x.key === 'Backspace').length,
      deleteCount: ops.filter(x => x.kind === 'pressKey' && x.key === 'Delete').length,
      enterCount: ops.filter(x => x.kind === 'pressKey' && x.key === 'Enter').length,
      tabCount: ops.filter(x => x.kind === 'pressKey' && x.key === 'Tab').length,
      typedCharCount: ops.filter(x => x.kind === 'type').reduce((s, x) => s + String(x.text || '').length, 0),
      keyComboCount: ops.filter(x => x.kind === 'keyCombo').length,
      operationCount: ops.length
    };
  }
  function emitPending(pending) {
    const finalValue = pending.value ?? fieldValue(pending.element);
    const uncertainReasons = [...new Set(pending.uncertainReasons || [])];
    const reconstructable = uncertainReasons.length === 0 && (pending.operations || []).length > 0;
    sendEventAt('textEditRecorded', pending.startedAt, {
      ...pending.info,
      initialValue: pending.initialValue,
      finalValue,
      reconstruction: {
        mode: reconstructable ? 'keyboard-operations' : 'replaceText-fallback',
        reconstructable,
        uncertainReasons
      },
      editTrace: {
        startedAtMs: pending.startedAt,
        endedAtMs: pending.updatedAt,
        durationMs: Math.max(0, pending.updatedAt - pending.startedAt),
        initialValue: pending.initialValue,
        finalValue,
        operations: pending.operations,
        changes: pending.changes,
        summary: textSummary(pending)
      },
      tEnd: pending.updatedAt
    });
  }
  function flushField(el) {
    const key = fieldKey(el);
    if (!key) return;
    const pending = S.pendingInputs.get(key);
    if (!pending) return;
    emitPending(pending);
    S.pendingInputs.delete(key);
  }
  function flushAllFields() {
    for (const pending of [...S.pendingInputs.values()]) emitPending(pending);
    S.pendingInputs.clear();
  }
  function sendEvent(type, data = {}) { sendEventAt(type, relativeNow(), data); }
  function sendEventAt(type, t, data = {}) {
    if (!S.active) return;
    chrome.runtime.sendMessage({ scope: 'BAR_V3', cmd: 'event', event: { t: Number(t || 0), type, pageUrl: location.href, ...data } }).catch(() => {});
  }

  function pathMetrics(samples) {
    if (!samples.length) return null;
    let distancePx = 0;
    let peakSpeedPxPerSec = 0;
    const speedSamples = [];
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const dtMs = Math.max(1, b.t - a.t);
      const speed = d / (dtMs / 1000);
      distancePx += d;
      peakSpeedPxPerSec = Math.max(peakSpeedPxPerSec, speed);
      speedSamples.push({ t: b.t, speedPxPerSec: round(speed, 1), distancePx: round(d, 2), dtMs });
    }
    const first = samples[0];
    const last = samples[samples.length - 1];
    const durationMs = Math.max(0, last.t - first.t);
    return {
      startedAtMs: first.t,
      endedAtMs: last.t,
      durationMs,
      start: { x: first.x, y: first.y },
      end: { x: last.x, y: last.y },
      displacementX: round(last.x - first.x, 2),
      displacementY: round(last.y - first.y, 2),
      straightDistancePx: round(Math.hypot(last.x - first.x, last.y - first.y), 2),
      pathDistancePx: round(distancePx, 2),
      averageSpeedPxPerSec: durationMs > 0 ? round(distancePx / (durationMs / 1000), 1) : 0,
      peakSpeedPxPerSec: round(peakSpeedPxPerSec, 1),
      sampleCount: samples.length,
      speedSamples: trimTrace(speedSamples, 120)
    };
  }
  function recentMousePath(nowT) {
    const minT = nowT - MOUSE_PATH_WINDOW_MS;
    const samples = S.mousePath.filter(x => x.t >= minT && x.t <= nowT);
    return samples.length ? { samples, metrics: pathMetrics(samples) } : null;
  }

  function scrollMetrics(samples, wheelSamples, startedAtMs, endedAtMs) {
    const first = samples[0] || { x: Math.round(window.scrollX), y: Math.round(window.scrollY), t: startedAtMs };
    const last = samples[samples.length - 1] || first;
    let distancePx = 0;
    let peakSpeedPxPerSec = 0;
    const speedSamples = [];
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      const dx = Number(b.x || 0) - Number(a.x || 0);
      const dy = Number(b.y || 0) - Number(a.y || 0);
      const d = Math.hypot(dx, dy);
      const dtMs = Math.max(1, Number(b.t || 0) - Number(a.t || 0));
      const speed = d / (dtMs / 1000);
      distancePx += d;
      peakSpeedPxPerSec = Math.max(peakSpeedPxPerSec, speed);
      speedSamples.push({ t: b.t, speedPxPerSec: round(speed, 1), distancePx: round(d, 2), dtMs });
    }
    const durationMs = Math.max(0, endedAtMs - startedAtMs);
    const displacementX = Number(last.x || 0) - Number(first.x || 0);
    const displacementY = Number(last.y || 0) - Number(first.y || 0);
    const straightDistancePx = Math.hypot(displacementX, displacementY);
    const averageSpeedPxPerSec = durationMs > 0 ? distancePx / (durationMs / 1000) : 0;
    let direction = 'none';
    if (Math.abs(displacementY) >= Math.abs(displacementX) && Math.abs(displacementY) > 0) direction = displacementY > 0 ? 'down' : 'up';
    else if (Math.abs(displacementX) > 0) direction = displacementX > 0 ? 'right' : 'left';
    const recentPointer = S.lastPointerActivity && Math.abs(startedAtMs - S.lastPointerActivity.t) <= 900 ? S.lastPointerActivity : null;
    let sourceHint = 'unknown';
    if (recentPointer?.pointerType === 'touch') sourceHint = 'touch';
    else if (wheelSamples.length) {
      const modes = [...new Set(wheelSamples.map(x => x.deltaMode))];
      sourceHint = modes.every(x => x === 0) ? 'wheel-pixel' : (modes.every(x => x === 1) ? 'wheel-line' : (modes.every(x => x === 2) ? 'wheel-page' : 'wheel-mixed'));
    } else if (recentPointer?.pointerType === 'mouse') sourceHint = 'pointer-scroll-or-scrollbar';
    const wheelTotalX = wheelSamples.reduce((s, x) => s + Number(x.deltaX || 0), 0);
    const wheelTotalY = wheelSamples.reduce((s, x) => s + Number(x.deltaY || 0), 0);
    return {
      durationMs,
      start: { x: first.x, y: first.y },
      end: { x: last.x, y: last.y },
      displacementX: round(displacementX, 2),
      displacementY: round(displacementY, 2),
      straightDistancePx: round(straightDistancePx, 2),
      pathDistancePx: round(distancePx, 2),
      averageSpeedPxPerSec: round(averageSpeedPxPerSec, 1),
      peakSpeedPxPerSec: round(peakSpeedPxPerSec, 1),
      direction,
      sourceHint,
      sampleCount: samples.length,
      wheelSampleCount: wheelSamples.length,
      wheelTotalDeltaX: round(wheelTotalX, 2),
      wheelTotalDeltaY: round(wheelTotalY, 2),
      speedSamples: trimTrace(speedSamples, 120)
    };
  }

  document.addEventListener('pointermove', e => {
    if (!S.active) return;
    const t = relativeNow();
    S.lastPointerActivity = { t, pointerType: e.pointerType || 'mouse', phase: 'move', x: e.clientX, y: e.clientY };
    if ((e.pointerType || 'mouse') !== 'mouse') return;
    if (t - S.lastMouseSampleAt < MOUSE_SAMPLE_MIN_MS) return;
    const last = S.mousePath[S.mousePath.length - 1];
    if (last && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 1.5) return;
    S.lastMouseSampleAt = t;
    S.mousePath.push({ t, x: Math.round(e.clientX * 10) / 10, y: Math.round(e.clientY * 10) / 10, buttons: e.buttons });
    S.mousePath = trimTrace(S.mousePath.filter(x => t - x.t <= MOUSE_PATH_WINDOW_MS), MOUSE_PATH_MAX);
  }, true);

  document.addEventListener('pointerdown', e => {
    if (!S.active) return;
    const t = relativeNow();
    S.pointerDown.set(e.pointerId, {
      t, clientX: e.clientX, clientY: e.clientY,
      button: e.button, pointerType: e.pointerType || 'mouse', pressure: Number(e.pressure || 0),
      mousePathBeforeDown: (e.pointerType || 'mouse') === 'mouse' ? recentMousePath(t) : null
    });
    S.lastPointerActivity = { t, pointerType: e.pointerType || 'mouse', phase: 'down', x: e.clientX, y: e.clientY };
    const active = document.activeElement;
    if (active && active !== e.target && isEditable(active)) flushField(active);
  }, true);

  document.addEventListener('pointerup', e => {
    if (!S.active) return;
    const down = S.pointerDown.get(e.pointerId);
    const upT = relativeNow();
    S.lastPointerActivity = { t: upT, pointerType: e.pointerType || down?.pointerType || 'mouse', phase: 'up', x: e.clientX, y: e.clientY };
    if (down) {
      S.lastPointerGesture = {
        startedAtMs: down.t,
        endedAtMs: upT,
        durationMs: Math.max(0, upT - down.t),
        pointerType: down.pointerType,
        button: down.button,
        start: { x: down.clientX, y: down.clientY, pressure: down.pressure },
        end: { x: e.clientX, y: e.clientY, pressure: Number(e.pressure || 0) },
        mousePathBeforeDown: down.mousePathBeforeDown
      };
      S.pointerDown.delete(e.pointerId);
    }
  }, true);

  document.addEventListener('click', e => {
    if (!S.active) return;
    const target = clickableTarget(e.target);
    if (!target) return;
    const info = elementInfo(target);
    const r = target.getBoundingClientRect();
    const rx = r.width > 0 ? (e.clientX - r.left) / r.width : 0.5;
    const ry = r.height > 0 ? (e.clientY - r.top) / r.height : 0.5;
    sendEvent('clickRecorded', {
      ...info,
      clientX: e.clientX,
      clientY: e.clientY,
      button: e.button,
      point: { rx: Math.max(0, Math.min(1, rx)), ry: Math.max(0, Math.min(1, ry)) },
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 },
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
      pointerGesture: S.lastPointerGesture,
      mousePath: S.lastPointerGesture?.mousePathBeforeDown || recentMousePath(relativeNow())
    });
    S.lastPointerGesture = null;
    S.mousePath = [];
  }, true);

  document.addEventListener('keydown', e => {
    if (!S.active) return;
    const editable = isEditable(e.target);
    const modifierOnly = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key);
    if (editable && !modifierOnly) {
      const t = relativeNow();
      const base = { t, key: e.key, code: e.code, location: e.location, repeat: !!e.repeat, modifiers: { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey } };
      if ((e.ctrlKey || e.altKey || e.metaKey) && e.key) {
        const keys = [];
        if (e.ctrlKey) keys.push('Control');
        if (e.altKey) keys.push('Alt');
        if (e.shiftKey) keys.push('Shift');
        if (e.metaKey) keys.push('Meta');
        keys.push(e.key);
        pushOperation(e.target, { ...base, kind: 'keyCombo', keys });
      } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter' || e.key === 'Tab') {
        pushOperation(e.target, { ...base, kind: 'pressKey' });
      } else if (e.key.length === 1) {
        pushOperation(e.target, { ...base, kind: 'type', text: e.key });
      } else {
        pushOperation(e.target, { ...base, kind: 'pressKey' });
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'textarea')) {
        setTimeout(() => flushField(e.target), 0);
      }
      return;
    }
    if (modifierOnly) return;
    const keyMeta = {
      ...elementInfo(e.target), key: e.key, code: e.code, location: e.location,
      repeat: !!e.repeat, modifiers: { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey }
    };
    if ((e.ctrlKey || e.altKey || e.metaKey) && e.key) {
      const keys = [];
      if (e.ctrlKey) keys.push('Control');
      if (e.altKey) keys.push('Alt');
      if (e.shiftKey) keys.push('Shift');
      if (e.metaKey) keys.push('Meta');
      keys.push(e.key);
      sendEvent('keyCombo', { ...keyMeta, keys });
      return;
    }
    if (e.key.length === 1) return;
    sendEvent('key', keyMeta);
  }, true);

  document.addEventListener('input', e => {
    if (!S.active) return;
    const el = e.target;
    if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) {
      sendEvent('setChecked', { ...elementInfo(el), checked: el.checked });
      return;
    }
    if (el instanceof HTMLSelectElement) {
      const option = el.selectedOptions?.[0];
      sendEvent('selectOption', { ...elementInfo(el), value: el.value, optionText: option ? option.text : '', index: el.selectedIndex });
      return;
    }
    if (isEditable(el)) queueFieldValue(el, e.inputType || null);
  }, true);

  document.addEventListener('change', e => {
    if (!S.active) return;
    const el = e.target;
    if (el instanceof HTMLSelectElement) {
      const option = el.selectedOptions?.[0];
      sendEvent('selectOption', { ...elementInfo(el), value: el.value, optionText: option ? option.text : '', index: el.selectedIndex });
    } else if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) {
      sendEvent('setChecked', { ...elementInfo(el), checked: el.checked });
    }
  }, true);

  document.addEventListener('focusout', e => {
    if (!S.active) return;
    if (isEditable(e.target)) flushField(e.target);
  }, true);

  window.addEventListener('wheel', e => {
    if (!S.active) return;
    const t = relativeNow();
    S.wheelSamples.push({
      t,
      deltaX: round(e.deltaX, 3),
      deltaY: round(e.deltaY, 3),
      deltaZ: round(e.deltaZ, 3),
      deltaMode: e.deltaMode,
      clientX: Math.round(e.clientX),
      clientY: Math.round(e.clientY),
      ctrlKey: !!e.ctrlKey,
      shiftKey: !!e.shiftKey,
      altKey: !!e.altKey,
      metaKey: !!e.metaKey
    });
    S.wheelSamples = trimTrace(S.wheelSamples, 160);
    if (S.scrollStartedAt == null) S.scrollStartedAt = t;
  }, { passive: true, capture: true });

  window.addEventListener('scroll', () => {
    if (!S.active) return;
    const t = relativeNow();
    const sample = { t, x: Math.round(window.scrollX), y: Math.round(window.scrollY) };
    if (S.scrollStartedAt == null) S.scrollStartedAt = t;
    S.scrollSamples.push(sample);
    S.scrollSamples = trimTrace(S.scrollSamples, 160);
    clearTimeout(S.scrollTimer);
    S.scrollTimer = setTimeout(() => {
      const samples = S.scrollSamples.slice();
      const wheelSamples = S.wheelSamples.slice();
      const startedAtMs = S.scrollStartedAt ?? t;
      const endedAtMs = samples.at(-1)?.t ?? relativeNow();
      const metrics = scrollMetrics(samples, wheelSamples, startedAtMs, endedAtMs);
      sendEventAt('scroll', startedAtMs, {
        x: Math.round(window.scrollX),
        y: Math.round(window.scrollY),
        tEnd: endedAtMs,
        scrollTrace: { startedAtMs, endedAtMs, durationMs: metrics.durationMs, samples, wheelSamples, metrics }
      });
      S.scrollSamples = [];
      S.wheelSamples = [];
      S.scrollStartedAt = null;
    }, 420);
  }, { passive: true, capture: true });

  window.addEventListener('pagehide', () => { if (S.active) flushAllFields(); }, true);

  chrome.runtime.onMessage.addListener(msg => {
    if (!msg || msg.scope !== 'BAR_V3' || msg.cmd !== 'sessionState') return;
    if (!msg.active && S.active) flushAllFields();
    S.active = !!msg.active;
    S.startedAtEpoch = Number(msg.startedAtEpoch) || 0;
    if (!S.active) {
      S.pendingInputs.clear();
      S.scrollSamples = [];
      S.wheelSamples = [];
      S.scrollStartedAt = null;
      S.pointerDown.clear();
      S.lastPointerGesture = null;
      S.mousePath = [];
      S.lastMouseSampleAt = 0;
    }
  });

  chrome.runtime.sendMessage({ scope: 'BAR_V3', cmd: 'contentReady' })
    .then(r => {
      if (!r?.ok) return;
      S.active = !!r.active;
      S.startedAtEpoch = Number(r.startedAtEpoch) || 0;
    })
    .catch(() => {});
})();
