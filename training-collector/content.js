'use strict';

if (!window.__TRAINING_COLLECTOR_V072__) {
  window.__TRAINING_COLLECTOR_V072__ = true;

  const NS2 = window.TrainingCollectorV02 = window.TrainingCollectorV02 || {};
  const NS3 = window.TrainingCollectorV03 = window.TrainingCollectorV03 || {};
  const NS4 = window.TrainingCollectorV04 = window.TrainingCollectorV04 || {};
  const NS5 = window.TrainingCollectorV05 = window.TrainingCollectorV05 || {};
  const NS6 = window.TrainingCollectorV06 = window.TrainingCollectorV06 || {};
  const NS7 = window.TrainingCollectorV07 = window.TrainingCollectorV07 || {};
  const NS9 = window.TrainingCollectorV09 = window.TrainingCollectorV09 || {};
  NS2.pageInstanceId = `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const Observer = NS2.SemanticObserver;
  const Normalizer = NS2.ActionNormalizer;
  const PhysicalCapture = NS3.PhysicalCapture;
  const CorrelatorFactory = NS4.PhysicalSemanticCorrelator;
  const DomCaptureFactory = NS4.DomCapture;
  const MutationTraceFactory = NS4.MutationTrace;
  const StateDiff = NS5.StateDiff;
  const ReliableSender = NS6.ReliableSender;
  const TargetResolverFactory = NS7.ActionTargetResolver;
  const HoverTraceFactory = NS7.HoverTrace;
  const RouteTraceFactory = NS7.RouteTrace;
  const StrategyEpisodeView = NS9.StrategyEpisodeView;
  const IS_TOP_FRAME = window === window.top;
  const HEALTH_INTERVAL_MS = 10000;

  const S = {
    rawActive: false,
    episodeActive: false,
    startedAt: performance.now(),
    transitionSeq: 0,
    pageSeq: 0,
    sourceSeq: new Map(),
    sourceEventCounts: new Map(),
    lastKeyByRef: new Map(),
    beforeInputByRef: new Map(),
    transitionBefore: new Map(),
    lastEpisodeState: null,
    scrollTimer: null,
    healthTimer: null,
    browserSessionId: null,
    physical: null,
    domCapture: null,
    mutationTrace: null,
    hoverTrace: null,
    routeTrace: null,
    correlator: null,
    targetResolver: null,
    rawSender: null
  };

  function relTime() { return Math.max(0, performance.now() - S.startedAt); }
  function send(type, payload = {}) {
    return chrome.runtime.sendMessage({ scope: 'TRAINING_COLLECTOR_V03', type, ...payload }).catch(() => null);
  }

  function strategyObservation(snapshot, transitionIdValue, phase) {
    if (!StrategyEpisodeView?.sanitizeSnapshot) return null;
    return StrategyEpisodeView.sanitizeSnapshot(snapshot, {
      observationId: `${transitionIdValue}-${phase}`,
      capturedAt: new Date().toISOString()
    });
  }

  function decorateEvent(event, source = 'unknown') {
    S.pageSeq += 1;
    const nextSourceSeq = Number(S.sourceSeq.get(source) || 0) + 1;
    S.sourceSeq.set(source, nextSourceSeq);
    return {
      ...event,
      pageInstanceId: event?.pageInstanceId || NS2.pageInstanceId,
      pageSeq: S.pageSeq,
      sourceSeq: nextSourceSeq
    };
  }

  function rawBatch(events, source) {
    if (!events?.length || !S.rawSender) return;
    const captureSource = source || 'unknown';
    S.sourceEventCounts.set(captureSource, Number(S.sourceEventCounts.get(captureSource) || 0) + events.length);
    S.rawSender.enqueue({
      browserSessionId: S.browserSessionId,
      pageInstanceId: NS2.pageInstanceId,
      source: captureSource,
      events
    });
  }

  function healthCounts() {
    return Object.fromEntries(Array.from(S.sourceEventCounts.entries()).sort(([a], [b]) => a.localeCompare(b)));
  }

  function healthModules() {
    return {
      physical: !!S.physical,
      dom: !!S.domCapture,
      mutation: !!S.mutationTrace,
      hover: !!S.hoverTrace,
      navigation: !!S.routeTrace
    };
  }

  function emitHealth(type = 'collector-stream-health') {
    if (!S.rawActive || !S.rawSender) return;
    rawBatch([decorateEvent({
      type,
      tsEpochMs: Date.now(),
      tPageMs: Math.round(performance.now() * 1000) / 1000,
      isTopFrame: IS_TOP_FRAME,
      readyState: document.readyState,
      visibilityState: document.visibilityState,
      viewport: { width: innerWidth, height: innerHeight },
      modules: healthModules(),
      sourceEventCounts: healthCounts()
    }, 'health')], 'health');
  }

  function transitionId() { S.transitionSeq += 1; return `${NS2.pageInstanceId}-t${S.transitionSeq}`; }
  function begin(rawAction, stateBefore) {
    if (!S.episodeActive || !IS_TOP_FRAME) return null;
    const id = transitionId();
    const currentBefore = stateBefore || Observer.snapshot();
    const action = Normalizer.normalize({ ...rawAction, t: Math.round(relTime()) });
    const canDiff = !!(StateDiff?.diffObservation && S.lastEpisodeState && S.lastEpisodeState.pageInstanceId === currentBefore.pageInstanceId);
    S.transitionBefore.set(id, currentBefore);
    send('TRANSITION_START', { transition: {
      transitionId: id,
      startedAtMs: Math.round(relTime()),
      stateBefore: canDiff ? null : currentBefore,
      stateBeforeDiff: canDiff ? StateDiff.diffObservation(S.lastEpisodeState, currentBefore) : null,
      strategyObservationBefore: strategyObservation(currentBefore, id, 'before'),
      action
    } });
    return id;
  }

  function finish(id, delay = 0) {
    if (!id) return;
    setTimeout(() => {
      if (!S.episodeActive || !IS_TOP_FRAME) return;
      const before = S.transitionBefore.get(id) || null;
      const after = Observer.snapshot();
      const canDiff = !!(before && StateDiff?.diffObservation && before.pageInstanceId === after.pageInstanceId);
      send('TRANSITION_END', { transition: {
        transitionId: id,
        endedAtMs: Math.round(relTime()),
        stateAfter: canDiff ? null : after,
        stateAfterDiff: canDiff ? StateDiff.diffObservation(before, after) : null,
        strategyObservationAfter: strategyObservation(after, id, 'after'),
        actionSucceeded: true
      } });
      S.transitionBefore.delete(id);
      S.lastEpisodeState = after;
    }, delay);
  }

  function targetElement(event) {
    if (!(event.target instanceof Element)) return null;
    return event.target.closest('a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex],video,audio') || event.target;
  }

  function startRawCapture() {
    if (S.rawActive || !PhysicalCapture?.createPhysicalCapture) return;
    S.rawActive = true;
    S.correlator = CorrelatorFactory?.createCorrelator?.({ observer: Observer }) || null;
    S.targetResolver = TargetResolverFactory?.createActionTargetResolver?.({ observer: Observer }) || null;

    S.physical = PhysicalCapture.createPhysicalCapture({
      isSensitiveTarget(target) { return target instanceof Element && Observer.isSensitive(target); },
      getContext() { return { pageInstanceId: NS2.pageInstanceId, documentOrigin: location.origin, documentPathname: location.pathname }; },
      enrichEvent(event) { return S.correlator ? S.correlator.correlate(event) : event; },
      decorateEvent,
      emitBatch(events) { rawBatch(events, 'physical'); }
    });

    S.domCapture = DomCaptureFactory?.createDomCapture?.({
      observer: Observer,
      resolver: S.targetResolver,
      decorateEvent,
      emitBatch(events) { rawBatch(events, 'dom'); }
    }) || null;

    S.mutationTrace = MutationTraceFactory?.createMutationTrace?.({
      observer: Observer,
      decorateEvent,
      emitBatch(events) { rawBatch(events, 'mutation'); }
    }) || null;

    S.hoverTrace = HoverTraceFactory?.createHoverTrace?.({
      observer: Observer,
      decorateEvent,
      emitBatch(events) { rawBatch(events, 'hover'); }
    }) || null;

    S.routeTrace = RouteTraceFactory?.createRouteTrace?.({
      observer: Observer,
      decorateEvent,
      emitBatch(events) {
        for (const event of events || []) rawBatch([event], event.type === 'semantic-snapshot' ? 'semantic' : 'navigation');
      }
    }) || null;

    S.physical.start();
    S.domCapture?.start();
    S.mutationTrace?.start();
    S.hoverTrace?.start();

    const initialObservation = Observer.snapshot();
    rawBatch([decorateEvent({
      type: 'frame-context',
      tsEpochMs: Date.now(),
      tPageMs: Math.round(performance.now() * 1000) / 1000,
      isTopFrame: IS_TOP_FRAME,
      readyState: document.readyState,
      viewport: { width: innerWidth, height: innerHeight },
      coordinateSpace: 'frame-client'
    }, 'semantic')], 'semantic');
    rawBatch([decorateEvent({
      type: 'semantic-snapshot',
      tsEpochMs: Date.now(),
      tPageMs: Math.round(performance.now() * 1000) / 1000,
      snapshotReason: 'document-start',
      observation: initialObservation
    }, 'semantic')], 'semantic');

    S.routeTrace?.start(initialObservation.page || null);
    emitHealth('collector-stream-start');
    S.healthTimer = setInterval(() => emitHealth('collector-stream-health'), HEALTH_INTERVAL_MS);
  }

  addEventListener('click', event => {
    const el = targetElement(event);
    if (!el || Observer.isSensitive(el)) return;
    const semantic = Observer.semanticElement(el);
    if (!semantic) return;
    const resolved = S.targetResolver?.resolve?.(event);
    const id = begin({
      kind: 'click',
      targetRef: resolved?.resolvedTargetRef || semantic.ref,
      rawTargetRef: resolved?.rawTargetRef || semantic.ref,
      resolutionConfidence: resolved?.resolution?.confidence ?? null,
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
    const ref = semantic?.ref || null;
    if (ref) S.lastKeyByRef.set(ref, performance.now());
    const id = begin({ kind: editable ? 'text-key' : 'key', targetRef: ref, operation, keyClass: event.key.length === 1 ? 'printable' : event.key, code: event.key.length === 1 ? null : event.code, repeat: event.repeat });
    finish(id, 20);
  }, true);

  addEventListener('beforeinput', event => {
    if (!S.episodeActive || !IS_TOP_FRAME) return;
    const el = event.target instanceof Element ? event.target : null;
    if (!el || Observer.isSensitive(el)) return;
    const semantic = Observer.semanticElement(el);
    if (!semantic) return;
    S.beforeInputByRef.set(semantic.ref, { at: performance.now(), stateBefore: Observer.snapshot(), inputType: event.inputType || null });
  }, true);

  addEventListener('input', event => {
    if (!S.episodeActive || !IS_TOP_FRAME) return;
    const el = event.target instanceof Element ? event.target : null;
    if (!el || Observer.isSensitive(el)) return;
    const semantic = Observer.semanticElement(el);
    if (!semantic) return;
    const recentKeyAt = S.lastKeyByRef.get(semantic.ref) || 0;
    if (performance.now() - recentKeyAt < 120) return;
    const pending = S.beforeInputByRef.get(semantic.ref);
    S.beforeInputByRef.delete(semantic.ref);
    const valueLength = typeof el.value === 'string' ? el.value.length : (el.textContent || '').length;
    const id = begin({ kind: 'text-change', targetRef: semantic.ref, inputType: event.inputType || pending?.inputType || null, length: valueLength }, pending?.stateBefore || Observer.snapshot());
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
    if (!S.episodeActive || !IS_TOP_FRAME) return;
    clearTimeout(S.scrollTimer);
    S.scrollTimer = setTimeout(() => {
      const before = Observer.snapshot();
      const id = begin({ kind: 'scroll', scroll: { x: Math.round(scrollX), y: Math.round(scrollY) } }, before);
      finish(id, 0);
    }, 180);
  }, { capture: true, passive: true });

  addEventListener('pagehide', () => {
    emitHealth('collector-stream-stop');
    if (S.healthTimer) clearInterval(S.healthTimer);
    S.healthTimer = null;
    S.routeTrace?.stop?.();
  }, true);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.scope !== 'TRAINING_COLLECTOR_V03') return false;
    if (message.type === 'START_EPISODE_CAPTURE') {
      if (!IS_TOP_FRAME) { sendResponse({ ok: true, ignoredSubframe: true, pageInstanceId: NS2.pageInstanceId }); return false; }
      S.episodeActive = true;
      S.lastEpisodeState = Observer.snapshot();
      S.transitionBefore.clear();
      sendResponse({ ok: true, pageInstanceId: NS2.pageInstanceId });
      return false;
    }
    if (message.type === 'STOP_EPISODE_CAPTURE') {
      S.episodeActive = false;
      S.lastEpisodeState = null;
      S.transitionBefore.clear();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'SNAPSHOT') {
      sendResponse({ ok: true, observation: Observer.snapshot(), isTopFrame: IS_TOP_FRAME });
      return false;
    }
    return false;
  });

  send('HELLO', {
    page: {
      pageInstanceId: NS2.pageInstanceId,
      origin: location.origin,
      pathname: location.pathname,
      isTopFrame: IS_TOP_FRAME
    }
  }).then(async response => {
    if (!response?.ok) return;
    S.browserSessionId = response.browserSessionId || null;
    S.episodeActive = IS_TOP_FRAME && !!response.episodeActive;
    if (S.episodeActive) S.lastEpisodeState = Observer.snapshot();
    S.rawSender = ReliableSender?.createReliableSender?.({
      send,
      journalKey: `tcRawPendingV072:${NS2.pageInstanceId}`,
      retryMs: 1500,
      maxPending: 128
    }) || null;
    await S.rawSender?.restore?.();
    startRawCapture();
  });
}
