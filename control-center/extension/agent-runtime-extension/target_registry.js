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

  function normalizeRect(rect) {
    const x = finite(rect?.x), y = finite(rect?.y), width = finite(rect?.width), height = finite(rect?.height);
    if (x == null || y == null || width == null || height == null || width <= 0 || height <= 0) return null;
    return {
      x, y, width, height,
      centerX: x + width / 2,
      centerY: y + height / 2
    };
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
        map.set(ref, {
          ref,
          tabId: Number(tabId),
          frameId: Number.isInteger(Number(raw.frameId)) ? Number(raw.frameId) : Number(frameId || 0),
          tag: raw.tag || null,
          role: raw.role || null,
          label: raw.label || null,
          editable: !!raw.editable,
          enabled: raw.enabled !== false,
          visible: raw.visible !== false,
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
      return { ...target, observationId, observationCreatedAt: record.createdAt };
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

  return { createRegistry, normalizeRect, publicTarget };
});
