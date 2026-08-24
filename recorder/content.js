(() => {
  if (window.__BAR_V3_CONTENT__) return;
  window.__BAR_V3_CONTENT__ = true;

  const S = {
    active: false,
    startedAtEpoch: 0,
    scrollTimer: null,
    scrollSamples: [],
    scrollStartedAt: null,
    pendingInputs: new Map(),
    pointerDown: new Map(),
    lastPointerGesture: null
  };

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
  function trimTrace(arr, max = 120) { return arr.length > max ? arr.slice(arr.length - max) : arr; }
  function queueFieldValue(el, inputType = null) {
    const key = fieldKey(el);
    if (!key) return;
    const now = relativeNow();
    const value = el.isContentEditable ? el.innerText : el.value;
    const existing = S.pendingInputs.get(key);
    const change = {
      t: now,
      inputType: inputType || null,
      value,
      length: String(value ?? '').length,
      selectionStart: Number.isInteger(el.selectionStart) ? el.selectionStart : null,
      selectionEnd: Number.isInteger(el.selectionEnd) ? el.selectionEnd : null
    };
    if (existing) {
      existing.element = el;
      existing.info = elementInfo(el);
      existing.value = value;
      existing.inputType = inputType;
      existing.updatedAt = now;
      existing.changes.push(change);
      existing.changes = trimTrace(existing.changes);
    } else {
      S.pendingInputs.set(key, {
        element: el,
        selector: key,
        info: elementInfo(el),
        value,
        inputType,
        startedAt: now,
        updatedAt: now,
        changes: [change]
      });
    }
  }
  function emitPending(pending) {
    sendEvent('replaceText', {
      ...pending.info,
      value: pending.value,
      inputType: pending.inputType || null,
      editTrace: {
        startedAtMs: pending.startedAt,
        endedAtMs: pending.updatedAt,
        durationMs: Math.max(0, pending.updatedAt - pending.startedAt),
        changes: pending.changes
      }
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
  function sendEvent(type, data = {}) {
    if (!S.active) return;
    chrome.runtime.sendMessage({ scope: 'BAR_V3', cmd: 'event', event: { t: relativeNow(), type, pageUrl: location.href, ...data } }).catch(() => {});
  }

  document.addEventListener('pointerdown', e => {
    if (!S.active) return;
    S.pointerDown.set(e.pointerId, {
      t: relativeNow(), clientX: e.clientX, clientY: e.clientY,
      button: e.button, pointerType: e.pointerType || 'mouse', pressure: Number(e.pressure || 0)
    });
    const active = document.activeElement;
    if (active && active !== e.target && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active.isContentEditable)) flushField(active);
  }, true);

  document.addEventListener('pointerup', e => {
    if (!S.active) return;
    const down = S.pointerDown.get(e.pointerId);
    const upT = relativeNow();
    if (down) {
      S.lastPointerGesture = {
        startedAtMs: down.t,
        endedAtMs: upT,
        durationMs: Math.max(0, upT - down.t),
        pointerType: down.pointerType,
        button: down.button,
        start: { x: down.clientX, y: down.clientY, pressure: down.pressure },
        end: { x: e.clientX, y: e.clientY, pressure: Number(e.pressure || 0) }
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
      pointerGesture: S.lastPointerGesture
    });
    S.lastPointerGesture = null;
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
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el?.isContentEditable) queueFieldValue(el, e.inputType || null);
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
    const el = e.target;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el?.isContentEditable) flushField(el);
  }, true);

  document.addEventListener('keydown', e => {
    if (!S.active) return;
    const modifierOnly = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key);
    if (modifierOnly) return;
    if (['Enter', 'Tab'].includes(e.key)) {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active?.isContentEditable) flushField(active);
    }
    const editableTarget = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target?.isContentEditable;
    if (editableTarget && ['Backspace', 'Delete'].includes(e.key)) return;
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
      const startedAtMs = S.scrollStartedAt ?? t;
      const endedAtMs = samples.at(-1)?.t ?? relativeNow();
      sendEvent('scroll', {
        x: Math.round(window.scrollX),
        y: Math.round(window.scrollY),
        scrollTrace: { startedAtMs, endedAtMs, durationMs: Math.max(0, endedAtMs - startedAtMs), samples }
      });
      S.scrollSamples = [];
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
      S.scrollStartedAt = null;
      S.pointerDown.clear();
      S.lastPointerGesture = null;
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
