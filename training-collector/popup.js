'use strict';

const taskEl = document.getElementById('task');
const statusEl = document.getElementById('status');

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ scope: 'TRAINING_COLLECTOR_V01', type, ...extra });
}

function show(state, error) {
  if (error) {
    statusEl.textContent = `Error: ${error}`;
    return;
  }
  const episode = state?.episode;
  statusEl.textContent = episode
    ? `${state.active ? 'Recording' : 'Stopped'}\n${episode.episodeId}\nSteps: ${episode.steps?.length || 0}\nOutcome: ${episode.finalOutcome?.status || '-'}`
    : 'Idle';
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
