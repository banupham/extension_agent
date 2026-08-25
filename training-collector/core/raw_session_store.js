'use strict';

(function initRawSessionStore(root) {
  const NS = root.TrainingCollectorV03 = root.TrainingCollectorV03 || {};

  const VERSION = '0.5.0';
  const SESSION_KEY_PREFIX = 'tcRawSessionV03:';
  const CHUNK_KEY_PREFIX = 'tcRawChunkV03:';
  const INDEX_KEY = 'tcRawSessionIndexV03';
  const CURRENT_SESSION_KEY = 'tcCurrentBrowserSessionV03';
  const CHUNK_SIZE = 500;
  const MAX_SESSION_INDEX = 12;

  function createSession(sessionId, startedAt) {
    return {
      schemaVersion: VERSION,
      sessionId,
      status: 'active',
      startedAt,
      endedAt: null,
      lastSeenAt: startedAt,
      endReason: null,
      eventCount: 0,
      chunkCount: 0,
      lastChunkSize: 0,
      privacy: {
        rawTextValuesStored: false,
        passwordValuesStored: false,
        cookiesStored: false,
        localStorageStored: false,
        sessionStorageStored: false,
        authorizationStored: false,
        clipboardContentStored: false
      },
      rawModel: {
        pointerSamples: 'unaggregated-browser-events',
        idle: 'timestamp-gaps-plus-idle-gap-markers',
        keyboard: 'timing-and-operation-class-without-printable-character-content',
        wheel: 'raw-delta-samples',
        scroll: 'raw-position-samples',
        dom: 'compact-targetRef-events-with-first-seen-descriptors',
        mutation: '120ms-structural-mutation-bursts',
        correlation: 'targetRef-at-capture-time-with-first-seen-descriptor',
        timeline: 'tsEpochMs-is-capture-time-storageSeq-is-persistence-order',
        export: 'debug-json-and-jsonl-adapters-temporary'
      }
    };
  }

  function sessionKey(sessionId) { return `${SESSION_KEY_PREFIX}${sessionId}`; }
  function chunkKey(sessionId, chunkIndex) { return `${CHUNK_KEY_PREFIX}${sessionId}:${chunkIndex}`; }
  function makeSessionId(now = Date.now()) { return `browser-${now}-${Math.random().toString(36).slice(2, 10)}`; }

  function normalizeEvent(event) {
    if (!event || typeof event !== 'object') return null;
    return { rawVersion: VERSION, ...event };
  }

  NS.RawSessionStore = {
    VERSION,
    INDEX_KEY,
    CURRENT_SESSION_KEY,
    CHUNK_SIZE,
    MAX_SESSION_INDEX,
    createSession,
    sessionKey,
    chunkKey,
    makeSessionId,
    normalizeEvent
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
