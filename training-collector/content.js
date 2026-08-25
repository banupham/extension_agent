'use strict';

if (!window.__TRAINING_COLLECTOR_V03__) {
  window.__TRAINING_COLLECTOR_V03__ = true;

  const NS2 = window.TrainingCollectorV02 = window.TrainingCollectorV02 || {};
  const NS3 = window.TrainingCollectorV03 = window.TrainingCollectorV03 || {};
  NS2.pageInstanceId = `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const Observer = NS2.SemanticObserver;
  const Normalizer = NS2.ActionNormalizer;
  const PhysicalCapture = NS3.PhysicalCapture;

  const S = {
    rawActive: false,
    episodeActive: false,
    startedAt: performance.now(),
    transitionSeq: 0,
    lastKeyByRef: new Map(),
    beforeInputByRef: new Map(),
    scrollTimer: null,
    browserSessionId: null,
    physical: null
  };

  function relTime() {
    return Math.max(0, performance.now() - S.startedAt);
  }

  function send(type, payload = {}) {
    return chrome.runtime.sendMessage({ scope: 'TRAINING_COLLECTOR_V03', type, ...payload }).catch(() => null);
  }

  function transitionId() {
    S.transitionSeq += 1;
    return `${NS2.pageInstanceId}-t${S.transitionSeq}`;
  }

  function begin(rawAction, stateBefore) {
    if (!S.episodeActive) return null;
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
      if (!S.episodeActive) return;
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

  function startRawCapture() {
    if (S.rawActive || !PhysicalCapture?.createPhysicalCapture) return;
    S.rawActive = true;
    S.physical = PhysicalCapture.createPhysicalCapture({
      isSensitiveTarget(target) {
        return target instanceof Element && Observer.isSensitive(target);
      },
      getContext() {
        return {
          pageInstanceId: NS2.pageInstanceId,
          documentOrigin: location.origin,
          documentPathname: location.pathname
        };
      },
      emitBatch(events) {
        if (!events?.length) return;
        send('RAW_BATCH', {
          batch: {
            browserSessionId: S.browserSessionId,
            pageInstanceId: NS2.pageInstanceId,
            events
          }
        });
      }
    });
    S.physical.start();
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
      code: event.key.length === 1 ? null : event.code,
      repeat: event.repeat
    });
    finish(id, 20);
  }, true);

  addEventListener('beforeinput', event => {
    if (!S.episodeActive) return;
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
    if (!S.episodeActive) return;
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
    if (!S.episodeActive) return;
    clearTimeout(S.scrollTimer);
    S.scrollTimer = setTimeout(() => {
      const before = Observer.snapshot();
      const id = begin({ kind: 'scroll', scroll: { x: Math.round(scrollX), y: Math.round(scrollY) } }, before);
      finish(id, 0);
    }, 180);
  }, { capture: true, passive: true });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.scope !== 'TRAINING_COLLECTOR_V03') return false;
    if (message.type === 'START_EPISODE_CAPTURE') {
      S.episodeActive = true;
      sendResponse({ ok: true, pageInstanceId: NS2.pageInstanceId });
      return false;
    }
    if (message.type === 'STOP_EPISODE_CAPTURE') {
      S.episodeActive = false;
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'SNAPSHOT') {
      sendResponse({ ok: true, observation: Observer.snapshot() });
      return false;
    }
    return false;
  });

  send('HELLO', {
    page: {
      pageInstanceId: NS2.pageInstanceId,
      origin: location.origin,
      pathname: location.pathname
    }
  }).then(response => {
    if (!response?.ok) return;
    S.browserSessionId = response.browserSessionId || null;
    S.episodeActive = !!response.episodeActive;
    startRawCapture();
  });
}
