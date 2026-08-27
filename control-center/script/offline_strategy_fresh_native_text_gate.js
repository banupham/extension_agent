'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { executeBoundedEpisodeLoop } = require('../manager/agent/bounded_episode_loop.js');
const { createStrategy } = require('../manager/strategy');
const { parseArgs, discoverRuntimeAgent } = require('./agent_one_action.js');

const GATE_VERSION = '0.1.1';
const HOST = '127.0.0.1';
const INITIAL_TITLE = 'Cargo Routing Lab';
const PASS_TITLE = 'CARGO INSTRUCTION PASS';
const TARGET_LABEL = 'Cargo Instruction';
const EXPECTED_ACTION_TYPES = Object.freeze(['typeText', 'submit']);
const EXPECTED_TARGET_LABELS = Object.freeze([TARGET_LABEL, TARGET_LABEL]);
const SERVER_CLOSE_TIMEOUT_MS = 1500;

function labHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${INITIAL_TITLE}</title>
  <style>
    body{font-family:Arial,sans-serif;margin:28px;line-height:1.4;max-width:880px}
    h1{margin-bottom:6px}
    p{margin-top:0;color:#444}
    form{display:grid;gap:14px;border:1px solid #bbb;border-radius:10px;padding:20px}
    label{display:grid;gap:6px;font-weight:600}
    input,textarea,button{font:inherit;padding:10px 12px}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    #state{padding:10px;border:1px solid #aaa;background:#f6f6f6}
  </style>
</head>
<body>
  <h1>Cargo Routing Lab</h1>
  <p>Controlled fresh native Strategy gate.</p>
  <div id="state">READY</div>
  <form id="cargoForm">
    <div class="row">
      <label>Cargo Reference
        <input aria-label="Cargo Reference" autocomplete="off">
      </label>
      <label>Crew Note
        <input aria-label="Crew Note" autocomplete="off">
      </label>
    </div>
    <label>${TARGET_LABEL}
      <input id="cargoInstruction" aria-label="${TARGET_LABEL}" autocomplete="off">
    </label>
    <label>Destination Memo
      <textarea aria-label="Destination Memo" rows="2"></textarea>
    </label>
    <button type="submit" aria-label="Route Cargo">Route Cargo</button>
  </form>
  <script>
    const form = document.getElementById('cargoForm');
    const target = document.getElementById('cargoInstruction');
    const state = document.getElementById('state');
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!target.value.length) {
        state.textContent = 'CARGO VALUE REQUIRED';
        return;
      }
      state.textContent = '${PASS_TITLE}';
      document.title = '${PASS_TITLE}';
      document.body.dataset.result = '${PASS_TITLE}';
    });
  </script>
</body>
</html>`;
}

function createLabServer() {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${HOST}/`);
    if (url.pathname !== '/') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(labHtml());
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  Object.defineProperty(server, '__freshNativeSockets', {
    value: sockets,
    enumerable: false,
    configurable: false,
    writable: false
  });
  return server;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    const onError = error => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, HOST);
  });
  const address = server.address();
  if (!address || typeof address !== 'object' || !Number.isInteger(Number(address.port))) {
    throw new Error('fresh_native_lab_port_unavailable');
  }
  return Number(address.port);
}

async function closeServer(server, timeoutMs = SERVER_CLOSE_TIMEOUT_MS) {
  if (!server?.listening) return { closed: true, forced: false };
  let forced = false;
  await new Promise(resolve => {
    let settled = false;
    let timer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(() => {
      forced = true;
      try { server.closeIdleConnections?.(); } catch (_) {}
      try { server.closeAllConnections?.(); } catch (_) {}
      const sockets = server.__freshNativeSockets;
      if (sockets && typeof sockets[Symbol.iterator] === 'function') {
        for (const socket of sockets) {
          try { socket.destroy(); } catch (_) {}
        }
      }
      finish();
    }, Math.max(50, Number(timeoutMs) || SERVER_CLOSE_TIMEOUT_MS));

    try {
      server.close(finish);
      try { server.closeIdleConnections?.(); } catch (_) {}
    } catch (_) {
      finish();
    }
  });
  return { closed: true, forced };
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.resolve(file))).digest('hex');
}

function makeTask() {
  return {
    taskId: `fresh-native-cargo-${Date.now()}`,
    type: 'controlled-fresh-native-text',
    instruction: `Type the provided value into ${TARGET_LABEL} and press Enter`,
    args: {},
    successCriteria: [{ type: 'page', field: 'title', operator: 'equals', value: PASS_TITLE }],
    constraints: {},
    metadata: { gate: 'offline-strategy-fresh-native-text' }
  };
}

function targetLabel(step) {
  const ref = step?.action?.targetRef;
  if (!ref) return null;
  const elements = Array.isArray(step?.before?.interactiveElements) ? step.before.interactiveElements : [];
  return elements.find(element => element?.ref === ref)?.label || null;
}

function publicStep(step) {
  return {
    stepIndex: step?.stepIndex ?? null,
    actionType: step?.action?.type || null,
    targetLabel: targetLabel(step),
    confidence: step?.decision?.confidence ?? null,
    reasonCode: step?.decision?.reasonCode || null,
    prototypeSource: step?.decision?.metadata?.prototypeSource || null,
    historyMatched: step?.decision?.metadata?.historyMatched === true,
    actionSelectionTargetIndependent: step?.decision?.metadata?.actionSelectionTargetIndependent === true,
    transientPayload: {
      applied: step?.transientPayload?.applied === true,
      redacted: step?.transientPayload?.redacted === true,
      keys: Array.isArray(step?.transientPayload?.keys) ? [...step.transientPayload.keys] : []
    }
  };
}

function evaluateResult(result, strategy, modelHashBefore, modelHashAfter, transientText) {
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  const actionTypes = steps.map(step => step?.action?.type || null);
  const targetLabels = steps.map(targetLabel);
  const publicResultContainsTransientText = JSON.stringify(result).includes(transientText);
  const fitModuleImported = Object.keys(require.cache).some(file => /fit_strategy_offline_baseline\.js$/i.test(file));
  const errors = [];

  if (result?.finalOutcome?.taskSucceeded !== true) errors.push('final_goal_not_satisfied');
  if (result?.finalBudget?.reasonCode !== 'goal_satisfied') errors.push(`final_budget:${result?.finalBudget?.reasonCode || '<missing>'}`);
  if (JSON.stringify(actionTypes) !== JSON.stringify(EXPECTED_ACTION_TYPES)) errors.push(`action_sequence:${actionTypes.join(',') || '<empty>'}`);
  if (JSON.stringify(targetLabels) !== JSON.stringify(EXPECTED_TARGET_LABELS)) errors.push(`target_labels:${targetLabels.join(',') || '<empty>'}`);
  if (strategy?.model?.loaded !== true || strategy?.model?.source !== 'file') errors.push('strategy_model_not_loaded_from_file');
  if (strategy?.provider?.version !== '0.3.3') errors.push(`provider_version:${strategy?.provider?.version || '<missing>'}`);
  if (modelHashBefore !== modelHashAfter) errors.push('model_file_mutated');
  if (fitModuleImported) errors.push('fit_module_imported');
  if (publicResultContainsTransientText) errors.push('transient_text_leaked_to_public_result');
  if (result?.invariant?.transientPayloadRedacted !== true) errors.push('transient_payload_redaction_invariant_failed');
  if (steps[0]?.transientPayload?.applied !== true || steps[0]?.transientPayload?.redacted !== true) errors.push('type_text_transient_payload_missing');
  if (steps[1]?.transientPayload?.applied === true) errors.push('submit_should_not_receive_text_payload');

  return {
    ok: errors.length === 0,
    result: errors.length === 0 ? 'PASS' : 'FAIL',
    gate: 'offline-strategy-fresh-native-text',
    gateVersion: GATE_VERSION,
    modelVersion: strategy?.provider?.version || null,
    expectedActionTypes: [...EXPECTED_ACTION_TYPES],
    actualActionTypes: actionTypes,
    expectedTargetLabels: [...EXPECTED_TARGET_LABELS],
    actualTargetLabels: targetLabels,
    finalTitle: steps.length ? steps[steps.length - 1]?.after?.title || null : null,
    steps: steps.map(publicStep),
    invariant: {
      frozenModelOnly: !fitModuleImported,
      modelLoadedFromFile: strategy?.model?.loaded === true && strategy?.model?.source === 'file',
      modelFileMutated: modelHashBefore !== modelHashAfter,
      noLiteralTrajectoryReplay: result?.invariant?.literalTrajectoryReplay === false,
      noSelectorTargetingByStrategy: result?.invariant?.selectorUsedByStrategy === false,
      transientPayloadRedacted: result?.invariant?.transientPayloadRedacted === true,
      publicResultContainsTransientText
    },
    errors
  };
}

function withCleanupStatus(summary, tabClosed) {
  if (!summary) return summary;
  const errors = [...(summary.errors || [])];
  if (!tabClosed) errors.push('created_tab_cleanup_failed');
  return {
    ...summary,
    ok: errors.length === 0,
    result: errors.length === 0 ? 'PASS' : 'FAIL',
    createdTabClosed: tabClosed === true,
    errors
  };
}

async function activeAnchorTab(client) {
  const visible = await client.listTabs({ mode: 'visible' });
  const active = visible.find(tab => tab?.active === true) || visible[0];
  if (active?.tabId) return Number(active.tabId);
  const all = await client.listTabs({ mode: 'all' });
  const fallback = all.find(tab => tab?.active === true) || all[0];
  if (!fallback?.tabId) throw new Error('fresh_native_anchor_tab_required');
  return Number(fallback.tabId);
}

async function waitForLab(client, tabId, expectedUrl, timeoutMs = 10000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const observation = await client.observe(tabId);
      if (String(observation?.url || '').startsWith(expectedUrl) && observation?.title === INITIAL_TITLE) return observation;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`fresh_native_lab_not_ready:${lastError?.message || 'timeout'}`);
}

async function runGate(options = {}) {
  const modelFile = path.resolve(String(options.modelFile || ''));
  if (!modelFile || !fs.existsSync(modelFile)) throw new Error('fresh_native_model_file_required');

  const modelHashBefore = sha256File(modelFile);
  const transientText = `cargo-${crypto.randomBytes(12).toString('hex')}`;
  const server = createLabServer();
  let client = null;
  let createdTabId = null;
  let tabClosed = false;
  let summary = null;

  try {
    const port = await listen(server);
    const labUrl = `http://${HOST}:${port}/`;
    const agentId = options.agentId || await discoverRuntimeAgent(options.healthBase || 'http://127.0.0.1:3000');
    client = createBrokerRuntimeClient({
      url: options.broker || 'ws://127.0.0.1:3000',
      agentId,
      timeoutMs: Number(options.timeoutMs || 10000)
    });

    const anchorTabId = await activeAnchorTab(client);
    const opened = await client.executeBrowserAction({
      tabId: anchorTabId,
      action: { browserActionVersion: '0.1.0', actionType: 'openNewTab', args: { url: labUrl } }
    });
    createdTabId = Number(opened?.tab?.tabId);
    if (!Number.isInteger(createdTabId) || createdTabId <= 0) throw new Error('fresh_native_created_tab_missing');
    await waitForLab(client, createdTabId, labUrl, Number(options.timeoutMs || 10000));

    const runtime = {
      observe: () => client.observe(createdTabId),
      listTabs: scope => client.listTabs(scope),
      executePlan: payload => client.executePlan({ ...payload, tabId: createdTabId }),
      executeBrowserAction: payload => client.executeBrowserAction({ ...payload, tabId: createdTabId })
    };
    const strategy = createStrategy({ modelFile, minimumConfidence: options.minimumConfidence ?? 0 });
    const task = makeTask();
    const result = await executeBoundedEpisodeLoop({
      runtime,
      strategy,
      task,
      resolveTransientActionArgs: ({ action }) => action?.type === 'typeText' ? { text: transientText } : null,
      postActionSettle: { pollMs: 80, minWindowMs: 240, maxWindowMs: 1000, stableSamples: 2 },
      budgets: {
        maxSteps: 4,
        maxDurationMs: 30000,
        maxConsecutiveFailures: 2,
        maxReplans: 3,
        maxStalledSteps: 2
      }
    });
    const modelHashAfter = sha256File(modelFile);
    summary = evaluateResult(result, strategy, modelHashBefore, modelHashAfter, transientText);
  } finally {
    if (client && Number.isInteger(createdTabId) && createdTabId > 0) {
      try {
        await client.executeBrowserAction({
          tabId: createdTabId,
          action: { browserActionVersion: '0.1.0', actionType: 'closeTab', args: {} }
        });
        tabClosed = true;
      } catch (_) {}
    }
    try { client?.close(); } catch (_) {}
    await closeServer(server);
  }

  return withCleanupStatus(summary, tabClosed);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.model) throw new Error('--model is required');
  const result = await runGate({
    modelFile: args.model,
    agentId: args.agent || null,
    healthBase: args['health-base'] || 'http://127.0.0.1:3000',
    broker: args.broker || 'ws://127.0.0.1:3000',
    timeoutMs: Number(args.timeout || 10000),
    minimumConfidence: args['minimum-confidence'] == null ? 0 : Number(args['minimum-confidence'])
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({
      ok: false,
      result: 'FAIL',
      gate: 'offline-strategy-fresh-native-text',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  GATE_VERSION,
  HOST,
  INITIAL_TITLE,
  PASS_TITLE,
  TARGET_LABEL,
  EXPECTED_ACTION_TYPES,
  EXPECTED_TARGET_LABELS,
  SERVER_CLOSE_TIMEOUT_MS,
  labHtml,
  createLabServer,
  listen,
  closeServer,
  sha256File,
  makeTask,
  targetLabel,
  publicStep,
  evaluateResult,
  withCleanupStatus,
  activeAnchorTab,
  waitForLab,
  runGate,
  main
};
