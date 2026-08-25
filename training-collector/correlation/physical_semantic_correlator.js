'use strict';

(function initPhysicalSemanticCorrelator(root) {
  const NS = root.TrainingCollectorV04 = root.TrainingCollectorV04 || {};

  function createCorrelator(options = {}) {
    const observer = options.observer;
    const describedRefs = new Set();

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

    function descriptor(semantic) {
      return {
        elementRef: semantic.ref,
        tag: semantic.tag,
        role: semantic.role,
        label: semantic.label,
        editable: semantic.editable,
        selector: semantic.selector,
        selectorCandidates: semantic.selectorCandidates,
        rect: semantic.rect,
        rendered: semantic.rendered,
        inViewport: semantic.inViewport,
        interactable: semantic.interactable
      };
    }

    function correlate(event) {
      if (!event || typeof event !== 'object') return event;
      const el = targetForEvent(event);
      if (!(el instanceof Element) || observer.isSensitive(el)) return event;
      const semantic = observer.semanticElement(el);
      if (!semantic) return event;

      const firstDescription = !describedRefs.has(semantic.ref);
      if (firstDescription) describedRefs.add(semantic.ref);
      return {
        ...event,
        targetRef: semantic.ref,
        ...(firstDescription ? { targetDescriptor: descriptor(semantic) } : {})
      };
    }

    function correlateBatch(events) {
      return Array.isArray(events) ? events.map(correlate) : [];
    }

    return { correlate, correlateBatch };
  }

  NS.PhysicalSemanticCorrelator = { createCorrelator };
})(typeof globalThis !== 'undefined' ? globalThis : this);
