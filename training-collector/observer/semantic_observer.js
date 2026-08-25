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

  function renderState(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const rendered = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity || 1) !== 0;
    const inViewport = rendered && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    const enabled = !el.matches(':disabled,[aria-disabled="true"]');
    const pointerBlocked = cs.pointerEvents === 'none';
    const interactable = rendered && inViewport && enabled && !pointerBlocked;
    return { rendered, inViewport, enabled, interactable };
  }

  function visible(el) { return renderState(el).rendered; }

  function selectorCandidates(el) {
    if (!(el instanceof Element)) return [];
    const out = [];
    const add = (type, value, score) => {
      if (!value || out.some(x => x.value === value)) return;
      out.push({ type, value, score });
    };
    if (el.id) add('id', `#${CSS.escape(el.id)}`, 1);
    const testId = el.getAttribute('data-testid');
    if (testId) add('testid', `[data-testid="${CSS.escape(testId)}"]`, 0.98);
    const name = el.getAttribute('name');
    if (name) add('name', `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`, 0.9);
    const role = el.getAttribute('role');
    if (role) add('role', `${el.tagName.toLowerCase()}[role="${CSS.escape(role)}"]`, 0.65);
    add('tag', el.tagName.toLowerCase(), 0.2);
    return out.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  function cssSelector(el) {
    return selectorCandidates(el)[0]?.value || null;
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

  function privacyFor(el) { return Privacy.classifyElementMeta(rawMeta(el)); }
  function isSensitive(el) { return !!privacyFor(el).sensitive; }

  function semanticElement(el) {
    if (!(el instanceof Element)) return null;
    const meta = rawMeta(el);
    if (Privacy.classifyElementMeta(meta).sensitive) return null;
    const rect = el.getBoundingClientRect();
    const state = renderState(el);
    const label = meta.ariaLabel || meta.placeholder || meta.label || '';
    const tag = el.tagName.toLowerCase();
    const candidates = selectorCandidates(el);
    return {
      ref: getRef(el),
      tag,
      role: el.getAttribute('role') || null,
      label: Privacy.redactText(label, false),
      editable: !!(el.isContentEditable || ['input', 'textarea', 'select'].includes(tag)),
      enabled: state.enabled,
      rendered: state.rendered,
      inViewport: state.inViewport,
      interactable: state.interactable,
      visible: state.rendered,
      selector: candidates[0]?.value || null,
      selectorCandidates: candidates,
      rect: {
        x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.round(rect.width), height: Math.round(rect.height)
      }
    };
  }

  function snapshot() {
    const candidates = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex]'))
      .filter(el => renderState(el).rendered).slice(0, 500);
    const active = document.activeElement && document.activeElement !== document.body && !isSensitive(document.activeElement) ? document.activeElement : null;
    return {
      schemaVersion: '0.5.0',
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

  NS2.SemanticObserver = { getRef, semanticElement, snapshot, cssSelector, selectorCandidates, renderState, isSensitive };
})(typeof globalThis !== 'undefined' ? globalThis : this);
