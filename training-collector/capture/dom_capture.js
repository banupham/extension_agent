'use strict';

(function initDomCapture(root) {
  const NS = root.TrainingCollectorV04 = root.TrainingCollectorV04 || {};

  function createDomCapture(options = {}) {
    const observer = options.observer;
    const emitBatch = typeof options.emitBatch === 'function' ? options.emitBatch : () => {};
    const queue = [];
    const listeners = [];
    let flushTimer = null;
    let running = false;

    function epoch(event) {
      const stamp = Number(event?.timeStamp);
      if (Number.isFinite(stamp) && Number.isFinite(performance.timeOrigin)) return Math.round((performance.timeOrigin + stamp) * 1000) / 1000;
      return Date.now();
    }

    function semantic(el) {
      if (!(el instanceof Element) || !observer || observer.isSensitive(el)) return null;
      return observer.semanticElement(el);
    }

    function push(event) {
      if (!running || !event) return;
      queue.push(event);
      if (queue.length >= 80) flush();
      else if (!flushTimer) flushTimer = setTimeout(flush, 300);
    }

    function flush() {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      if (!queue.length) return;
      const batch = queue.splice(0, queue.length);
      try { emitBatch(batch); } catch {}
    }

    function on(target, type, handler, opts) {
      target.addEventListener(type, handler, opts);
      listeners.push(() => target.removeEventListener(type, handler, opts));
    }

    function base(type, event, el) {
      const s = semantic(el);
      if (!s) return null;
      return {
        type,
        tsEpochMs: epoch(event),
        tPageMs: Math.round(Number(event?.timeStamp || performance.now()) * 1000) / 1000,
        elementRef: s.ref,
        semanticTarget: {
          elementRef: s.ref,
          tag: s.tag,
          role: s.role,
          label: s.label,
          editable: s.editable,
          selector: s.selector,
          rect: s.rect
        }
      };
    }

    function start() {
      if (running) return;
      running = true;

      on(document, 'click', event => {
        const el = event.target instanceof Element ? event.target : null;
        const item = base('dom-click', event, el);
        if (item) push({ ...item, button: Number(event.button || 0), x: Math.round(event.clientX), y: Math.round(event.clientY) });
      }, true);

      on(document, 'focusin', event => {
        const el = event.target instanceof Element ? event.target : null;
        const item = base('dom-focus', event, el);
        if (item) push({ ...item, focused: true });
      }, true);

      on(document, 'focusout', event => {
        const el = event.target instanceof Element ? event.target : null;
        const item = base('dom-focus', event, el);
        if (item) push({ ...item, focused: false });
      }, true);

      on(document, 'input', event => {
        const el = event.target instanceof Element ? event.target : null;
        const item = base('dom-input', event, el);
        if (!item || !el) return;
        const length = typeof el.value === 'string' ? el.value.length : (el.textContent || '').length;
        push({ ...item, inputType: event.inputType || null, length });
      }, true);

      on(document, 'change', event => {
        const el = event.target instanceof Element ? event.target : null;
        const item = base('dom-change', event, el);
        if (!item || !el) return;
        const extra = {};
        if ('checked' in el) extra.checked = !!el.checked;
        if (el instanceof HTMLSelectElement) extra.selectedIndex = Number(el.selectedIndex);
        push({ ...item, ...extra });
      }, true);

      on(document, 'submit', event => {
        const el = event.target instanceof Element ? event.target : null;
        const item = base('dom-submit', event, el);
        if (item) push(item);
      }, true);

      on(window, 'pagehide', flush, true);
    }

    function stop() {
      flush();
      running = false;
      for (const remove of listeners.splice(0)) {
        try { remove(); } catch {}
      }
    }

    return { start, stop, flush };
  }

  NS.DomCapture = { createDomCapture };
})(typeof globalThis !== 'undefined' ? globalThis : this);
