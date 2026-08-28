'use strict';

(function initRouteTrace(root) {
  const NS = root.TrainingCollectorV07 = root.TrainingCollectorV07 || {};
  const POLL_MS = 500;

  function createRouteTrace(options = {}) {
    const observer = options.observer;
    const emitBatch = typeof options.emitBatch === 'function' ? options.emitBatch : () => {};
    const decorateEvent = typeof options.decorateEvent === 'function' ? options.decorateEvent : event => event;
    const listeners = [];
    let timer = null;
    let running = false;
    let lastHref = String(location.href);
    let lastPage = null;

    function snapshot() {
      try { return observer?.snapshot?.() || null; } catch { return null; }
    }

    function emitRoute(reason = 'poll') {
      if (!running) return;
      const observation = snapshot();
      if (!observation) return;
      const currentPage = observation.page || null;
      const now = Date.now();
      const pageTime = Math.round(performance.now() * 1000) / 1000;
      const events = [];
      events.push(decorateEvent({
        type: 'route-change',
        tsEpochMs: now,
        tPageMs: pageTime,
        reason,
        previousPage: lastPage,
        currentPage
      }, 'navigation'));
      events.push(decorateEvent({
        type: 'semantic-snapshot',
        tsEpochMs: now,
        tPageMs: pageTime,
        snapshotReason: 'route-change',
        observation
      }, 'semantic'));
      lastPage = currentPage;
      try { emitBatch(events); } catch {}
    }

    function check(reason = 'poll') {
      if (!running) return;
      const href = String(location.href);
      if (href === lastHref) return;
      lastHref = href;
      emitRoute(reason);
    }

    function on(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      listeners.push(() => target.removeEventListener(type, handler, options));
    }

    function start(initialPage = null) {
      if (running) return;
      running = true;
      lastHref = String(location.href);
      lastPage = initialPage || snapshot()?.page || null;
      on(globalThis, 'popstate', () => check('popstate'), true);
      on(globalThis, 'hashchange', () => check('hashchange'), true);
      timer = setInterval(() => check('poll'), POLL_MS);
    }

    function stop() {
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
      for (const remove of listeners.splice(0)) {
        try { remove(); } catch {}
      }
    }

    return { start, stop, check, get running() { return running; } };
  }

  NS.RouteTrace = { createRouteTrace, POLL_MS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
