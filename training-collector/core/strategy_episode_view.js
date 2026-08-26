'use strict';

(function initStrategyEpisodeView(root) {
  const NS = root.TrainingCollectorV09 = root.TrainingCollectorV09 || {};
  const STRATEGY_OBSERVATION_VERSION = '0.1.0';

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function finiteOrZero(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function pageUrl(page) {
    if (isObject(page)) {
      const origin = typeof page.origin === 'string' ? page.origin : '';
      const pathname = typeof page.pathname === 'string' ? page.pathname : '';
      return `${origin}${pathname}`;
    }
    const value = typeof page === 'string' ? page.trim() : '';
    if (!value) return '';
    try {
      const parsed = new URL(value);
      return `${parsed.origin}${parsed.pathname}`;
    } catch (_) {
      return value.split('#')[0].split('?')[0];
    }
  }

  function safeRect(rect) {
    if (!isObject(rect)) return null;
    return {
      x: finiteOrZero(rect.x),
      y: finiteOrZero(rect.y),
      width: Math.max(0, finiteOrZero(rect.width)),
      height: Math.max(0, finiteOrZero(rect.height))
    };
  }

  function safeElement(element) {
    if (!isObject(element)) return null;
    const ref = typeof element.ref === 'string' && element.ref.trim() ? element.ref.trim() : null;
    if (!ref) return null;
    return {
      ref,
      tag: typeof element.tag === 'string' ? element.tag : null,
      role: typeof element.role === 'string' ? element.role : null,
      label: typeof element.label === 'string' ? element.label : '',
      editable: element.editable === true,
      enabled: element.enabled !== false,
      rendered: element.rendered === true,
      inViewport: element.inViewport === true,
      interactable: element.interactable === true,
      visible: element.visible !== false,
      rect: safeRect(element.rect)
    };
  }

  function sanitizeSnapshot(snapshot = {}, options = {}) {
    const elements = (Array.isArray(snapshot.interactiveElements) ? snapshot.interactiveElements : [])
      .map(safeElement)
      .filter(Boolean);
    const focusedRef = typeof snapshot.focusedElementRef === 'string' ? snapshot.focusedElementRef : null;
    const focusedElement = focusedRef ? elements.find(element => element.ref === focusedRef) || { ref: focusedRef } : null;
    return {
      strategyObservationVersion: STRATEGY_OBSERVATION_VERSION,
      observationId: typeof options.observationId === 'string' ? options.observationId : null,
      capturedAt: options.capturedAt || new Date().toISOString(),
      url: pageUrl(snapshot.page || snapshot.url || ''),
      title: '',
      viewport: isObject(snapshot.viewport) ? {
        width: Math.max(0, finiteOrZero(snapshot.viewport.width)),
        height: Math.max(0, finiteOrZero(snapshot.viewport.height)),
        devicePixelRatio: Math.max(0, finiteOrZero(snapshot.viewport.devicePixelRatio))
      } : {},
      scroll: isObject(snapshot.scroll) ? {
        x: finiteOrZero(snapshot.scroll.x),
        y: finiteOrZero(snapshot.scroll.y)
      } : {},
      focusedElement,
      interactiveElements: elements,
      pageSignals: {},
      privacy: {
        redacted: true,
        rawTextValuesStored: false,
        passwordValuesStored: false,
        cookiesStored: false,
        storageSecretsStored: false,
        authorizationDataStored: false,
        selectorsStored: false,
        tabIdStored: false,
        policyVersion: 'strategy-episode-view-0.1.0'
      }
    };
  }

  NS.StrategyEpisodeView = {
    STRATEGY_OBSERVATION_VERSION,
    pageUrl,
    safeElement,
    sanitizeSnapshot
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.StrategyEpisodeView;
})(typeof globalThis !== 'undefined' ? globalThis : this);
