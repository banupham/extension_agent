' strict';

if (!window.__TRAINING_COLLECTOR_V02__) {
  window.__TRAINING_COLLECTOR_V02__ = true;
  const NS = window.TrainingCollectorV02 = window.TrainingCollectorV02 || {};
  NS.pageInstanceId = `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const Observer = NS.SemanticObserver;
  const Normalizer = NS.ActionNormalizer;
  const S = {
    active: false,
    startedAt: 0,
    transitionSeq: 0,
    lastKeyByRef: new Map(),
    beforeInputByRef: new Map(),
    scrollTimer: null
  };

  function relTime() {
    return S.startedAt ? Math.max(0, performance.now() - S.startedAt) : 0;
  }

  function send(type, payload) {
    if (!S.active) return;
    chrome.runtime.sendMessage({ scope: 'TRAINING_COLLECTOR_V02', type, ...payload }).catch(() => {});
  }

  function transitionId() {
    S.transitionSeq += 1;
    return `${NS.pageInstanceId}-t${S.transitionSeq}`;
  }

  function begin(rawAction, stateBefore) {
    if (!S.active) return null;
    const id = transitionId();
    const action = Normalizer.normalize({ ...rawAction, t: Math.round(relTime()) });
    send('TRANSITION_START', {
      transition: {
        transitionId: id,
        startedAtMs: Math.round(relTime()),
        stateBefore: stateBefore || Observer.snapshot(),
        action
      }
    });
    return id;
  }

  function finish(id, delay = 0) {
    if (!id) return;
    setTimeout(() => {
      if (!S.active) return;
      send('TRANSITION_END', {
        transition: {
          transitionId: id,
          endedAtMs: Math.round(relTime()),
          stateAfter: Observer.snapshot(),
          actionSucceeded: true
        }
      });
    }, delay);
  }

  function targetElement(event) {
    if (!(event.target instanceof Element)) return null;
    return event.target.closest('a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex]') || event.target;
  }

  addEventListener('click', event => {
    const el = targetElement(event);
    if (!el || Observer.isSensitive(el)) return;
    const semantic = Observer.semanticElement(el);
    if (!semantic) return;
    const id = begin({
      kind: 'click',
      targetRef: semantic.ref,
      button: event.button,
      point: { x: Math.round(event.clientX), y: Math.round(event.clientY) }
    });
    finish(id, 40);
  }, true);

  addEventListener('keydown', event => {
    const el = event.target instanceof Element ? event.target : null;
    if (el && Observer.isSensitive(el)) return;
    const semantic = el ? Observer.semanticElement(el) : null;
    const editable = !!semantic?.editable;
    const operation = event.key === 'Backspace' ? 'backspace'
      : event.key === 'Delete' ? 'delete'
      : event.key === 'Enter' ? 'enter'
      : event.key === 'Tab' ? 'tab'
      : event.key.length === 1 ? 'type-char'
      : 'other-key';

    const kind = editable ? 'text-key' : 'key';
    const ref = semantic?.ref || null;
    if (ref) S.lastKeyByRef.set(ref, performance.now());
    const id = begin({
      kind,
      targetRef: ref,
      operation,
      keyClass: event.key.length === 1 ? 'printable' : event.key,
      code: event.code,
      repeat: event.repeat
    });
    finish(id, 20);
  }, true);

  addEventListener('beforeinput', event => {
    const el = event.target instanceof Element ? event.target : null;
    if (!el || Observer.isSensitive(el)) return;
    const semantic = Observer.semanticElement(el);
    if (!semantic) return;
    S.beforeInputByRef.set(semantic.ref, {
      at: performance.now(),
      stateBefore: Observer.snapshot(),
      inputType: event.inputType || null
    });
  }, true);

  addEventListener('input', event => {
    const el = event.target instanceof Element ? event.target : null;
    if (!el || Observer.isSensitive(el)) return;
    const semantic = Observer.semanticElement(el);
    if (!semantic) return;

    const recentKeyAt = S.lastKeyByRef.get(semantic.ref) || 0;
    if (performance.now() - recentKeyAt < 120) return;

    const pending = S.beforeInputByRef.get(semantic.ref);
    S.beforeInputByRef.delete(semantic.ref);
    const valueLength = typeof el.value === 'string' ? el.value.length : (el.textContent || '').length;
    const id = begin({
      kind: 'text-change',
      targetRef: semantic.ref,
      inputType: event.inputType || pending?.inputType || null,
      length: valueLength
    }, pending?.stateBefore || Observer.snapshot());
    finish(id, 20);
  }, true);

  addEventListener('focusin', event => {
    const el = event.target instanceof Element ? event.target : null;
    if (!el || Observer.isSensitive(el)) return;
    const semantic = Observer.semanticElement(el);
    if (!semantic) return;
    const id = begin({ kind: 'focus', targetRef: semantic.ref, focused: true });
    finish(id, 0);
  }, true);

  addEventListener('scroll', () => {
    if (!S.active) return;
    clearTimeout(S.scrollTimer);
    S.scrollTimer = setTimeout(() => {
      const before = Observer.snapshot();
      const id = begin({ kind: 'scroll', scroll: { x: Math.round(scrollX), y: Math.round(scrollY) } }, before);
      finish(id, 0);
    }, 180);
  }, { capture: true, passive: true });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.scope !== 'TRAINING_COLLECTOR_V02') return false;
    if (message.type === 'START') {
      S.active = true;
      S.startedAt = performance.now();
      sendResponse({ ok: true, pageInstanceId: NS.pageInstanceId });
      return false;
    }
    if (message.type === 'STOP') {
      S.active = false;
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'SNAPSHOT') {
      sendResponse({ ok: true, observation: Observer.snapshot() });
      return false;
    }
    return false;
  });
}
