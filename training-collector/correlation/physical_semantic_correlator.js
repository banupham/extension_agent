'use strict';

(function initPhysicalSemanticCorrelator(root) {
  const NS = root.TrainingCollectorV04 = root.TrainingCollectorV04 || {};

  function createCorrelator(options = {}) {
    const observer = options.observer;

    function targetForEvent(event) {
      if (!event || !observer) return null;
      if (event.type === 'pointer' || event.type === 'wheel') {
        const x = Number(event.x);
        const y = Number(event.y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          const el = document.elementFromPoint(x, y);
          if (el instanceof Element) return el;
        }
      }
      const active = document.activeElement;
      return active instanceof Element && active !== document.body ? active : null;
    }

    function compactSemantic(el) {
      if (!(el instanceof Element) || observer.isSensitive(el)) return null;
      const semantic = observer.semanticElement(el);
      if (!semantic) return null;
      return {
        elementRef: semantic.ref,
        tag: semantic.tag,
        role: semantic.role,
        label: semantic.label,
        editable: semantic.editable,
        selector: semantic.selector,
        rect: semantic.rect
      };
    }

    function correlate(event) {
      if (!event || typeof event !== 'object') return event;
      const el = targetForEvent(event);
      const semanticTarget = compactSemantic(el);
      return semanticTarget ? { ...event, semanticTarget } : event;
    }

    function correlateBatch(events) {
      return Array.isArray(events) ? events.map(correlate) : [];
    }

    return { correlate, correlateBatch };
  }

  NS.PhysicalSemanticCorrelator = { createCorrelator };
})(typeof globalThis !== 'undefined' ? globalThis : this);
