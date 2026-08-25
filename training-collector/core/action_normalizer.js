'use strict';

(function initActionNormalizer(root) {
  const NS = root.TrainingCollectorV02 = root.TrainingCollectorV02 || {};

  function normalize(raw = {}) {
    const base = {
      actionVersion: '0.2.0',
      kind: String(raw.kind || 'unknown'),
      targetRef: raw.targetRef || null,
      t: Number.isFinite(raw.t) ? Math.round(raw.t) : null
    };

    if (raw.kind === 'click') return { ...base, button: Number(raw.button || 0), point: raw.point || null };
    if (raw.kind === 'key') return { ...base, keyClass: raw.keyClass || null, code: raw.code || null, repeat: !!raw.repeat };
    if (raw.kind === 'text-key') return { ...base, operation: raw.operation || 'other-key', code: raw.code || null, repeat: !!raw.repeat };
    if (raw.kind === 'text-change') return { ...base, inputType: raw.inputType || null, length: Math.max(0, Number(raw.length || 0)) };
    if (raw.kind === 'scroll') return { ...base, scroll: raw.scroll || { x: 0, y: 0 } };
    if (raw.kind === 'focus') return { ...base, focused: !!raw.focused };
    return base;
  }

  NS.ActionNormalizer = { normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.ActionNormalizer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
