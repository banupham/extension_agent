'use strict';

(function initElementRegistry(root) {
  const NS = root.TrainingCollectorV04 = root.TrainingCollectorV04 || {};

  function createElementRegistry(options = {}) {
    const prefix = String(options.prefix || 'e');
    const refs = new WeakMap();
    let nextRef = 1;

    function getRef(el) {
      if (!(el instanceof Element)) return null;
      if (!refs.has(el)) refs.set(el, `${prefix}${nextRef++}`);
      return refs.get(el);
    }

    function peekRef(el) {
      return el instanceof Element ? (refs.get(el) || null) : null;
    }

    function stats() {
      return { assignedCount: nextRef - 1 };
    }

    return { getRef, peekRef, stats };
  }

  NS.ElementRegistry = { createElementRegistry };
})(typeof globalThis !== 'undefined' ? globalThis : this);
