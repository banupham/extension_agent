'use strict';

(function initReliableSender(root) {
  const NS = root.TrainingCollectorV06 = root.TrainingCollectorV06 || {};

  function createReliableSender(options = {}) {
    const send = options.send;
    const journalKey = String(options.journalKey || 'tcRawPendingV06');
    const retryMs = Math.max(250, Number(options.retryMs || 1500));
    const maxPending = Math.max(8, Number(options.maxPending || 128));
    const pending = new Map();
    let persistChain = Promise.resolve();

    function makeBatchId() {
      return `b-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function persist() {
      const rows = Array.from(pending.values()).map(x => ({ batch: x.batch, attempts: x.attempts, createdAt: x.createdAt }));
      persistChain = persistChain.then(() => chrome.storage.session.set({ [journalKey]: rows })).catch(() => {});
      return persistChain;
    }

    function schedule(entry) {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => attempt(entry.batch.batchId), retryMs);
    }

    async function attempt(batchId) {
      const entry = pending.get(batchId);
      if (!entry || entry.inFlight) return;
      entry.inFlight = true;
      entry.attempts += 1;
      try {
        const res = await send('RAW_BATCH', { batch: entry.batch });
        if (res?.ok && res?.ack && res?.batchId === batchId) {
          clearTimeout(entry.timer);
          pending.delete(batchId);
          await persist();
          return;
        }
      } catch {}
      entry.inFlight = false;
      schedule(entry);
      persist();
    }

    async function enqueue(batch) {
      if (!batch || !Array.isArray(batch.events) || !batch.events.length) return null;
      const normalized = { ...batch, batchId: batch.batchId || makeBatchId() };
      if (pending.has(normalized.batchId)) return normalized.batchId;
      if (pending.size >= maxPending) {
        const oldest = pending.keys().next().value;
        const old = pending.get(oldest);
        if (old) clearTimeout(old.timer);
        pending.delete(oldest);
      }
      pending.set(normalized.batchId, { batch: normalized, attempts: 0, createdAt: Date.now(), timer: null, inFlight: false });
      await persist();
      attempt(normalized.batchId);
      return normalized.batchId;
    }

    async function restore() {
      try {
        const data = await chrome.storage.session.get(journalKey);
        const rows = Array.isArray(data[journalKey]) ? data[journalKey] : [];
        for (const row of rows.slice(-maxPending)) {
          if (!row?.batch?.batchId || !Array.isArray(row.batch.events) || !row.batch.events.length) continue;
          pending.set(row.batch.batchId, {
            batch: row.batch,
            attempts: Number(row.attempts || 0),
            createdAt: Number(row.createdAt || Date.now()),
            timer: null,
            inFlight: false
          });
        }
        for (const batchId of pending.keys()) attempt(batchId);
      } catch {}
    }

    function stats() { return { pending: pending.size }; }
    return { enqueue, restore, stats };
  }

  NS.ReliableSender = { createReliableSender };
})(typeof globalThis !== 'undefined' ? globalThis : this);
