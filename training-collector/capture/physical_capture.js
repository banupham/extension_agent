'use strict';

(function initPhysicalCapture(root) {
  const NS = root.TrainingCollectorV03 = root.TrainingCollectorV03 || {};

  const IDLE_GAP_MS = 500;
  const FLUSH_INTERVAL_MS = 500;
  const FLUSH_EVENT_COUNT = 120;
  const HEARTBEAT_MS = 5000;

  function round3(value) {
    return Math.round(Number(value || 0) * 1000) / 1000;
  }

  function epochForEvent(event) {
    const stamp = Number(event?.timeStamp);
    if (Number.isFinite(stamp) && Number.isFinite(performance.timeOrigin)) {
      return round3(performance.timeOrigin + stamp);
    }
    return Date.now();
  }

  function pageTimeForEvent(event) {
    const stamp = Number(event?.timeStamp);
    return Number.isFinite(stamp) ? round3(stamp) : round3(performance.now());
  }

  function keyOperation(event) {
    const key = String(event.key || '');
    if (key === 'Backspace') return 'backspace';
    if (key === 'Delete') return 'delete';
    if (key === 'Enter') return 'enter';
    if (key === 'Tab') return 'tab';
    if (key === 'Escape') return 'escape';
    if (key.length === 1) return 'printable';
    return 'non-printable';
  }

  function safeKeyCode(event, operation) {
    return operation === 'printable' ? null : String(event.code || '') || null;
  }

  function createPhysicalCapture(options = {}) {
    const emitBatch = typeof options.emitBatch === 'function' ? options.emitBatch : () => {};
    const isSensitiveTarget = typeof options.isSensitiveTarget === 'function' ? options.isSensitiveTarget : () => false;
    const getContext = typeof options.getContext === 'function' ? options.getContext : () => ({});
    const queue = [];
    const listeners = [];
    let running = false;
    let flushTimer = null;
    let heartbeatTimer = null;
    let lastActivityEpochMs = null;

    function contextFields() {
      const ctx = getContext() || {};
      return {
        pageInstanceId: ctx.pageInstanceId || null,
        documentOrigin: ctx.documentOrigin || location.origin,
        documentPathname: ctx.documentPathname || location.pathname,
        visibilityState: document.visibilityState
      };
    }

    function scheduleFlush() {
      if (flushTimer || !running) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flush();
      }, FLUSH_INTERVAL_MS);
    }

    function push(event, activity = true) {
      if (!running || !event) return;
      const ts = Number(event.tsEpochMs || Date.now());
      if (activity && lastActivityEpochMs != null) {
        const gap = ts - lastActivityEpochMs;
        if (gap >= IDLE_GAP_MS) {
          queue.push({
            type: 'idle-gap',
            tsEpochMs: round3(ts),
            startedAtEpochMs: round3(lastActivityEpochMs),
            endedAtEpochMs: round3(ts),
            durationMs: round3(gap),
            ...contextFields()
          });
        }
      }
      if (activity) lastActivityEpochMs = ts;
      queue.push({ ...event, ...contextFields() });
      if (queue.length >= FLUSH_EVENT_COUNT) flush();
      else scheduleFlush();
    }

    function flush() {
      if (!queue.length) return;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      const batch = queue.splice(0, queue.length);
      try { emitBatch(batch); } catch {}
    }

    function on(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      listeners.push(() => target.removeEventListener(type, handler, options));
    }

    function pointerSamples(event, phase) {
      let samples = [event];
      if (phase === 'move' && typeof event.getCoalescedEvents === 'function') {
        try {
          const coalesced = event.getCoalescedEvents();
          if (Array.isArray(coalesced) && coalesced.length) samples = coalesced;
        } catch {}
      }
      for (const sample of samples) {
        push({
          type: 'pointer',
          phase,
          tsEpochMs: epochForEvent(sample),
          tPageMs: pageTimeForEvent(sample),
          pointerType: String(sample.pointerType || 'mouse'),
          pointerId: Number(sample.pointerId || 0),
          isPrimary: sample.isPrimary !== false,
          x: round3(sample.clientX),
          y: round3(sample.clientY),
          screenX: round3(sample.screenX),
          screenY: round3(sample.screenY),
          movementX: round3(sample.movementX),
          movementY: round3(sample.movementY),
          button: Number(sample.button ?? -1),
          buttons: Number(sample.buttons || 0),
          pressure: round3(sample.pressure),
          width: round3(sample.width),
          height: round3(sample.height)
        });
      }
    }

    function keyboardSample(event, phase) {
      if (isSensitiveTarget(event.target)) return;
      const operation = keyOperation(event);
      push({
        type: 'keyboard',
        phase,
        tsEpochMs: epochForEvent(event),
        tPageMs: pageTimeForEvent(event),
        operation,
        keyClass: operation === 'printable' ? 'printable' : String(event.key || 'non-printable'),
        code: safeKeyCode(event, operation),
        location: Number(event.location || 0),
        repeat: !!event.repeat,
        modifiers: {
          alt: !!event.altKey,
          ctrl: !!event.ctrlKey,
          meta: !!event.metaKey,
          shift: !!event.shiftKey
        }
      });
    }

    function start() {
      if (running) return;
      running = true;
      on(window, 'pointermove', event => pointerSamples(event, 'move'), { capture: true, passive: true });
      on(window, 'pointerdown', event => pointerSamples(event, 'down'), true);
      on(window, 'pointerup', event => pointerSamples(event, 'up'), true);
      on(window, 'pointercancel', event => pointerSamples(event, 'cancel'), true);
      on(window, 'wheel', event => push({
        type: 'wheel',
        tsEpochMs: epochForEvent(event),
        tPageMs: pageTimeForEvent(event),
        x: round3(event.clientX),
        y: round3(event.clientY),
        deltaX: round3(event.deltaX),
        deltaY: round3(event.deltaY),
        deltaZ: round3(event.deltaZ),
        deltaMode: Number(event.deltaMode || 0),
        modifiers: { alt: !!event.altKey, ctrl: !!event.ctrlKey, meta: !!event.metaKey, shift: !!event.shiftKey }
      }), { capture: true, passive: true });
      on(window, 'scroll', event => push({
        type: 'scroll-position',
        tsEpochMs: epochForEvent(event),
        tPageMs: pageTimeForEvent(event),
        x: round3(scrollX),
        y: round3(scrollY)
      }), { capture: true, passive: true });
      on(window, 'keydown', event => keyboardSample(event, 'down'), true);
      on(window, 'keyup', event => keyboardSample(event, 'up'), true);
      on(window, 'focus', () => push({ type: 'window-focus', focused: true, tsEpochMs: Date.now(), tPageMs: round3(performance.now()) }), true);
      on(window, 'blur', () => push({ type: 'window-focus', focused: false, tsEpochMs: Date.now(), tPageMs: round3(performance.now()) }), true);
      on(document, 'visibilitychange', () => {
        push({ type: 'visibility', state: document.visibilityState, tsEpochMs: Date.now(), tPageMs: round3(performance.now()) }, false);
        flush();
      }, true);
      on(window, 'pagehide', () => flush(), true);

      heartbeatTimer = setInterval(() => {
        push({
          type: 'heartbeat',
          tsEpochMs: Date.now(),
          tPageMs: round3(performance.now()),
          lastActivityEpochMs
        }, false);
        flush();
      }, HEARTBEAT_MS);

      push({ type: 'document-started', tsEpochMs: Date.now(), tPageMs: round3(performance.now()) }, false);
      flush();
    }

    function stop() {
      if (!running) return;
      push({ type: 'document-stopped', tsEpochMs: Date.now(), tPageMs: round3(performance.now()) }, false);
      flush();
      running = false;
      for (const remove of listeners.splice(0)) {
        try { remove(); } catch {}
      }
      if (flushTimer) clearTimeout(flushTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      flushTimer = null;
      heartbeatTimer = null;
    }

    return { start, stop, flush, get running() { return running; } };
  }

  NS.PhysicalCapture = { createPhysicalCapture, IDLE_GAP_MS, FLUSH_INTERVAL_MS, FLUSH_EVENT_COUNT, HEARTBEAT_MS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
