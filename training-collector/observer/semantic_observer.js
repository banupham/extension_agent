'use strict';

(function initSemanticObserver(root) {
  const NS2 = root.TrainingCollectorV02 = root.TrainingCollectorV02 || {};
  const NS4 = root.TrainingCollectorV04 = root.TrainingCollectorV04 || {};
  const Privacy = NS2.Privacy;
  const registry = NS4.elementRegistry || (NS4.ElementRegistry?.createElementRegistry ? NS4.ElementRegistry.createElementRegistry() : null);
  NS4.elementRegistry = registry;

  const fallbackRefs = new WeakMap();
  let fallbackNextRef = 1;

  function getRef(el) {
    if (!(el instanceof Element)) return null;
    if (registry) return registry.getRef(el);
    if (!fallbackRefs.has(el)) fallbackRefs.set(el, `e${fallbackNextRef++}`);
    return fallbackRefs.get(el);
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity || 1) !== 0;
  }

  function cssSelector(el) {
    if (!(el instanceof Element)) return null;
    if (el.id) return `#${CSS.escape(el.id)}`;
    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
    const name = el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    const role = el.getAttribute('role');
    if (role) return `${el.tagName.toLowerCase()}[role="${CSS.escape(role)}"]`;
    return el.tagName.toLowerCase();
  }

  function rawMeta(el) {
    return {
      type: el.getAttribute('type'),
      name: el.getAttribute('name'),
      id: el.id,
      autocomplete: el.getAttribute('autocomplete'),
      ariaLabel: el.getAttribute('aria-label'),
      placeholder: el.getAttribute('placeholder'),
      label: el.labels?.length ? Array.from(el.labels).map(x => (x.innerText || '').trim()).filter(Boolean).join(' ') : ''
    };
  }

  function privacyFor(el) {
    return Privacy.classifyElementMeta(rawMeta(el));
  }

  function isSensitive(el) {
    return !!privacyFor(el).sensitive;
  }

  function semanticElement(el) {
    if (!(el instanceof Element)) return null;
    const rect = el.getBoundingClientRect();
    const meta = rawMeta(el);
    const privacy = Privacy.classifyElementMeta(meta);
    if (privacy.sensitive) return null;
    const label = meta.ariaLabel || meta.placeholder || meta.label || '';
    const tag = el.tagName.toLowerCase();
    return {
      ref: getRef(el),
      tag,
      role: el.getAttribute('role') || null,
      label: Privacy.redactText(label, false),
      editable: !!(el.isContentEditable || ['input', 'textarea', 'select'].includes(tag)),
      enabled: !el.matches(':disabled'),
      visible: visible(el),
      selector: cssSelector(el),
      rect: {
        x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.round(rect.width), height: Math.round(rect.height)
      }
    };
  }

  function snapshot() {
    const candidates = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex]'))
      .filter(visible).slice(0, 500);
    const active = document.activeElement && document.activeElement !== document.body && !isSensitive(document.activeElement) ? document.activeElement : null;
    return {
      schemaVersion: '0.4.0',
      pageInstanceId: NS2.pageInstanceId,
      page: Privacy.sanitizeUrl(location.href),
      titleMetrics: Privacy.safePageTitle(document.title),
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      scroll: { x: Math.round(scrollX), y: Math.round(scrollY) },
      focusedElementRef: active instanceof Element ? getRef(active) : null,
      interactiveElements: candidates.map(semanticElement).filter(Boolean),
      registry: registry?.stats ? registry.stats() : null
    };
  }

  NS2.SemanticObserver = { getRef, semanticElement, snapshot, cssSelector, isSensitive };
})(typeof globalThis !== 'undefined' ? globalThis : this);
