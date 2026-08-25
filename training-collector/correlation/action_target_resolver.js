'use strict';

(function initActionTargetResolver(root) {
  const NS = root.TrainingCollectorV07 = root.TrainingCollectorV07 || {};
  const ACTIONABLE = 'a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex],video,audio';

  function createActionTargetResolver(options = {}) {
    const observer = options.observer;

    function safeSemantic(el) {
      if (!(el instanceof Element) || !observer || observer.isSensitive(el)) return null;
      try { return observer.semanticElement(el); } catch { return null; }
    }

    function actionableAncestor(el) {
      if (!(el instanceof Element)) return null;
      try { return el.closest(ACTIONABLE) || el; } catch { return el; }
    }

    function pathElements(event) {
      if (!event || typeof event.composedPath !== 'function') return [];
      try { return event.composedPath().filter(x => x instanceof Element); } catch { return []; }
    }

    function firstActionableFromPath(event) {
      for (const el of pathElements(event)) {
        if (el.matches?.(ACTIONABLE)) return el;
      }
      return null;
    }

    function fromPoint(event) {
      const x = Number(event?.clientX);
      const y = Number(event?.clientY);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      try {
        const el = document.elementFromPoint(x, y);
        return el instanceof Element ? actionableAncestor(el) : null;
      } catch { return null; }
    }

    function resolve(event) {
      const rawEl = event?.target instanceof Element ? event.target : null;
      const rawSemantic = safeSemantic(rawEl);

      const pathEl = firstActionableFromPath(event);
      const pointEl = fromPoint(event);
      const rawActionable = actionableAncestor(rawEl);

      const candidates = [
        { el: pathEl, method: 'composed-path-actionable', confidence: 0.98 },
        { el: pointEl, method: 'element-from-point-actionable', confidence: 0.94 },
        { el: rawActionable, method: 'raw-target-actionable-ancestor', confidence: 0.82 },
        { el: rawEl, method: 'raw-target', confidence: 0.65 }
      ];

      let resolved = null;
      for (const candidate of candidates) {
        const semantic = safeSemantic(candidate.el);
        if (!semantic) continue;
        resolved = { ...candidate, semantic };
        break;
      }

      return {
        rawTargetRef: rawSemantic?.ref || null,
        resolvedTargetRef: resolved?.semantic?.ref || rawSemantic?.ref || null,
        resolution: {
          method: resolved?.method || (rawSemantic ? 'raw-target' : 'unresolved'),
          confidence: resolved?.confidence || (rawSemantic ? 0.65 : 0),
          rawAndResolvedSame: !!rawSemantic?.ref && rawSemantic.ref === (resolved?.semantic?.ref || rawSemantic.ref)
        },
        rawSemantic,
        resolvedSemantic: resolved?.semantic || rawSemantic || null
      };
    }

    return { resolve, actionableAncestor };
  }

  NS.ActionTargetResolver = { createActionTargetResolver, ACTIONABLE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
