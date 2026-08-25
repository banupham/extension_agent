'use strict';

(function initMutationTrace(root) {
  const NS = root.TrainingCollectorV04 = root.TrainingCollectorV04 || {};
  const BURST_MS = 120;

  function createMutationTrace(options = {}) {
    const observer = options.observer;
    const emitBatch = typeof options.emitBatch === 'function' ? options.emitBatch : () => {};
    const decorateEvent = typeof options.decorateEvent === 'function' ? options.decorateEvent : event => event;
    let mo = null;
    let timer = null;
    let burst = null;

    function describe(el) {
      if (!(el instanceof Element) || !observer || observer.isSensitive(el)) return null;
      const s = observer.semanticElement(el);
      if (!s) return null;
      return { elementRef: s.ref, tag: s.tag, role: s.role };
    }

    function ensureBurst() {
      if (burst) return burst;
      const now = Date.now();
      const base = {
        type: 'dom-mutation-burst',
        tsEpochMs: now,
        tPageMs: Math.round(performance.now() * 1000) / 1000,
        windowMs: BURST_MS,
        recordCount: 0,
        addedCount: 0,
        removedCount: 0,
        attributes: {},
        targetRefs: [],
        addedRefs: [],
        removedRefs: []
      };
      try { burst = decorateEvent(base, 'mutation') || base; } catch { burst = base; }
      return burst;
    }

    function addUnique(list, value, cap = 40) {
      if (!value || list.includes(value) || list.length >= cap) return;
      list.push(value);
    }

    function absorb(record) {
      const b = ensureBurst();
      b.recordCount += 1;
      const target = describe(record.target instanceof Element ? record.target : null);
      if (target) addUnique(b.targetRefs, target.elementRef);

      if (record.type === 'attributes') {
        const name = record.attributeName || 'unknown';
        b.attributes[name] = (b.attributes[name] || 0) + 1;
      } else if (record.type === 'childList') {
        b.addedCount += Number(record.addedNodes?.length || 0);
        b.removedCount += Number(record.removedNodes?.length || 0);
        for (const node of Array.from(record.addedNodes || [])) {
          const d = describe(node instanceof Element ? node : null);
          if (d) addUnique(b.addedRefs, d.elementRef);
        }
        for (const node of Array.from(record.removedNodes || [])) {
          const d = describe(node instanceof Element ? node : null);
          if (d) addUnique(b.removedRefs, d.elementRef);
        }
      }

      clearTimeout(timer);
      timer = setTimeout(flush, BURST_MS);
    }

    function flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!burst) return;
      const out = burst;
      burst = null;
      try { emitBatch([out]); } catch {}
    }

    function start() {
      if (mo) return;
      mo = new MutationObserver(records => { for (const record of records) absorb(record); });
      mo.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          'role', 'hidden', 'open', 'disabled', 'checked', 'selected',
          'aria-expanded', 'aria-hidden', 'aria-disabled', 'aria-selected',
          'aria-checked', 'aria-pressed'
        ]
      });
    }

    function stop() {
      if (mo) mo.disconnect();
      mo = null;
      flush();
    }

    return { start, stop, flush };
  }

  NS.MutationTrace = { createMutationTrace, BURST_MS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
