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
  const NS11 = window.TrainingCollectorV11 = window.TrainingCollectorV11 || {};
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
  const EpisodeTransitionOrderFactory = NS11.EpisodeTransitionOrder;
  const IS_TOP_FRAME = window === window.top;
  const HEALTH_INTERVAL_MS = 10000;
  const AUTO_CAPTURE_KEY = 'trainingCollectorAutoCaptureEnabledV1';
  const STRATEGY_HOVER_DWELL_MS = 350;
  const STRATEGY_WAIT_MIN_MS = 500;
  const STRATEGY_WAIT_COOLDOWN_MS = 350;

  const S = {
    rawActive: false,
    autoCaptureEnabled: true,
    episodeActive: false,
    startedAt: performance.now(),
    transitionSeq: 0,
    pageSeq: 0,
    sourceSeq: new Map(),
    sourceEventCounts: new Map(),
    lastKeyByRef: new Map(),
    beforeInputByRef: new Map(),
    controlBeforeByRef: new Map(),
    transitionBefore: new Map(),
    lastEpisodeState: null,
    lastHumanActionAt: 0,
    lastWaitObservationAt: 0,
    waitObservationInFlight: false,
    scrollTimer: null,
    healthTimer: null,
    strategyHoverTimer: null,
    strategyHoverRef: null,
    strategyHoverBefore: null,
    dragState: null,
    browserSessionId: null,
    physical: null,
    domCapture: null,
    mutationTrace: null,
    hoverTrace: null,
    routeTrace: null,
    correlator: null,
    targetResolver: null,
    rawSender: null,
    transitionOrder: EpisodeTransitionOrderFactory?.createTransitionOrder?.() || null
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

  function strategySemanticFingerprint(snapshot) {
    const view = strategyObservation(snapshot, 'fingerprint', 'state');
    if (!view) return '';
    const elements = (view.interactiveElements || []).map(element => ({
      ref: element.ref || null,
      label: element.label || '',
      role: element.role || null,
      tag: element.tag || null,
      editable: element.editable === true,
      checked: typeof element.checked === 'boolean' ? element.checked : null,
      selectedIndex: Number.isInteger(Number(element.selectedIndex)) ? Number(element.selectedIndex) : null,
      rangeValue: Number.isFinite(Number(element.rangeValue)) ? Number(element.rangeValue) : null,
      visible: element.visible !== false,
      enabled: element.enabled !== false
    })).sort((a, b) => String(a.ref).localeCompare(String(b.ref)));
    return JSON.stringify({ url: view.url || '', elements });
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
      physical: !!S.physical?.running,
      dom: !!S.rawActive,
      mutation: !!S.mutationTrace,
      hover: !!S.rawActive,
      navigation: !!S.routeTrace?.running
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
    if (!(rawAction?.kind === 'observe' && rawAction?.operation === 'wait')) {
      S.lastHumanActionAt = performance.now();
    }
    const id = transitionId();
    const currentBefore = stateBefore || Observer.snapshot();
    const action = Normalizer.normalize({ ...rawAction, t: Math.round(relTime()) });
    const canDiff = !!(StateDiff?.diffObservation && S.lastEpisodeState && S.lastEpisodeState.pageInstanceId === currentBefore.pageInstanceId);
    S.transitionBefore.set(id, currentBefore);
    const startPromise = send('TRANSITION_START', { transition: {
      transitionId: id,
      startedAtMs: Math.round(relTime()),
      stateBefore: canDiff ? null : currentBefore,
      stateBeforeDiff: canDiff ? StateDiff.diffObservation(S.lastEpisodeState, currentBefore) : null,
      strategyObservationBefore: strategyObservation(currentBefore, id, 'before'),
      action
    } });
    S.transitionOrder?.registerStart?.(id, startPromise);
    return id;
  }

  function finish(id, delay = 0) {
    if (!id) return;
    setTimeout(async () => {
      if (!S.episodeActive || !IS_TOP_FRAME) return;
      const completeTransition = async () => {
        const before = S.transitionBefore.get(id) || null;
        const after = Observer.snapshot();
        const canDiff = !!(before && StateDiff?.diffObservation && before.pageInstanceId === after.pageInstanceId);
        await send('TRANSITION_END', { transition: {
          transitionId: id,
          endedAtMs: Math.round(relTime()),
          stateAfter: canDiff ? null : after,
          stateAfterDiff: canDiff ? StateDiff.diffObservation(before, after) : null,
          strategyObservationAfter: strategyObservation(after, id, 'after'),
          actionSucceeded: true
        } });
        S.transitionBefore.delete(id);
        S.lastEpisodeState = after;
      };
      if (S.transitionOrder?.afterStart) await S.transitionOrder.afterStart(id, completeTransition);
      else await completeTransition();
    }, delay);
  }

  function targetElement(event) {
    if (!(event.target instanceof Element)) return null;
    return event.target.closest('a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex],[draggable="true"],video,audio') || event.target;
  }

  function semanticForEvent(event) {
    const el = targetElement(event);
    if (!el || Observer.isSensitive(el)) return { el: null, semantic: null, resolved: null };
    const semantic = Observer.semanticElement(el);
    if (!semantic) return { el, semantic: null, resolved: null };
    let resolved = null;
    try { resolved = S.targetResolver?.resolve?.(event) || null; } catch {}
    return { el, semantic, resolved };
  }

  function keyModifiers(event) {
    return { alt: !!event.altKey, ctrl: !!event.ctrlKey, meta: !!event.metaKey, shift: !!event.shiftKey };
  }

  function isFormControlSemantic(semantic) {
    return semantic?.tag === 'select' || (semantic?.tag === 'input' && ['checkbox', 'radio', 'range'].includes(String(semantic.inputType || '').toLowerCase()));
  }

  function rememberControlBefore(event) {
    if (!S.episodeActive || !IS_TOP_FRAME) return;
    const { semantic } = semanticForEvent(event);
    if (!semantic || !isFormControlSemantic(semantic)) return;
    S.controlBeforeByRef.set(semantic.ref, Observer.snapshot());
  }

  function clearStrategyHover() {
    if (S.strategyHoverTimer) clearTimeout(S.strategyHoverTimer);
    S.strategyHoverTimer = null;
    S.strategyHoverRef = null;
    S.strategyHoverBefore = null;
  }

  function handleEpisodeMutationBurst(burst) {
    if (!S.episodeActive || !IS_TOP_FRAME || S.waitObservationInFlight || !S.lastEpisodeState || !S.lastHumanActionAt) return;
    const now = performance.now();
    const waitedMs = now - S.lastHumanActionAt;
    if (waitedMs < STRATEGY_WAIT_MIN_MS || now - S.lastWaitObservationAt < STRATEGY_WAIT_COOLDOWN_MS) return;
    const after = Observer.snapshot();
    if (strategySemanticFingerprint(S.lastEpisodeState) === strategySemanticFingerprint(after)) return;
    const addedRefs = Array.isArray(burst?.addedRefs) ? burst.addedRefs : [];
    const afterRefs = new Set((after.interactiveElements || []).map(item => item?.ref).filter(Boolean));
    const targetRef = addedRefs.find(ref => afterRefs.has(ref)) || null;
    const before = S.lastEpisodeState;
    S.waitObservationInFlight = true;
    S.lastWaitObservationAt = now;
    const id = begin({ kind: 'observe', operation: 'wait', targetRef, waitedMs: Math.round(waitedMs) }, before);
    finish(id, 0);
    setTimeout(() => { S.waitObservationInFlight = false; }, STRATEGY_WAIT_COOLDOWN_MS);
  }

  function ensureMutationTrace() {
    if (S.mutationTrace || !MutationTraceFactory?.createMutationTrace) return S.mutationTrace;
    S.mutationTrace = MutationTraceFactory.createMutationTrace({
      observer: Observer,
      decorateEvent,
      onBurst: handleEpisodeMutationBurst,
      emitBatch(events) { if (S.rawActive) rawBatch(events, 'mutation'); }
    });
    return S.mutationTrace;
  }

  function syncMutationTrace() {
    const trace = ensureMutationTrace();
    if (!trace) return;
    if (S.rawActive || S.episodeActive) trace.start?.();
    else trace.stop?.();
  }

  function startRawCapture() {
    if (S.rawActive || !S.autoCaptureEnabled || !S.rawSender || !PhysicalCapture?.createPhysicalCapture) return;
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
    syncMutationTrace();
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
      snapshotReason: 'capture-resumed',
      observation: initialObservation
    }, 'semantic')], 'semantic');

    S.routeTrace?.start(initialObservation.page || null);
    emitHealth('collector-stream-start');
    S.healthTimer = setInterval(() => emitHealth('collector-stream-health'), HEALTH_INTERVAL_MS);
  }

  function stopRawCapture() {
    if (!S.rawActive) return;
    emitHealth('collector-stream-stop');
    if (S.healthTimer) clearInterval(S.healthTimer);
    S.healthTimer = null;
    S.routeTrace?.stop?.();
    S.hoverTrace?.stop?.();
    S.domCapture?.stop?.();
    S.physical?.stop?.();
    S.rawActive = false;
    syncMutationTrace();
  }

  function applyAutoCaptureEnabled(enabled) {
    S.autoCaptureEnabled = enabled !== false;
    if (S.autoCaptureEnabled) startRawCapture();
    else stopRawCapture();
  }

  addEventListener('pointerdown', rememberControlBefore, true);

  addEventListener('click', event => {
    const { semantic, resolved } = semanticForEvent(event);
    if (!semantic) return;
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

  addEventListener('dblclick', event => {
    if (!S.episodeActive || !IS_TOP_FRAME) return;
    const { semantic, resolved } = semanticForEvent(event);
    if (!semantic) return;
    const id = begin({
      kind: 'double-click',
      targetRef: resolved?.resolvedTargetRef || semantic.ref,
      rawTargetRef: resolved?.rawTargetRef || semantic.ref,
      resolutionConfidence: resolved?.resolution?.confidence ?? null,
      button: event.button,
      point: { x: Math.round(event.clientX), y: Math.round(event.clientY) }
    });
    finish(id, 60);
  }, true);

  addEventListener('pointerover', event => {
    if (!S.episodeActive || !IS_TOP_FRAME) return;
    const { semantic } = semanticForEvent(event);
    if (!semantic || semantic.ref === S.strategyHoverRef) return;
    clearStrategyHover();
    S.strategyHoverRef = semantic.ref;
    S.strategyHoverBefore = Observer.snapshot();
    const ref = semantic.ref;
    S.strategyHoverTimer = setTimeout(() => {
      if (!S.episodeActive || S.strategyHoverRef !== ref) return;
      const before = S.strategyHoverBefore;
      const id = begin({ kind: 'hover', targetRef: ref, dwellMs: STRATEGY_HOVER_DWELL_MS }, before);
      finish(id, 20);
      S.strategyHoverTimer = null;
    }, STRATEGY_HOVER_DWELL_MS);
  }, true);

  addEventListener('pointerout', event => {
    if (!S.strategyHoverRef) return;
    const currentRef = S.strategyHoverRef;
    const related = event.relatedTarget instanceof Element
      ? (event.relatedTarget.closest('a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex],[draggable="true"],video,audio') || event.relatedTarget)
      : null;
    if (related && !Observer.isSensitive(related)) {
      const relatedSemantic = Observer.semanticElement(related);
      if (relatedSemantic?.ref === currentRef) return;
    }
    clearStrategyHover();
  }, true);

  addEventListener('dragstart', event => {
    if (!S.episodeActive || !IS_TOP_FRAME) return;
    const { semantic } = semanticForEvent(event);
    if (!semantic) return;
    S.dragState = {
      sourceRef: semantic.ref,
      before: Observer.snapshot(),
      startedAt: performance.now()
    };
  }, true);

  addEventListener('drop', event => {
    if (!S.episodeActive || !IS_TOP_FRAME || !S.dragState?.sourceRef) return;
    const { semantic } = semanticForEvent(event);
    if (!semantic || semantic.ref === S.dragState.sourceRef) return;
    const drag = S.dragState;
    S.dragState = null;
    const id = begin({
      kind: 'drag',
      targetRef: drag.sourceRef,
      destinationRef: semantic.ref,
      button: 0
    }, drag.before);
    finish(id, 80);
  }, true);

  addEventListener('dragend', () => {
    setTimeout(() => { S.dragState = null; }, 120);
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
    if (semantic && isFormControlSemantic(semantic) && !S.controlBeforeByRef.has(ref)) {
      S.controlBeforeByRef.set(ref, Observer.snapshot());
    }
    const id = begin({
      kind: editable ? 'text-key' : 'key',
      targetRef: ref,
      operation,
      keyClass: event.key.length === 1 ? 'printable' : event.key,
      code: event.key.length === 1 ? null : event.code,
      repeat: event.repeat,
      modifiers: keyModifiers(event)
    });
    finish(id, 20);
  }, true);

  addEventListener('beforeinput', event => {
    if (!S.episodeActive || !IS_TOP_FRAME) return;
    const el = event.target instanceof Element ? event.target : null;
    if (!el || Observer.isSensitive(el)) return;
    const semantic = Observer.semanticElement(el);
    if (!semantic?.editable) return;
    S.beforeInputByRef.set(semantic.ref, { at: performance.now(), stateBefore: Observer.snapshot(), inputType: event.inputType || null });
  }, true);

  addEventListener('input', event => {
    if (!S.episodeActive || !IS_TOP_FRAME) return;
    const el = event.target instanceof Element ? event.target : null;
    if (!el || Observer.isSensitive(el)) return;
    const semantic = Observer.semanticElement(el);
    if (!semantic?.editable) return;
    const recentKeyAt = S.lastKeyByRef.get(semantic.ref) || 0;
    if (performance.now() - recentKeyAt < 120) return;
    const pending = S.beforeInputByRef.get(semantic.ref);
    S.beforeInputByRef.delete(semantic.ref);
    const valueLength = typeof el.value === 'string' ? el.value.length : (el.textContent || '').length;
    const id = begin({ kind: 'text-change', targetRef: semantic.ref, inputType: event.inputType || pending?.inputType || null, length: valueLength }, pending?.stateBefore || Observer.snapshot());
    finish(id, 20);
  }, true);

  addEventListener('change', event => {
    if (!S.episodeActive || !IS_TOP_FRAME) return;
    const el = event.target instanceof Element ? event.target : null;
    if (!el || Observer.isSensitive(el)) return;
    const semantic = Observer.semanticElement(el);
    if (!semantic || !isFormControlSemantic(semantic)) return;
    const before = S.controlBeforeByRef.get(semantic.ref) || S.lastEpisodeState || Observer.snapshot();
    S.controlBeforeByRef.delete(semantic.ref);
    const raw = {
      kind: 'change',
      targetRef: semantic.ref,
      controlType: semantic.tag === 'select' ? 'select' : semantic.inputType
    };
    if (typeof semantic.checked === 'boolean') raw.checked = semantic.checked;
    if (Number.isInteger(Number(semantic.selectedIndex))) raw.selectedIndex = Number(semantic.selectedIndex);
    if (Number.isFinite(Number(semantic.rangeValue))) raw.rangeValue = Number(semantic.rangeValue);
    if (Number.isFinite(Number(semantic.rangeMin))) raw.rangeMin = Number(semantic.rangeMin);
    if (Number.isFinite(Number(semantic.rangeMax))) raw.rangeMax = Number(semantic.rangeMax);
    if (Number.isFinite(Number(semantic.rangeStep))) raw.rangeStep = Number(semantic.rangeStep);
    const id = begin(raw, before);
    finish(id, 30);
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
    clearStrategyHover();
    S.dragState = null;
    S.controlBeforeByRef.clear();
    stopRawCapture();
    if (!S.episodeActive) syncMutationTrace();
  }, true);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.scope !== 'TRAINING_COLLECTOR_V03') return false;
    if (message.type === 'START_EPISODE_CAPTURE') {
      if (!IS_TOP_FRAME) { sendResponse({ ok: true, ignoredSubframe: true, pageInstanceId: NS2.pageInstanceId }); return false; }
      S.episodeActive = true;
      S.lastEpisodeState = Observer.snapshot();
      S.lastHumanActionAt = 0;
      S.lastWaitObservationAt = 0;
      S.waitObservationInFlight = false;
      S.transitionBefore.clear();
      S.transitionOrder?.clear?.();
      S.beforeInputByRef.clear();
      S.controlBeforeByRef.clear();
      clearStrategyHover();
      S.dragState = null;
      syncMutationTrace();
      sendResponse({ ok: true, pageInstanceId: NS2.pageInstanceId });
      return false;
    }
    if (message.type === 'STOP_EPISODE_CAPTURE') {
      S.episodeActive = false;
      S.lastEpisodeState = null;
      S.lastHumanActionAt = 0;
      S.lastWaitObservationAt = 0;
      S.waitObservationInFlight = false;
      S.transitionBefore.clear();
      S.transitionOrder?.clear?.();
      S.beforeInputByRef.clear();
      S.controlBeforeByRef.clear();
      clearStrategyHover();
      S.dragState = null;
      syncMutationTrace();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'SNAPSHOT') {
      sendResponse({ ok: true, observation: Observer.snapshot(), isTopFrame: IS_TOP_FRAME });
      return false;
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes?.[AUTO_CAPTURE_KEY]) return;
    applyAutoCaptureEnabled(changes[AUTO_CAPTURE_KEY].newValue !== false);
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
    if (S.episodeActive) {
      S.lastEpisodeState = Observer.snapshot();
      syncMutationTrace();
      await send('EPISODE_DOCUMENT_READY', {
        pageInstanceId: NS2.pageInstanceId,
        observedAtMs: Math.round(relTime()),
        observation: S.lastEpisodeState,
        strategyObservation: strategyObservation(S.lastEpisodeState, `${NS2.pageInstanceId}-navigation`, 'after')
      });
    }
    S.rawSender = ReliableSender?.createReliableSender?.({
      send,
      journalKey: `tcRawPendingV072:${NS2.pageInstanceId}`,
      retryMs: 1500,
      maxPending: 128
    }) || null;
    await S.rawSender?.restore?.();
    const pref = await chrome.storage.local.get(AUTO_CAPTURE_KEY).catch(() => ({}));
    applyAutoCaptureEnabled(pref?.[AUTO_CAPTURE_KEY] !== false);
  });
}