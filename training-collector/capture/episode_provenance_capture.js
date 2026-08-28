'use strict';

(function initEpisodeProvenanceCapture(root) {
  const NS2 = root.TrainingCollectorV02 = root.TrainingCollectorV02 || {};
  const Observer = NS2.SemanticObserver;
  const IS_TOP_FRAME = root === root.top;
  const SCOPE = 'TRAINING_COLLECTOR_V03';

  const state = {
    active: false,
    episodeId: null,
    actionSeq: 0
  };

  function safeSemanticTarget(semantic) {
    if (!semantic || typeof semantic !== 'object') return null;
    const label = typeof semantic.label === 'string' && semantic.label.trim() ? semantic.label.trim().slice(0, 160) : null;
    const role = typeof semantic.role === 'string' && semantic.role.trim() ? semantic.role.trim().toLowerCase().slice(0, 80) : null;
    const tag = typeof semantic.tag === 'string' && semantic.tag.trim() ? semantic.tag.trim().toLowerCase().slice(0, 80) : null;
    if (!label && !role && !tag) return null;
    return {
      label,
      role,
      tag,
      editable: semantic.editable === true,
      enabled: semantic.enabled !== false,
      rendered: semantic.rendered !== false,
      inViewport: semantic.inViewport === true,
      interactable: semantic.interactable === true,
      visible: semantic.visible !== false && semantic.rendered !== false
    };
  }

  function targetElement(event) {
    if (!(event?.target instanceof Element)) return null;
    return event.target.closest('a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex],video,audio') || event.target;
  }

  async function send(type, payload = {}) {
    try {
      return await chrome.runtime.sendMessage({ scope: SCOPE, type, ...payload });
    } catch {
      return null;
    }
  }

  async function refreshEpisodeState() {
    if (!IS_TOP_FRAME) return false;
    const hello = await send('HELLO', {
      page: {
        pageInstanceId: NS2.pageInstanceId || null,
        origin: location.origin,
        pathname: location.pathname,
        isTopFrame: true
      }
    });
    if (!hello?.ok || hello.episodeActive !== true) {
      state.active = false;
      state.episodeId = null;
      return false;
    }
    const current = await send('GET_STATE');
    const episodeId = current?.state?.episode?.episodeId;
    state.active = typeof episodeId === 'string' && !!episodeId.trim();
    state.episodeId = state.active ? episodeId.trim() : null;
    return state.active;
  }

  function rawBatch(events) {
    if (!events?.length || !state.active || !state.episodeId) return;
    void send('RAW_BATCH', {
      batch: {
        source: 'episode-provenance',
        pageInstanceId: NS2.pageInstanceId || null,
        events
      }
    });
  }

  function emitAnchor(actionKind, element) {
    if (!state.active || !state.episodeId || !IS_TOP_FRAME || !Observer) return;
    if (!(element instanceof Element) || Observer.isSensitive(element)) return;
    const semantic = Observer.semanticElement(element);
    if (!semantic?.ref) return;
    const semanticTarget = safeSemanticTarget(semantic);
    if (!semanticTarget) return;
    state.actionSeq += 1;
    rawBatch([{
      type: 'episode-action-anchor',
      tsEpochMs: Date.now(),
      tPageMs: Math.round(performance.now() * 1000) / 1000,
      pageInstanceId: NS2.pageInstanceId || null,
      episodeId: state.episodeId,
      actionSeq: state.actionSeq,
      actionKind: String(actionKind || 'unknown'),
      targetRef: semantic.ref,
      semanticTarget
    }]);
  }

  if (IS_TOP_FRAME) {
    addEventListener('click', event => emitAnchor('click', targetElement(event)), true);
    addEventListener('focusin', event => emitAnchor('focus', targetElement(event)), true);
    addEventListener('keydown', event => emitAnchor('key', targetElement(event)), true);
    addEventListener('input', event => emitAnchor('input', targetElement(event)), true);
    addEventListener('change', event => emitAnchor('change', targetElement(event)), true);
    addEventListener('submit', event => emitAnchor('submit', targetElement(event)), true);
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.scope !== SCOPE) return false;
    if (message.type === 'START_EPISODE_CAPTURE') {
      state.actionSeq = 0;
      void refreshEpisodeState();
      return false;
    }
    if (message.type === 'STOP_EPISODE_CAPTURE') {
      state.active = false;
      state.episodeId = null;
      state.actionSeq = 0;
      return false;
    }
    return false;
  });

  void refreshEpisodeState();

  NS2.EpisodeProvenanceCapture = {
    safeSemanticTarget,
    refreshEpisodeState,
    emitAnchor
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
