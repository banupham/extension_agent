'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { createMissionPlan } = require('../manager/mission/mission_plan.js');
const { executeMissionWithStrategy } = require('../manager/mission/mission_strategy_executor.js');
const { createStrategy } = require('../manager/strategy');
const { createRecoveryExplorationProvider } = require('../manager/strategy/recovery_exploration_provider.js');
const { parseArgs, discoverRuntimeAgent } = require('./agent_one_action.js');
const {
  listen,
  closeServer,
  sha256File,
  activeAnchorTab
} = require('./offline_strategy_fresh_native_text_gate.js');

const GATE_VERSION = '0.1.1';
const HOST = '127.0.0.1';
const INITIAL_TITLE = 'Signal Relay Lab';
const FINAL_LABEL = 'Relay Complete';
const EVIDENCE_CLASS = 'regression-after-diagnosis';
const EXPECTED_SUBGOAL_ACTIONS = Object.freeze([
  ['click', 'waitAndObserve'],
  ['typeText', 'submit'],
  ['click']
]);
const EXPECTED_SUBGOAL_TARGETS = Object.freeze([
  ['Open Relay Console', null],
  ['Relay Note', 'Relay Note'],
  ['Finalize Relay']
]);

function labHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${INITIAL_TITLE}</title>
  <style>
    body{font-family:Arial,sans-serif;margin:28px;line-height:1.4;max-width:900px}
    h1{margin-bottom:6px}
    p{margin-top:0;color:#444}
    section{border:1px solid #bbb;border-radius:10px;padding:20px;margin-top:16px;display:grid;gap:12px}
    button,input{font:inherit;padding:10px 12px}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    [hidden]{display:none!important}
  </style>
</head>
<body>
  <h1>Signal Relay Lab</h1>
  <p>Long-mission regression with dynamic state and recoverable delayed transition.</p>

  <section id="stage1">
    <strong>Relay Access</strong>
    <div class="row">
      <button id="openRelay" type="button">Open Relay Console</button>
      <button type="button">Inspect Manifest</button>
    </div>
    <button type="button">Archive Relay</button>
  </section>

  <section id="stage2" hidden>
    <strong>Relay Entry</strong>
    <form id="relayForm">
      <label>Relay Note
        <input id="relayNote" aria-label="Relay Note" autocomplete="off">
      </label>
      <label>Operator Memo
        <input aria-label="Operator Memo" autocomplete="off">
      </label>
      <button id="relaySubmit" type="submit" hidden aria-hidden="true" tabindex="-1">Submit Relay</button>
      <button type="button">Review Template</button>
    </form>
  </section>

  <section id="stage3" hidden>
    <strong>Relay Confirmation</strong>
    <div class="row">
      <button id="finalizeRelay" type="button">Finalize Relay</button>
      <button type="button">Review Queue</button>
    </div>
  </section>

  <section id="stageDone" hidden>
    <strong>Mission State</strong>
    <button id="relayComplete" type="button">${FINAL_LABEL}</button>
  </section>

  <script>
    const stage1 = document.getElementById('stage1');
    const stage2 = document.getElementById('stage2');
    const stage3 = document.getElementById('stage3');
    const stageDone = document.getElementById('stageDone');
    const openRelay = document.getElementById('openRelay');
    const relayForm = document.getElementById('relayForm');
    const relayNote = document.getElementById('relayNote');
    const finalizeRelay = document.getElementById('finalizeRelay');
    let openScheduled = false;

    openRelay.addEventListener('click', () => {
      if (openScheduled) return;
      openScheduled = true;
      // Deliberately no immediate DOM mutation. The first click therefore has no
      // observable semantic effect inside the normal click settle window.
      setTimeout(() => {
        stage1.hidden = true;
        stage2.hidden = false;
      }, 1200);
    });

    relayForm.addEventListener('submit', event => {
      event.preventDefault();
      if (!relayNote.value.length) return;
      stage2.hidden = true;
      stage3.hidden = false;
    });

    finalizeRelay.addEventListener('click', () => {
      stage3.hidden = true;
      stageDone.hidden = false;
    });
  </script>
</body>
</html>`;
}

function createLabServer() {
  return http.createServer((req, res) => {
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
  throw new Error(`fresh_long_mission_lab_not_ready:${lastError?.message || 'timeout'}`);
}

function missionPlan() {
  return createMissionPlan({
    missionId: 'fresh-long-signal-relay',
    instruction: 'Click Open Relay Console, then type the provided value into Relay Note and press Enter, then click Finalize Relay',
    metadata: {
      gate: 'offline-strategy-fresh-long-mission',
      frozenEvaluationFamily: false,
      evidenceClass: EVIDENCE_CLASS
    }
  });
}

function successCriterionForSubgoal(subgoalIndex) {
  if (subgoalIndex === 0) {
    return { type: 'element', match: { label: 'Relay Note' }, expect: { exists: true, visible: true, editable: true } };
  }
  if (subgoalIndex === 1) {
    return { type: 'element', match: { label: 'Finalize Relay' }, expect: { exists: true, visible: true, enabled: true } };
  }
  if (subgoalIndex === 2) {
    return { type: 'element', match: { label: FINAL_LABEL }, expect: { exists: true, visible: true } };
  }
  throw new Error(`fresh_long_mission_subgoal_index_unsupported:${subgoalIndex}`);
}

function resolveSubgoalTask({ subgoal, subgoalIndex }) {
  return {
    taskId: `fresh-long-signal-relay:${subgoalIndex + 1}`,
    type: 'controlled-fresh-long-mission',
    instruction: subgoal.instruction,
    args: {},
    successCriteria: [successCriterionForSubgoal(subgoalIndex)],
    constraints: {},
    metadata: {
      gate: 'offline-strategy-fresh-long-mission',
      subgoalIndex,
      titlePassCriterionRequired: false,
      evidenceClass: EVIDENCE_CLASS
    }
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
    controlStatus: step?.control?.status || null,
    controlReasonCode: step?.control?.reasonCode || null,
    effectStatus: step?.effect?.status || null,
    effectCodes: Array.isArray(step?.effect?.codes) ? [...step.effect.codes] : [],
    decisionSource: step?.decision?.metadata?.prototypeSource || null,
    recoveryDeferredForBaseProgression: step?.decision?.metadata?.recoveryDeferredForBaseProgression === true,
    recoveryTriggerActionType: step?.decision?.metadata?.triggerActionType || step?.decision?.metadata?.recoveryTriggerActionType || null,
    transientPayload: {
      applied: step?.transientPayload?.applied === true,
      redacted: step?.transientPayload?.redacted === true,
      keys: Array.isArray(step?.transientPayload?.keys) ? [...step.transientPayload.keys] : []
    }
  };
}

function publicSubgoal(item) {
  const steps = Array.isArray(item?.result?.steps) ? item.result.steps : [];
  return {
    subgoalId: item?.subgoalId || null,
    instruction: item?.instruction || null,
    status: item?.status || null,
    actionTypes: steps.map(step => step?.action?.type || null),
    targetLabels: steps.map(targetLabel),
    finalBudgetReasonCode: item?.result?.finalBudget?.reasonCode || null,
    steps: steps.map(publicStep)
  };
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function evaluateResult(result, baseStrategy, modelHashBefore, modelHashAfter, transientText) {
  const subgoals = Array.isArray(result?.subgoalResults) ? result.subgoalResults : [];
  const actualActions = subgoals.map(item => (item?.result?.steps || []).map(step => step?.action?.type || null));
  const actualTargets = subgoals.map(item => (item?.result?.steps || []).map(targetLabel));
  const publicResultContainsTransientText = JSON.stringify(result).includes(transientText);
  const fitModuleImported = Object.keys(require.cache).some(file => /fit_strategy_offline_baseline\.js$/i.test(file));
  const errors = [];

  if (result?.ok !== true || result?.reasonCode !== 'mission_satisfied') errors.push(`mission:${result?.reasonCode || '<missing>'}`);
  if (!sameJson(actualActions, EXPECTED_SUBGOAL_ACTIONS)) errors.push(`action_sequences:${JSON.stringify(actualActions)}`);
  if (!sameJson(actualTargets, EXPECTED_SUBGOAL_TARGETS)) errors.push(`target_sequences:${JSON.stringify(actualTargets)}`);
  if (baseStrategy?.provider?.version !== '0.3.3') errors.push(`model_version:${baseStrategy?.provider?.version || '<missing>'}`);
  if (baseStrategy?.model?.loaded !== true || baseStrategy?.model?.source !== 'file') errors.push('strategy_model_not_loaded_from_file');
  if (modelHashBefore !== modelHashAfter) errors.push('model_file_mutated');
  if (fitModuleImported) errors.push('fit_module_imported');
  if (publicResultContainsTransientText) errors.push('transient_text_leaked_to_public_result');
  if (result?.invariant?.transientPayloadRedactedAcrossCompletedSubgoals !== true) errors.push('mission_transient_redaction_failed');
  if (subgoals.length !== 3 || !subgoals.every(item => item.status === 'done')) errors.push('subgoals_not_all_done');

  const firstSteps = subgoals[0]?.result?.steps || [];
  if (firstSteps[0]?.effect?.status !== 'no_effect' || firstSteps[0]?.control?.status !== 'failed') {
    errors.push('recoverable_no_effect_not_observed');
  }
  if (firstSteps[1]?.action?.type !== 'waitAndObserve' || firstSteps[1]?.decision?.metadata?.prototypeSource !== 'recoveryExploration') {
    errors.push('wait_recovery_not_used');
  }

  const secondSteps = subgoals[1]?.result?.steps || [];
  if (secondSteps[0]?.action?.type !== 'typeText' || secondSteps[1]?.action?.type !== 'submit') {
    errors.push('text_submit_progression_missing');
  }
  if (secondSteps[1]?.decision?.metadata?.recoveryDeferredForBaseProgression !== true) {
    errors.push('recovery_progression_guard_not_observed');
  }
  if (secondSteps[0]?.transientPayload?.applied !== true || secondSteps[0]?.transientPayload?.redacted !== true) {
    errors.push('mission_type_text_transient_payload_missing');
  }

  return {
    ok: errors.length === 0,
    result: errors.length === 0 ? 'PASS' : 'FAIL',
    gate: 'offline-strategy-fresh-long-mission',
    gateVersion: GATE_VERSION,
    evidenceClass: EVIDENCE_CLASS,
    modelVersion: baseStrategy?.provider?.version || null,
    missionReasonCode: result?.reasonCode || null,
    missionProgress: result?.progress || null,
    expectedSubgoalActions: EXPECTED_SUBGOAL_ACTIONS,
    actualSubgoalActions: actualActions,
    expectedSubgoalTargets: EXPECTED_SUBGOAL_TARGETS,
    actualSubgoalTargets: actualTargets,
    subgoals: subgoals.map(publicSubgoal),
    invariant: {
      frozenModelOnly: !fitModuleImported,
      modelLoadedFromFile: baseStrategy?.model?.loaded === true && baseStrategy?.model?.source === 'file',
      modelFileMutated: modelHashBefore !== modelHashAfter,
      transientPayloadRedacted: result?.invariant?.transientPayloadRedactedAcrossCompletedSubgoals === true,
      publicResultContainsTransientText,
      orderedExecution: result?.invariant?.orderedExecution === true,
      semanticSubgoalCountMatchesPlan: result?.invariant?.semanticSubgoalCountMatchesPlan === true,
      allCompletedSubgoalsGoalChecked: result?.invariant?.allCompletedSubgoalsUsedGoalCheckedEpisodes === true,
      noLiteralTrajectoryReplay: result?.invariant?.behaviorBaselineNeverReplaysLiteralTrajectory === true
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

async function runGate(options = {}) {
  const modelFile = path.resolve(String(options.modelFile || ''));
  if (!modelFile || !fs.existsSync(modelFile)) throw new Error('fresh_long_mission_model_file_required');

  const modelHashBefore = sha256File(modelFile);
  const transientText = `relay-${crypto.randomBytes(12).toString('hex')}`;
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
    if (!Number.isInteger(createdTabId) || createdTabId <= 0) throw new Error('fresh_long_mission_created_tab_missing');
    await waitForLab(client, createdTabId, labUrl, Number(options.timeoutMs || 10000));

    const runtime = {
      observe: () => client.observe(createdTabId),
      listTabs: scope => client.listTabs(scope),
      executePlan: payload => client.executePlan({ ...payload, tabId: createdTabId }),
      executeBrowserAction: payload => client.executeBrowserAction({ ...payload, tabId: createdTabId })
    };

    const baseStrategy = createStrategy({ modelFile, minimumConfidence: options.minimumConfidence ?? 0 });
    const recoveryProvider = createRecoveryExplorationProvider({ baseProvider: baseStrategy });
    const missionStrategy = createStrategy({ provider: recoveryProvider });

    const result = await executeMissionWithStrategy({
      plan: missionPlan(),
      runtime,
      strategy: missionStrategy,
      resolveSubgoalTask,
      resolveTransientActionArgs: ({ action }) => action?.type === 'typeText' ? { text: transientText } : null,
      missionBudgets: {
        maxSubgoals: 3,
        maxDurationMs: 60000,
        stopOnSubgoalFailure: true
      },
      episodeBudgets: {
        maxSteps: 6,
        maxDurationMs: 20000,
        maxConsecutiveFailures: 3,
        maxReplans: 5,
        maxStalledSteps: 3
      }
    });

    const modelHashAfter = sha256File(modelFile);
    summary = evaluateResult(result, baseStrategy, modelHashBefore, modelHashAfter, transientText);
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
      gate: 'offline-strategy-fresh-long-mission',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  GATE_VERSION,
  HOST,
  INITIAL_TITLE,
  FINAL_LABEL,
  EVIDENCE_CLASS,
  EXPECTED_SUBGOAL_ACTIONS,
  EXPECTED_SUBGOAL_TARGETS,
  labHtml,
  createLabServer,
  waitForLab,
  missionPlan,
  successCriterionForSubgoal,
  resolveSubgoalTask,
  targetLabel,
  publicStep,
  publicSubgoal,
  sameJson,
  evaluateResult,
  withCleanupStatus,
  runGate,
  main
};
