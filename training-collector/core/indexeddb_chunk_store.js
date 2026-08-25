'use strict';

(function initIndexedDbChunkStore(root) {
  const NS = root.TrainingCollectorV06 = root.TrainingCollectorV06 || {};
  const DB_NAME = 'trainingCollectorRawV06';
  const DB_VERSION = 1;
  const SESSION_STORE = 'sessions';
  const CHUNK_STORE = 'chunks';

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
    };
    return req(request);
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

    async function listSessions(limit = 20) {
      const database = await db();
      const tx = database.transaction([SESSION_STORE], 'readonly');
      const rows = await req(tx.objectStore(SESSION_STORE).getAll());
      return rows.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || ''))).slice(0, limit);
    }

    async function append(session, events) {
      if (!session?.sessionId) throw new Error('missing_session');
      if (!Array.isArray(events) || !events.length) return session;
      const database = await db();
      const tx = database.transaction([SESSION_STORE, CHUNK_STORE], 'readwrite');
      const chunks = tx.objectStore(CHUNK_STORE);
      let chunkIndex = Math.max(0, Number(session.chunkCount || 0) - 1);
      let current = [];
      if (Number(session.chunkCount || 0) > 0 && Number(session.lastChunkSize || 0) < chunkSize) {
        current = await req(chunks.get([session.sessionId, chunkIndex]))?.then ? [] : [];
      }
      if (Number(session.chunkCount || 0) > 0 && Number(session.lastChunkSize || 0) < chunkSize) {
        const existing = await req(chunks.get([session.sessionId, chunkIndex]));
        current = Array.isArray(existing?.events) ? existing.events.slice() : [];
      } else if (Number(session.chunkCount || 0) > 0) {
        chunkIndex = Number(session.chunkCount || 0);
      }

      for (const event of events) {
        current.push(event);
        if (current.length >= chunkSize) {
          chunks.put({ sessionId: session.sessionId, chunkIndex, eventCount: current.length, firstSeq: current[0]?.sessionSeq || null, lastSeq: current[current.length - 1]?.sessionSeq || null, events: current });
          chunkIndex += 1;
          current = [];
        }
      }
      if (current.length) {
        chunks.put({ sessionId: session.sessionId, chunkIndex, eventCount: current.length, firstSeq: current[0]?.sessionSeq || null, lastSeq: current[current.length - 1]?.sessionSeq || null, events: current });
      }
      session.chunkCount = current.length ? chunkIndex + 1 : chunkIndex;
      session.lastChunkSize = current.length || chunkSize;
      tx.objectStore(SESSION_STORE).put(session);
      await txDone(tx);
      return session;
    }

    async function getChunk(sessionId, chunkIndex) {
      const database = await db();
      const tx = database.transaction([CHUNK_STORE], 'readonly');
      const row = await req(tx.objectStore(CHUNK_STORE).get([sessionId, chunkIndex]));
      return Array.isArray(row?.events) ? row.events : [];
    }

    async function getTail(session, limit = 100) {
      const out = [];
      for (let i = Math.max(0, Number(session.chunkCount || 0) - 3); i < Number(session.chunkCount || 0); i += 1) {
        out.push(...await getChunk(session.sessionId, i));
      }
      return out.slice(-Math.max(1, limit));
    }

    return { putSession, getSession, listSessions, append, getChunk, getTail, chunkSize };
  }

  NS.IndexedDbChunkStore = { createChunkStore, DB_NAME, DB_VERSION };
})(typeof globalThis !== 'undefined' ? globalThis : this);
