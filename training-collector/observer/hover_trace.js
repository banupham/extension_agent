'use strict';

(function initHoverTrace(root) {
  const NS = root.TrainingCollectorV07 = root.TrainingCollectorV07 || {};
  const ACTIONABLE = 'a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex],video,audio';
  const DWELL_MS = 350;

  function createHoverTrace(options = {}) {
    const observer = options.observer;
    const emitBatch = typeof options.emitBatch === 'function' ? options.emitBatch : () => {};
    const decorateEvent = typeof options.decorateEvent === 'function' ? options.decorateEvent : event => event;
    const queue = [];
    const listeners = [];
    let current = null;
    let dwellTimer = null;
    let flushTimer = null;
    let running = false;

    function epoch(event) {
      const stamp = Number(event?.timeStamp);
      if (Number.isFinite(stamp) && Number.isFinite(performance.timeOrigin)) return Math.round((performance.timeOrigin + stamp) * 1000) / 1000;
      return Date.now();
    }

    function pageTime(event) {
      const stamp = Number(event?.timeStamp);
      return Math.round((Number.isFinite(stamp) ? stamp : performance.now()) * 1000) / 1000;
    }

    function semantic(el) {
      if (!(el instanceof Element) || !observer || observer.isSensitive(el)) return null;
      try { return observer.semanticElement(el); } catch { return null; }
    }

    function hoverTarget(el) {
      if (!(el instanceof Element)) return null;
      try { return el.closest(ACTIONABLE) || el; } catch { return el; }
    }

    function push(event) {
      if (!running || !event) return;
      queue.push(decorateEvent(event, 'hover'));
      if (queue.length >= 40) flush();
      else if (!flushTimer) flushTimer = setTimeout(flush, 250);
    }

    function flush() {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      if (!queue.length) return;
      const batch = queue.splice(0, queue.length);
      try { emitBatch(batch); } catch {}
    }

    function clearDwell() {
      if (dwellTimer) clearTimeout(dwellTimer);
      dwellTimer = null;
    }

    function enter(el, event) {
      const target = hoverTarget(el);
      const s = semantic(target);
      if (!s) return;
      if (current?.ref === s.ref) return;

      clearDwell();
      current = {
        ref: s.ref,
        enteredAtEpochMs: epoch(event),
        enteredAtPageMs: pageTime(event),
        semantic: s
      };
      push({
        type: 'dom-hover-enter',
        tsEpochMs: current.enteredAtEpochMs,
        tPageMs: current.enteredAtPageMs,
        targetRef: s.ref,
        targetDescriptor: {
          elementRef: s.ref,
          tag: s.tag,
          role: s.role,
          label: s.label,
          selector: s.selector,
          selectorCandidates: s.selectorCandidates,
          rect: s.rect,
          rendered: s.rendered,
          inViewport: s.inViewport,
          interactable: s.interactable
        }
      });

      dwellTimer = setTimeout(() => {
        if (!current || current.ref !== s.ref) return;
        const now = Date.now();
        push({
          type: 'dom-hover-dwell',
          tsEpochMs: now,
          tPageMs: Math.round(performance.now() * 1000) / 1000,
          targetRef: s.ref,
          dwellMs: Math.max(0, Math.round(now - current.enteredAtEpochMs))
        });
      }, DWELL_MS);
    }

    function leave(el, event) {
      if (!current) return;
      const target = hoverTarget(el);
      const s = semantic(target);
      if (!s || s.ref !== current.ref) return;

      const related = event.relatedTarget instanceof Element ? hoverTarget(event.relatedTarget) : null;
      if (related && target?.contains?.(related)) return;

      clearDwell();
      const leftAt = epoch(event);
      push({
        type: 'dom-hover-leave',
        tsEpochMs: leftAt,
        tPageMs: pageTime(event),
        targetRef: current.ref,
        dwellMs: Math.max(0, Math.round(leftAt - current.enteredAtEpochMs))
      });
      current = null;
    }

    function on(target, type, handler, opts) {
      target.addEventListener(type, handler, opts);
      listeners.push(() => target.removeEventListener(type, handler, opts));
    }

    function start() {
      if (running) return;
      running = true;
      on(document, 'pointerover', event => enter(event.target instanceof Element ? event.target : null, event), true);
      on(document, 'pointerout', event => leave(event.target instanceof Element ? event.target : null, event), true);
      on(window, 'pagehide', flush, true);
    }

    function stop() {
      clearDwell();
      flush();
      running = false;
      current = null;
      for (const remove of listeners.splice(0)) {
        try { remove(); } catch {}
      }
    }

    return { start, stop, flush };
  }

  NS.HoverTrace = { createHoverTrace, DWELL_MS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
