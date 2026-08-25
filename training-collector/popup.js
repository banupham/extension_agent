'use strict';

const taskEl = document.getElementById('task');
const statusEl = document.getElementById('status');

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ scope: 'TRAINING_COLLECTOR_V02', type, ...extra });
}

function show(state, error) {
  if (error) {
    statusEl.textContent = `Error: ${error}`;
    return;
  }
  const episode = state?.episode;
  if (!episode) {
    statusEl.textContent = 'Idle';
    return;
  }
  const transitions = Array.isArray(episode.transitions) ? episode.transitions : [];
  const complete = transitions.filter(x => x.status === 'complete').length;
  const partial = transitions.length - complete;
  statusEl.textContent = `${state.active ? 'Recording' : 'Stopped'}\n${episode.episodeId}\nTransitions: ${transitions.length} (${complete} complete / ${partial} partial)\nOutcome: ${episode.finalOutcome?.status || '-'}`;
}

async function refresh() {
  const res = await send('GET_STATE');
  show(res.state, res.error);
}

document.getElementById('start').addEventListener('click', async () => {
  const instruction = taskEl.value.trim();
  const res = await send('START_EPISODE', { task: { instruction, type: 'unspecified', args: {} } });
  show(res.state, res.error);
});

document.getElementById('success').addEventListener('click', async () => {
  const res = await send('STOP_EPISODE', { outcome: { status: 'success' } });
  show(res.state, res.error);
});

document.getElementById('failed').addEventListener('click', async () => {
  const res = await send('STOP_EPISODE', { outcome: { status: 'failed' } });
  show(res.state, res.error);
});

document.getElementById('stop').addEventListener('click', async () => {
  const res = await send('STOP_EPISODE', { outcome: { status: 'stopped' } });
  show(res.state, res.error);
});

refresh().catch(error => show(null, String(error?.message || error)));
