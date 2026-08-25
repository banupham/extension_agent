'use strict';

(function initIndexedDbChunkStore(root) {
  const NS = root.TrainingCollectorV06 = root.TrainingCollectorV06 || {};
  const DB_NAME = 'trainingCollectorRawV06';
  const DB_VERSION = 2;
  const SESSION_STORE = 'sessions';
  const CHUNK_STORE = 'chunks';
  const RECEIPT_STORE = 'batchReceipts';

  function req(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('indexeddb_request_failed'));
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('indexeddb_tx_failed'));
      tx.onabort = () => reject(tx.error || new Error('indexeddb_tx_aborted'));
    });
  }

  function checksumEvents(events) {
    const text = JSON.stringify(events || []);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
  }

  function chunkRecord(sessionId, chunkIndex, events) {
    return {
      sessionId,
      chunkIndex,
      eventCount: events.length,
      firstSeq: events[0]?.sessionSeq || null,
      lastSeq: events[events.length - 1]?.sessionSeq || null,
      checksum: checksumEvents(events),
      events
    };
  }

  async function openDb() {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        const sessions = db.createObjectStore(SESSION_STORE, { keyPath: 'sessionId' });
        sessions.createIndex('startedAt', 'startedAt', { unique: false });
        sessions.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains(CHUNK_STORE)) {
        const chunks = db.createObjectStore(CHUNK_STORE, { keyPath: ['sessionId', 'chunkIndex'] });
        chunks.createIndex('sessionId', 'sessionId', { unique: false });
      }
      if (!db.objectStoreNames.contains(RECEIPT_STORE)) {
        const receipts = db.createObjectStore(RECEIPT_STORE, { keyPath: ['sessionId', 'batchId'] });
        receipts.createIndex('sessionId', 'sessionId', { unique: false });
      }
    };
    return req(request);
  }

  function sortSessions(rows) {
    return rows.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
  }

  function createChunkStore(options = {}) {
    const chunkSize = Math.max(100, Number(options.chunkSize || 1000));
    let dbPromise = null;
    const db = () => dbPromise || (dbPromise = openDb());

    async function putSession(session) {
      const database = await db();
      const tx = database.transaction([SESSION_STORE], 'readwrite');
      tx.objectStore(SESSION_STORE).put(session);
      await txDone(tx);
      return session;
    }

    async function getSession(sessionId) {
      const database = await db();
      const tx = database.transaction([SESSION_STORE], 'readonly');
      return req(tx.objectStore(SESSION_STORE).get(sessionId));
    }

    async function listSessions(limit = 24) {
      const database = await db();
      const tx = database.transaction([SESSION_STORE], 'readonly');
      const rows = await req(tx.objectStore(SESSION_STORE).getAll());
      return sortSessions(rows).slice(0, Math.max(1, Number(limit || 24)));
    }

    async function listSessionsByStatus(status, limit = 500) {
      const database = await db();
      const tx = database.transaction([SESSION_STORE], 'readonly');
      const index = tx.objectStore(SESSION_STORE).index('status');
      const rows = await req(index.getAll(IDBKeyRange.only(String(status))));
      return sortSessions(rows).slice(0, Math.max(1, Number(limit || 500)));
    }

    async function append(session, events, batchId = null) {
      if (!session?.sessionId) throw new Error('missing_session');
      if (!Array.isArray(events) || !events.length) return { session, duplicate: false };
      const database = await db();
      const stores = batchId ? [SESSION_STORE, CHUNK_STORE, RECEIPT_STORE] : [SESSION_STORE, CHUNK_STORE];
      const tx = database.transaction(stores, 'readwrite');
      const chunks = tx.objectStore(CHUNK_STORE);
      const receipts = batchId ? tx.objectStore(RECEIPT_STORE) : null;

      if (batchId) {
        const prior = await req(receipts.get([session.sessionId, batchId]));
        if (prior) {
          await txDone(tx);
          return { session: await getSession(session.sessionId) || session, duplicate: true, receipt: prior };
        }
      }

      let chunkIndex = Math.max(0, Number(session.chunkCount || 0) - 1);
      let current = [];
      if (Number(session.chunkCount || 0) > 0 && Number(session.lastChunkSize || 0) < chunkSize) {
        const existing = await req(chunks.get([session.sessionId, chunkIndex]));
        current = Array.isArray(existing?.events) ? existing.events.slice() : [];
      } else if (Number(session.chunkCount || 0) > 0) {
        chunkIndex = Number(session.chunkCount || 0);
      }

      for (const event of events) {
        current.push(event);
        if (current.length >= chunkSize) {
          chunks.put(chunkRecord(session.sessionId, chunkIndex, current));
          chunkIndex += 1;
          current = [];
        }
      }
      if (current.length) chunks.put(chunkRecord(session.sessionId, chunkIndex, current));
      session.chunkCount = current.length ? chunkIndex + 1 : chunkIndex;
      session.lastChunkSize = current.length || chunkSize;
      tx.objectStore(SESSION_STORE).put(session);
      if (batchId) receipts.put({ sessionId: session.sessionId, batchId, eventCount: events.length, lastSeq: events[events.length - 1]?.sessionSeq || null, persistedAt: new Date().toISOString() });
      await txDone(tx);
      return { session, duplicate: false };
    }

    async function getChunkRecord(sessionId, chunkIndex) {
      const database = await db();
      const tx = database.transaction([CHUNK_STORE], 'readonly');
      return req(tx.objectStore(CHUNK_STORE).get([sessionId, chunkIndex]));
    }

    async function getChunk(sessionId, chunkIndex) {
      const row = await getChunkRecord(sessionId, chunkIndex);
      return Array.isArray(row?.events) ? row.events : [];
    }

    async function verifySession(session, options = {}) {
      if (!session?.sessionId) throw new Error('missing_session');
      const total = Number(session.chunkCount || 0);
      const tailCount = options.full ? total : Math.min(total, Math.max(1, Number(options.tailCount || 3)));
      const start = options.full ? 0 : Math.max(0, total - tailCount);
      const problems = [];
      let checkedEvents = 0;
      let previousLastSeq = null;
      for (let i = start; i < total; i += 1) {
        const row = await getChunkRecord(session.sessionId, i);
        if (!row) {
          problems.push({ chunkIndex: i, code: 'missing_chunk' });
          continue;
        }
        const events = Array.isArray(row.events) ? row.events : [];
        checkedEvents += events.length;
        const actualChecksum = checksumEvents(events);
        if (row.checksum && row.checksum !== actualChecksum) problems.push({ chunkIndex: i, code: 'checksum_mismatch' });
        if (Number(row.eventCount || 0) !== events.length) problems.push({ chunkIndex: i, code: 'event_count_mismatch' });
        const firstSeq = events[0]?.sessionSeq || null;
        const lastSeq = events[events.length - 1]?.sessionSeq || null;
        if (row.firstSeq !== firstSeq || row.lastSeq !== lastSeq) problems.push({ chunkIndex: i, code: 'sequence_metadata_mismatch' });
        if (previousLastSeq != null && firstSeq != null && firstSeq !== previousLastSeq + 1) problems.push({ chunkIndex: i, code: 'sequence_gap_between_chunks' });
        previousLastSeq = lastSeq;
      }
      return {
        ok: problems.length === 0,
        full: !!options.full,
        checkedChunks: Math.max(0, total - start),
        checkedEvents,
        problems
      };
    }

    async function getTail(session, limit = 100) {
      const out = [];
      for (let i = Math.max(0, Number(session.chunkCount || 0) - 3); i < Number(session.chunkCount || 0); i += 1) out.push(...await getChunk(session.sessionId, i));
      return out.slice(-Math.max(1, limit));
    }

    return { putSession, getSession, listSessions, listSessionsByStatus, append, getChunk, getChunkRecord, getTail, verifySession, checksumEvents, chunkSize };
  }

  NS.IndexedDbChunkStore = { createChunkStore, DB_NAME, DB_VERSION, checksumEvents };
})(typeof globalThis !== 'undefined' ? globalThis : this);
