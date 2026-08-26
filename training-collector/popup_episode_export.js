'use strict';

(function initTaskEpisodePopupExport(root) {
  const Exporter = root.TrainingCollectorV09?.TaskEpisodeReviewExport;
  const button = document.getElementById('exportEpisode');
  const status = document.getElementById('status');
  if (!button || !Exporter?.buildReviewExport) return;

  function send(type, extra = {}) {
    return chrome.runtime.sendMessage({ scope: 'TRAINING_COLLECTOR_V03', type, ...extra });
  }

  function safeFilePart(value) {
    return String(value || 'episode').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120);
  }

  function downloadJson(fileName, value) {
    const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function exportEpisode() {
    const response = await send('GET_STATE');
    if (!response?.ok) throw new Error(response?.error || 'episode_state_unavailable');
    const state = response.state;
    const episode = state?.episode;
    if (!episode) throw new Error('no_task_episode_available');
    if (state.active) throw new Error('stop_or_mark_the_episode_before_export');
    if (!episode.finalOutcome) throw new Error('episode_final_outcome_required');

    const review = Exporter.buildReviewExport(episode);
    downloadJson(
      `training-collector-${safeFilePart(episode.episodeId)}.task-episode-review.json`,
      review
    );
    status.textContent = [
      `Task Episode review export created`,
      `${episode.episodeId}`,
      `Transitions: ${review.transitions.length}`,
      `Strategy-ready snapshots: ${review.strategyReady ? 'yes' : 'no'}`,
      `Training eligible: no — review/labels/split still required`
    ].join('\n');
  }

  button.addEventListener('click', () => exportEpisode().catch(error => {
    status.textContent = `Episode export error: ${String(error?.message || error)}`;
  }));
})(typeof globalThis !== 'undefined' ? globalThis : this);
