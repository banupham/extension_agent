'use strict';

(function initSubframeEpisodeCapture(root) {
  if (root === root.top) return;

  const SCOPE = 'TRAINING_COLLECTOR_FRAME_EPISODE_V1';
  const EPISODE_STATE_KEY = 'trainingCollectorStateV03';
  const NS2 = root.TrainingCollectorV02 || {};
  const NS5 = root.TrainingCollectorV05 || {};
  const NS9 = root.TrainingCollectorV09 || {};
  const Observer = NS2.SemanticObserver;
  const Normalizer = NS2.ActionNormalizer;
  const StateDiff = NS5.StateDiff;
  const StrategyEpisodeView = NS9.StrategyEpisodeView;

  if (!Observer || !Normalizer) return;

  const S = {
    active: false,
    episodeId: null,
    startedAt: performance.now(),
    transitionSeq: 0,
    transitionBefore: new Map(),
    transitionStarts: new Map(),
    lastEpisodeState: null,
    lastKeyByRef: new Map(),
    beforeInputByRef: new Map(),
    scrollTimer: null
  };

  function relTime() { return Math.max(0, performance.now() - S.startedAt); }

  async function send(type, payload = {}) {
    try {
      return await chrome.runtime.sendMessage({ scope: SCOPE, type, ...payload });
    } catch {
      return null;
    }
  }

  function strategyObservation(snapshot, transitionIdValue, phase) {
    if (!StrategyEpisodeView?.sanitizeSnapshot) return null;
    return StrategyEpisodeView.sanitizeSnapshot(snapshot, {
      observationId: `${transitionIdValue}-${phase}`,
      capturedAt: new Date().toISOString()
    });
  }

  function transitionId() {
    S.transitionSeq += 1;
    return `${NS2.pageInstanceId}-sf-t${S.transitionSeq}`;
  }

  function resetEpisodeState() {
    S.transitionBefore.clear();
    S.transitionStarts.clear();
    S.lastKeyByRef.clear();
    S.beforeInputByRef.clear();
    S.lastEpisodeState = S.active ? Observer.snapshot() : null;
  }

  async function announceDocumentReady() {
    if (!S.active) return;
    const observation = Observer.snapshot();
    await send('DOCUMENT_READY', {
      pageInstanceId: NS2.pageInstanceId,
      observedAtMs: Math.round(relTime()),
      observation,
      strategyObservation: strategyObservation(observation, `${NS2.pageInstanceId}-subframe-navigation`, 'after')
    });
    S.lastEpisodeState = observation;
  }

  async function refreshStatus({ announce = false } = {}) {
    const previousActive = S.active;
    const previousEpisodeId = S.episodeId;
    const result = await send('STATUS');
    S.active = result?.ok === true && result.active === true;
    S.episodeId = S.active ? result.episodeId || null : null;
    const changed = previousActive !== S.active || previousEpisodeId !== S.episodeId;
    if (changed) resetEpisodeState();
    if (S.active && (announce || changed)) await announceDocumentReady();
    return S.active;
  }

  function begin(rawAction, stateBefore) {
    if (!S.active) return null;
    const id = transitionId();
    const currentBefore = stateBefore || Observer.snapshot();
    const action = Normalizer.normalize({ ...rawAction, t: Math.round(relTime()) });
    const canDiff = !!(StateDiff?.diffObservation && S.lastEpisodeState && S.lastEpisodeState.pageInstanceId === currentBefore.pageInstanceId);
    S.transitionBefore.set(id, currentBefore);
    const startPromise = send('TRANSITION_START', {
      pageInstanceId: NS2.pageInstanceId,
      transition: {
        transitionId: id,
        startedAtMs: Math.round(relTime()),
        stateBefore: canDiff ? null : currentBefore,
        stateBeforeDiff: canDiff ? StateDiff.diffObservation(S.lastEpisodeState, currentBefore) : null,
        strategyObservationBefore: strategyObservation(currentBefore, id, 'before'),
        action
      }
    });
    S.transitionStarts.set(id, startPromise);
    return id;
  }

  function finish(id, delay = 0) {
    if (!id) return;
    setTimeout(async () => {
      if (!S.active) return;
      const started = await (S.transitionStarts.get(id) || Promise.resolve(null));
      if (!started?.ok || started.ignored === true) return;
      const before = S.transitionBefore.get(id) || null;
      const after = Observer.snapshot();
      const canDiff = !!(before && StateDiff?.diffObservation && before.pageInstanceId === after.pageInstanceId);
      await send('TRANSITION_END', {
        pageInstanceId: NS2.pageInstanceId,
        transition: {
          transitionId: id,
          endedAtMs: Math.round(relTime()),
          stateAfter: canDiff ? null : after,
          stateAfterDiff: canDiff ? StateDiff.diffObservation(before, after) : null,
          strategyObservationAfter: strategyObservation(after, id, 'after'),
          actionSucceeded: true
        }
      });
      S.transitionBefore.delete(id);
      S.transitionStarts.delete(id);
      S.lastEpisodeState = after;
    }, delay);
  }

  function targetElement(event) {
    if (!(event?.target instanceof Element)) return null;
    return event.target.closest('a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex],video,audio') || event.target;
  }

  addEventListener('click', event => {
    if (!S.active) return;
    const el = targetElement(event);
    if (!el || Observer.isSensitive(el)) return;
    const semantic = Observer.semanticElement(el);
    if (!semantic) return;
    const id = begin({
      kind: 'click',
      targetRef: semantic.ref,
      rawTargetRef: semantic.ref,
      button: event.button,
      point: { x: Math.round(event.clientX), y: Math.round(event.clientY) }
    });
    finish(id, 40);
  }, true);

  addEventListener('keydown', event => {
    if (!S.active) return;
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
    const ref = semantic?.ref || null;
    if (ref) S.lastKeyByRef.set(ref, performance.now());
    const id = begin({
      kind: editable ? 'text-key' : 'key',
      targetRef: ref,
      operation,
      keyClass: event.key.length === 1 ? 'printable' : event.key,
      code: event.key.length === 1 ? null : event.code,
      repeat: event.repeat
    });
    finish(id, 20);
  }, true);

  addEventListener('beforeinput', event => {
    if (!S.active) return;
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
    if (!S.active) return;
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
    if (!S.active) return;
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

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes?.[EPISODE_STATE_KEY]) return;
    void refreshStatus();
  });

  void refreshStatus({ announce: true });
})(typeof globalThis !== 'undefined' ? globalThis : this);
