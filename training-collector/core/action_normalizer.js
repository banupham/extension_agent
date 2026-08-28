'use strict';

(function initActionNormalizer(root) {
  const NS = root.TrainingCollectorV02 = root.TrainingCollectorV02 || {};

  function normalize(raw = {}) {
    const base = {
      actionVersion: '0.3.0',
      kind: String(raw.kind || 'unknown'),
      targetRef: raw.targetRef || null,
      t: Number.isFinite(raw.t) ? Math.round(raw.t) : null
    };

    if (raw.kind === 'click' || raw.kind === 'double-click') {
      return { ...base, button: Number(raw.button || 0), point: raw.point || null };
    }
    if (raw.kind === 'hover') {
      return { ...base, dwellMs: Math.max(0, Number(raw.dwellMs || 0)) };
    }
    if (raw.kind === 'drag') {
      return {
        ...base,
        destinationRef: raw.destinationRef || null,
        button: Number(raw.button || 0)
      };
    }
    if (raw.kind === 'change') {
      return {
        ...base,
        controlType: raw.controlType || null,
        checked: typeof raw.checked === 'boolean' ? raw.checked : null,
        selectedIndex: Number.isInteger(Number(raw.selectedIndex)) ? Number(raw.selectedIndex) : null,
        rangeValue: Number.isFinite(Number(raw.rangeValue)) ? Number(raw.rangeValue) : null
      };
    }
    if (raw.kind === 'media') {
      return {
        ...base,
        operation: raw.operation || null,
        muted: typeof raw.muted === 'boolean' ? raw.muted : null,
        volume: Number.isFinite(Number(raw.volume)) ? Number(raw.volume) : null,
        currentTime: Number.isFinite(Number(raw.currentTime)) ? Number(raw.currentTime) : null,
        duration: Number.isFinite(Number(raw.duration)) ? Number(raw.duration) : null,
        playbackRate: Number.isFinite(Number(raw.playbackRate)) ? Number(raw.playbackRate) : null
      };
    }
    if (raw.kind === 'key') return { ...base, keyClass: raw.keyClass || null, code: raw.code || null, repeat: !!raw.repeat, operation: raw.operation || null };
    if (raw.kind === 'text-key') return { ...base, operation: raw.operation || 'other-key', code: raw.code || null, repeat: !!raw.repeat };
    if (raw.kind === 'text-change') return { ...base, inputType: raw.inputType || null, length: Math.max(0, Number(raw.length || 0)) };
    if (raw.kind === 'scroll') return { ...base, scroll: raw.scroll || { x: 0, y: 0 } };
    if (raw.kind === 'focus') return { ...base, focused: !!raw.focused };
    return base;
  }

  NS.ActionNormalizer = { normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.ActionNormalizer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
