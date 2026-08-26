'use strict';

(function initTargetRegistry(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AgentTargetRegistry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  function finite(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function optionalFinite(value) {
    if (value == null || value === '') return null;
    return finite(value);
  }

  function normalizeRangeStep(value) {
    if (value === 'any') return 'any';
    return optionalFinite(value);
  }

  function normalizeRect(rect) {
    const x = finite(rect?.x), y = finite(rect?.y), width = finite(rect?.width), height = finite(rect?.height);
    if (x == null || y == null || width == null || height == null || width <= 0 || height <= 0) return null;
    return {
      x, y, width, height,
      centerX: x + width / 2,
      centerY: y + height / 2
    };
  }

  function normalizeOptions(options) {
    if (!Array.isArray(options)) return [];
    return options.slice(0, 100).map((option, index) => ({
      index: option?.index != null && Number.isInteger(Number(option.index)) ? Number(option.index) : index,
      value: String(option?.value ?? ''),
      label: String(option?.label ?? '').slice(0, 160),
      disabled: option?.disabled === true,
      selected: option?.selected === true
    }));
  }

  function normalizeFramePath(framePath) {
    if (!Array.isArray(framePath)) return [];
    return framePath.slice(0, 16).map(value => Number(value)).filter(Number.isInteger).filter(value => value >= 0);
  }

  function geometryChanged(observedRect, liveRect, tolerancePx = 2) {
    const observed = normalizeRect(observedRect);
    const live = normalizeRect(liveRect);
    if (!observed || !live) return true;
    const tolerance = Math.max(0, finite(tolerancePx) ?? 2);
    return ['x', 'y', 'width', 'height'].some(key => Math.abs(observed[key] - live[key]) > tolerance);
  }

  function publicTarget(target) {
    return {
      ref: target.ref,
      tag: target.tag || null,
      role: target.role || null,
      label: target.label || null,
      editable: !!target.editable,
      enabled: target.enabled !== false,
      visible: target.visible !== false,
      frameDepth: Number.isInteger(Number(target.frameDepth)) ? Number(target.frameDepth) : 0,
      inputType: target.inputType || null,
      checked: typeof target.checked === 'boolean' ? target.checked : null,
      selectedValue: target.selectedValue == null ? null : String(target.selectedValue),
      selectedIndex: target.selectedIndex != null && Number.isInteger(Number(target.selectedIndex)) ? Number(target.selectedIndex) : null,
      options: Array.isArray(target.options) ? target.options.map(option => ({ ...option })) : [],
      rangeValue: optionalFinite(target.rangeValue),
      rangeMin: optionalFinite(target.rangeMin),
      rangeMax: optionalFinite(target.rangeMax),
      rangeStep: normalizeRangeStep(target.rangeStep),
      rect: target.rect ? {
        x: target.rect.x,
        y: target.rect.y,
        width: target.rect.width,
        height: target.rect.height
      } : null
    };
  }

  function createRegistry(options = {}) {
    const ttlMs = Number.isFinite(Number(options.ttlMs)) ? Number(options.ttlMs) : 4000;
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const latestByTab = new Map();
    const observations = new Map();

    function register({ observationId, tabId, url = null, frameId = 0, targets = [] }) {
      if (!observationId || !Number.isInteger(Number(tabId))) throw new Error('invalid_observation_registration');
      const createdAt = now();
      const map = new Map();
      for (const raw of targets) {
        const ref = typeof raw?.ref === 'string' && raw.ref ? raw.ref : null;
        if (!ref) continue;
        const rect = normalizeRect(raw.rect);
        const framePath = normalizeFramePath(raw.framePath);
        map.set(ref, {
          ref,
          tabId: Number(tabId),
          frameId: Number.isInteger(Number(raw.frameId)) ? Number(raw.frameId) : Number(frameId || 0),
          framePath,
          frameDepth: Number.isInteger(Number(raw.frameDepth)) ? Number(raw.frameDepth) : framePath.length,
          frameUrl: typeof raw.frameUrl === 'string' ? raw.frameUrl : null,
          tag: raw.tag || null,
          role: raw.role || null,
          label: raw.label || null,
          editable: !!raw.editable,
          enabled: raw.enabled !== false,
          visible: raw.visible !== false,
          inputType: typeof raw.inputType === 'string' ? raw.inputType : null,
          checked: typeof raw.checked === 'boolean' ? raw.checked : null,
          selectedValue: raw.selectedValue == null ? null : String(raw.selectedValue),
          selectedIndex: raw.selectedIndex != null && Number.isInteger(Number(raw.selectedIndex)) ? Number(raw.selectedIndex) : null,
          options: normalizeOptions(raw.options),
          rangeValue: optionalFinite(raw.rangeValue),
          rangeMin: optionalFinite(raw.rangeMin),
          rangeMax: optionalFinite(raw.rangeMax),
          rangeStep: normalizeRangeStep(raw.rangeStep),
          selector: typeof raw.selector === 'string' ? raw.selector : null,
          rect
        });
      }
      const record = { observationId, tabId: Number(tabId), url, frameId: Number(frameId || 0), createdAt, targets: map };
      observations.set(observationId, record);
      latestByTab.set(Number(tabId), observationId);
      return {
        observationId,
        createdAt,
        expiresAt: createdAt + ttlMs,
        targets: [...map.values()].map(publicTarget)
      };
    }

    function resolve({ observationId, tabId, targetRef, currentUrl = null }) {
      if (!observationId) throw new Error('observation_id_required');
      if (!targetRef) throw new Error('target_ref_required');
      const record = observations.get(observationId);
      if (!record || record.tabId !== Number(tabId)) throw new Error('stale_observation');
      if (latestByTab.get(Number(tabId)) !== observationId) throw new Error('stale_observation');
      if (now() - record.createdAt > ttlMs) throw new Error('stale_observation');
      if (currentUrl && record.url && currentUrl !== record.url) throw new Error('stale_observation_url_changed');
      const target = record.targets.get(targetRef);
      if (!target) throw new Error('target_ref_not_found');
      if (!target.visible || !target.enabled) throw new Error('target_not_interactable');
      if (!target.rect) throw new Error('target_rect_unavailable');
      return { ...target, framePath: [...target.framePath], observationId, observationCreatedAt: record.createdAt };
    }

    function invalidateTab(tabId) {
      const id = latestByTab.get(Number(tabId));
      latestByTab.delete(Number(tabId));
      if (id) observations.delete(id);
    }

    function status(tabId) {
      const observationId = latestByTab.get(Number(tabId)) || null;
      const record = observationId ? observations.get(observationId) : null;
      return {
        observationId,
        ageMs: record ? Math.max(0, now() - record.createdAt) : null,
        targetCount: record ? record.targets.size : 0,
        ttlMs
      };
    }

    return { register, resolve, invalidateTab, status, publicTarget };
  }

  return { createRegistry, normalizeRect, normalizeOptions, normalizeFramePath, geometryChanged, publicTarget };
});
