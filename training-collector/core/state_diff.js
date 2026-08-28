'use strict';

(function initStateDiff(root) {
  const NS = root.TrainingCollectorV05 = root.TrainingCollectorV05 || {};

  function sameRect(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return ['x', 'y', 'width', 'height'].every(k => Number(a[k] || 0) === Number(b[k] || 0));
  }

  function finiteOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function mediaStateOf(value) {
    if (!value || typeof value !== 'object') return null;
    return {
      paused: value.paused === true,
      muted: value.muted === true,
      volume: finiteOrNull(value.volume),
      currentTime: finiteOrNull(value.currentTime),
      duration: finiteOrNull(value.duration),
      playbackRate: finiteOrNull(value.playbackRate)
    };
  }

  function sameMediaState(a, b) {
    return JSON.stringify(mediaStateOf(a)) === JSON.stringify(mediaStateOf(b));
  }

  function stateOf(el = {}) {
    return {
      enabled: el.enabled !== false,
      rendered: !!el.rendered,
      inViewport: !!el.inViewport,
      interactable: !!el.interactable,
      checked: typeof el.checked === 'boolean' ? el.checked : null,
      selectedIndex: Number.isInteger(Number(el.selectedIndex)) ? Number(el.selectedIndex) : null,
      rangeValue: finiteOrNull(el.rangeValue),
      rangeMin: finiteOrNull(el.rangeMin),
      rangeMax: finiteOrNull(el.rangeMax),
      rangeStep: finiteOrNull(el.rangeStep),
      mediaState: mediaStateOf(el.mediaState),
      rect: el.rect || null
    };
  }

  function sameState(a, b) {
    return a.enabled === b.enabled &&
      a.rendered === b.rendered &&
      a.inViewport === b.inViewport &&
      a.interactable === b.interactable &&
      a.checked === b.checked &&
      a.selectedIndex === b.selectedIndex &&
      a.rangeValue === b.rangeValue &&
      a.rangeMin === b.rangeMin &&
      a.rangeMax === b.rangeMax &&
      a.rangeStep === b.rangeStep &&
      sameMediaState(a.mediaState, b.mediaState) &&
      sameRect(a.rect, b.rect);
  }

  function diffObservation(before = {}, after = {}) {
    const prev = new Map((before.interactiveElements || []).map(x => [x.ref, x]));
    const next = new Map((after.interactiveElements || []).map(x => [x.ref, x]));
    const addedRefs = [];
    const removedRefs = [];
    const elementChanges = [];

    for (const [ref, el] of next) {
      if (!prev.has(ref)) {
        addedRefs.push(ref);
        continue;
      }
      const a = stateOf(prev.get(ref));
      const b = stateOf(el);
      if (!sameState(a, b)) elementChanges.push({ ref, ...b });
    }
    for (const ref of prev.keys()) if (!next.has(ref)) removedRefs.push(ref);

    const diff = {
      schemaVersion: '0.5.0',
      pageInstanceId: after.pageInstanceId || before.pageInstanceId || null,
      addedRefs,
      removedRefs,
      elementChanges
    };

    if (before.focusedElementRef !== after.focusedElementRef) diff.focusedElementRef = after.focusedElementRef || null;
    if (Number(before.scroll?.x || 0) !== Number(after.scroll?.x || 0) || Number(before.scroll?.y || 0) !== Number(after.scroll?.y || 0)) {
      diff.scroll = { x: Number(after.scroll?.x || 0), y: Number(after.scroll?.y || 0) };
    }
    if (before.pageInstanceId && after.pageInstanceId && before.pageInstanceId !== after.pageInstanceId) diff.pageChanged = true;
    return diff;
  }

  NS.StateDiff = { diffObservation, stateOf, sameState };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.StateDiff;
})(typeof globalThis !== 'undefined' ? globalThis : this);
