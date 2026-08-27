'use strict';

(function initEpisodeStateQueue(root) {
  const NS = root.TrainingCollectorV12 = root.TrainingCollectorV12 || {};
  const VERSION = '0.1.0';

  function createEpisodeStateQueue() {
    let tail = Promise.resolve();
    let queued = 0;

    function enqueue(job) {
      if (typeof job !== 'function') throw new Error('episode_state_queue_job_required');
      queued += 1;
      const run = tail.then(() => job());
      tail = run.catch(() => {}).finally(() => {
        queued = Math.max(0, queued - 1);
      });
      return run;
    }

    async function drain() {
      await tail;
      return { version: VERSION, queued };
    }

    function status() {
      return { version: VERSION, queued };
    }

    return { version: VERSION, enqueue, drain, status };
  }

  NS.EpisodeStateQueue = { VERSION, createEpisodeStateQueue };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.EpisodeStateQueue;
})(typeof globalThis !== 'undefined' ? globalThis : this);
