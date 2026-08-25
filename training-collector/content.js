'use strict';

if (!window.__TRAINING_COLLECTOR_V01__) {
  window.__TRAINING_COLLECTOR_V01__ = true;

  const S = { active: false, startedAt: 0 };

  function relTime() {
    return S.startedAt ? Math.max(0, performance.now() - S.startedAt) : 0;
  }

  function isSensitive(el) {
    if (!(el instanceof Element)) return false;
    const type = String(el.getAttribute('type') || '').toLowerCase();
    const text = [el.getAttribute('name'), el.getAttribute('id'), el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.getAttribute('placeholder')]
      .filter(Boolean).join(' ').toLowerCase();
    if (type === 'password') return true;
    return /(password|passwd|passcode|otp|one[- ]?time|token|secret|cvv|cvc|card.?number|credit.?card)/i.test(text);
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function cssSelector(el) {
    if (!(el instanceof Element)) return null;
    if (el.id) return `#${CSS.escape(el.id)}`;
    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
    const name = el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    return el.tagName.toLowerCase();
  }

  function safeLabel(el) {
    if (isSensitive(el)) return '[REDACTED]';
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.slice(0, 160);
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder.slice(0, 160);
    if (el.labels?.length) return Array.from(el.labels).map(x => (x.innerText || '').trim()).filter(Boolean).join(' ').slice(0, 160);
    return '';
  }

  function semanticElement(el, index) {
    const rect = el.getBoundingClientRect();
    const role = el.getAttribute('role') || null;
    const tag = el.tagName.toLowerCase();
    const editable = !!(el.isContentEditable || ['input', 'textarea', 'select'].includes(tag));
    return {
      ref: `e${index}`,
      tag,
      role,
      label: safeLabel(el),
      editable,
      enabled: !el.matches(':disabled'),
      visible: visible(el),
      sensitive: isSensitive(el),
      selector: cssSelector(el),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  }

  function snapshot() {
    const candidates = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex]'))
      .filter(visible)
      .slice(0, 500);
    return {
      schemaVersion: '0.1.0',
      url: location.href,
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      scroll: { x: scrollX, y: scrollY },
      focusedElement: document.activeElement && document.activeElement !== document.body ? cssSelector(document.activeElement) : null,
      interactiveElements: candidates.map(semanticElement)
    };
  }

  function emit(type, payload) {
    if (!S.active) return;
    chrome.runtime.sendMessage({
      scope: 'TRAINING_COLLECTOR_V01',
      type: 'CONTENT_EVENT',
      event: { type, t: Math.round(relTime()), ...payload }
    }).catch(() => {});
  }

  addEventListener('click', event => {
    const el = event.target instanceof Element ? event.target.closest('a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex]') || event.target : null;
    if (!el) return;
    emit('click', {
      target: semanticElement(el, 0),
      point: { x: Math.round(event.clientX), y: Math.round(event.clientY), button: event.button }
    });
  }, true);

  addEventListener('keydown', event => {
    const el = event.target instanceof Element ? event.target : null;
    const editable = !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
    if (!editable) {
      emit('key', { keyClass: event.key.length === 1 ? 'printable' : event.key, code: event.code, repeat: event.repeat });
      return;
    }
    emit('text-key', {
      target: semanticElement(el, 0),
      operation: event.key === 'Backspace' ? 'backspace' : event.key === 'Delete' ? 'delete' : event.key === 'Enter' ? 'enter' : event.key === 'Tab' ? 'tab' : event.key.length === 1 ? 'type-char' : 'other-key',
      code: event.code,
      repeat: event.repeat,
      sensitive: isSensitive(el)
    });
  }, true);

  addEventListener('input', event => {
    const el = event.target instanceof Element ? event.target : null;
    if (!el) return;
    const valueLength = typeof el.value === 'string' ? el.value.length : (el.textContent || '').length;
    emit('text-change', {
      target: semanticElement(el, 0),
      inputType: event.inputType || null,
      length: valueLength,
      sensitive: isSensitive(el)
    });
  }, true);

  addEventListener('scroll', () => emit('scroll', { scroll: { x: Math.round(scrollX), y: Math.round(scrollY) } }), { capture: true, passive: true });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.scope !== 'TRAINING_COLLECTOR_V01') return false;
    if (message.type === 'START') {
      S.active = true;
      S.startedAt = performance.now();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'STOP') {
      S.active = false;
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'SNAPSHOT') {
      sendResponse({ ok: true, observation: snapshot() });
      return false;
    }
    return false;
  });
}
