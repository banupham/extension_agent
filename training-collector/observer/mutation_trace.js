'use strict';

(function initMutationTrace(root) {
  const NS = root.TrainingCollectorV04 = root.TrainingCollectorV04 || {};

  function createMutationTrace(options = {}) {
    const observer = options.observer;
    const emitBatch = typeof options.emitBatch === 'function' ? options.emitBatch : () => {};
    const queue = [];
    let mo = null;
    let timer = null;

    function push(item) {
      if (!item) return;
      queue.push(item);
      if (queue.length >= 80) flush();
      else if (!timer) timer = setTimeout(flush, 250);
    }

    function flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!queue.length) return;
      const batch = queue.splice(0, queue.length);
      try { emitBatch(batch); } catch {}
    }

    function describe(el) {
      if (!(el instanceof Element) || !observer || observer.isSensitive(el)) return null;
      const s = observer.semanticElement(el);
      if (!s) return null;
      return { elementRef: s.ref, tag: s.tag, role: s.role, selector: s.selector };
    }

    function summarizeRecord(record) {
      const tsEpochMs = Date.now();
      const target = describe(record.target instanceof Element ? record.target : null);
      if (record.type === 'attributes') {
        if (!target) return null;
        return {
          type: 'dom-mutation',
          mutationType: 'attributes',
          tsEpochMs,
          tPageMs: Math.round(performance.now() * 1000) / 1000,
          target,
          attributeName: record.attributeName || null
        };
      }
      if (record.type === 'childList') {
        const added = Array.from(record.addedNodes || []).filter(n => n instanceof Element).map(describe).filter(Boolean).slice(0, 20);
        const removed = Array.from(record.removedNodes || []).filter(n => n instanceof Element).map(describe).filter(Boolean).slice(0, 20);
        if (!target && !added.length && !removed.length) return null;
        return {
          type: 'dom-mutation',
          mutationType: 'childList',
          tsEpochMs,
          tPageMs: Math.round(performance.now() * 1000) / 1000,
          target,
          added,
          removed,
          addedCount: Number(record.addedNodes?.length || 0),
          removedCount: Number(record.removedNodes?.length || 0)
        };
      }
      return null;
    }

    function start() {
      if (mo) return;
      mo = new MutationObserver(records => {
        for (const record of records) push(summarizeRecord(record));
      });
      mo.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['role', 'aria-expanded', 'aria-hidden', 'aria-disabled', 'disabled', 'checked', 'selected', 'class', 'style']
      });
    }

    function stop() {
      if (mo) mo.disconnect();
      mo = null;
      flush();
    }

    return { start, stop, flush };
  }

  NS.MutationTrace = { createMutationTrace };
})(typeof globalThis !== 'undefined' ? globalThis : this);
