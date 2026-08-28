'use strict';

(function initEpisodeTransitionOrder(root) {
  const NS = root.TrainingCollectorV11 = root.TrainingCollectorV11 || {};
  const VERSION = '0.1.0';

  function createTransitionOrder() {
    const starts = new Map();

    function registerStart(transitionId, startPromise) {
      const id = String(transitionId || '').trim();
      if (!id) throw new Error('transition_order_id_required');
      const tracked = Promise.resolve(startPromise).catch(() => null);
      starts.set(id, tracked);
      return tracked;
    }

    async function afterStart(transitionId, work) {
      const id = String(transitionId || '').trim();
      if (!id) throw new Error('transition_order_id_required');
      if (typeof work !== 'function') throw new Error('transition_order_work_required');
      const pendingStart = starts.get(id);
      if (pendingStart) await pendingStart;
      try {
        return await work();
      } finally {
        starts.delete(id);
      }
    }

    function clear() {
      starts.clear();
    }

    function pendingStartCount() {
      return starts.size;
    }

    return {
      version: VERSION,
      registerStart,
      afterStart,
      clear,
      pendingStartCount
    };
  }

  NS.EpisodeTransitionOrder = {
    VERSION,
    createTransitionOrder
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS.EpisodeTransitionOrder;
})(typeof globalThis !== 'undefined' ? globalThis : this);
