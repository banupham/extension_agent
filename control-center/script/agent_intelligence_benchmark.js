'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { executeBoundedEpisodeLoop } = require('../manager/agent/bounded_episode_loop.js');
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

const BENCHMARK_VERSION = '0.1.0';
const EVIDENCE_CLASS = 'fresh-unseen-randomized-controlled-native';
const HOST = '127.0.0.1';

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function makeLabels() {
  const nonce = crypto.randomBytes(4).toString('hex');
  return {
    nonce,
    clickEn: `Approve Nebula Packet ${nonce}`,
    clickVi: `Gửi Hồ Sơ Sao Băng ${nonce}`,
    textEn: `Orion Dispatch Memo ${nonce}`,
    textVi: `Ghi Chú Điều Phối ${nonce}`,
    delayed: `Reveal Aurora Panel ${nonce}`,
    missionStart: `Initiate Quartz Audit ${nonce}`,
    missionNote: `Quartz Audit Note ${nonce}`,
    missionSeal: `Seal Quartz Audit ${nonce}`,
    ambiguous: `Control Node ${nonce}`
  };
}

function routeTitle(route) {
  return `Agent Intelligence Lab ${route}`;
}

function labHtml(route, labels) {
  const base = `<!doctype html><html><head><meta charset="utf-8"><title>${routeTitle(route)}</title>
  <style>body{font-family:Arial,sans-serif;margin:28px;max-width:900px;line-height:1.4}section,form{display:grid;gap:12px;border:1px solid #bbb;border-radius:10px;padding:18px;margin:12px 0}button,input{font:inherit;padding:10px 12px}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}[hidden]{display:none!important}</style>
  </head><body><h1>${routeTitle(route)}</h1>`;

  if (route === 'click-en') {
    return `${base}<section><button>Approve Draft Packet</button><button id="target">${labels.clickEn}</button><button>Approve Archived Packet</button></section>
    <script>document.getElementById('target').onclick=()=>{document.title='PASS_CLICK_EN';}</script></body></html>`;
  }

  if (route === 'click-vi') {
    return `${base}<section><button>Gửi Bản Nháp</button><button id="target">${labels.clickVi}</button><button>Hủy Hồ Sơ</button></section>
    <script>document.getElementById('target').onclick=()=>{document.title='PASS_CLICK_VI';}</script></body></html>`;
  }

  if (route === 'text-en') {
    return `${base}<form id="f"><label>Backup Memo<input aria-label="Backup Memo"></label><label>${labels.textEn}<input id="target" aria-label="${labels.textEn}" autocomplete="off"></label><label>Archive Note<input aria-label="Archive Note"></label><button type="submit">Commit Dispatch</button></form>
    <script>document.getElementById('f').onsubmit=e=>{e.preventDefault();if(document.getElementById('target').value.length)document.title='PASS_TEXT_EN';}</script></body></html>`;
  }

  if (route === 'text-vi') {
    return `${base}<form id="f"><label>Ghi Chú Dự Phòng<input aria-label="Ghi Chú Dự Phòng"></label><label>${labels.textVi}<input id="target" aria-label="${labels.textVi}" autocomplete="off"></label><label>Ghi Chú Lưu Trữ<input aria-label="Ghi Chú Lưu Trữ"></label><button type="submit">Hoàn Tất Điều Phối</button></form>
    <script>document.getElementById('f').onsubmit=e=>{e.preventDefault();if(document.getElementById('target').value.length)document.title='PASS_TEXT_VI';}</script></body></html>`;
  }

  if (route === 'delayed') {
    return `${base}<section><button>Reveal Archive Panel</button><button id="target">${labels.delayed}</button><button>Reveal Legacy Panel</button></section>
    <script>let pending=false;document.getElementById('target').onclick=()=>{if(pending)return;pending=true;setTimeout(()=>{document.title='PASS_DELAYED';},1250);}</script></body></html>`;
  }

  if (route === 'mission') {
    return `${base}
    <section id="s1"><button>Initiate Legacy Audit</button><button id="start">${labels.missionStart}</button></section>
    <form id="s2" hidden><label>${labels.missionNote}<input id="note" aria-label="${labels.missionNote}" autocomplete="off"></label><label>Secondary Audit Note<input aria-label="Secondary Audit Note"></label><button type="submit">Advance Audit</button></form>
    <section id="s3" hidden><button>Seal Draft Audit</button><button id="seal">${labels.missionSeal}</button></section>
    <script>
      const s1=document.getElementById('s1'),s2=document.getElementById('s2'),s3=document.getElementById('s3');
      document.getElementById('start').onclick=()=>{s1.hidden=true;s2.hidden=false;};
      s2.onsubmit=e=>{e.preventDefault();if(!document.getElementById('note').value.length)return;s2.hidden=true;s3.hidden=false;};
      document.getElementById('seal').onclick=()=>{s3.hidden=true;document.title='PASS_MISSION';};
    </script></body></html>`;
  }

  if (route === 'ambiguous') {
    return `${base}<section><button>${labels.ambiguous}</button><button>${labels.ambiguous}</button><button>Other Node</button></section></body></html>`;
  }

  return `${base}<p>Unknown route</p></body></html>`;
}

function createLabServer(labels) {
  return http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${HOST}/`);
    const route = url.pathname.replace(/^\/+|\/+$/g, '');
    if (!['click-en','click-vi','text-en','text-vi','delayed','mission','ambiguous'].includes(route)) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(labHtml(route, labels));
  });
}

async function waitForRoute(client, tabId, urlPrefix, expectedTitle, timeoutMs = 10000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const observation = await client.observe(tabId);
      if (String(observation?.url || '').startsWith(urlPrefix) && observation?.title === expectedTitle) return observation;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`intelligence_lab_not_ready:${expectedTitle}:${lastError?.message || 'timeout'}`);
}

function runtimeFor(client, tabId) {
  return {
    observe: () => client.observe(tabId),
    listTabs: scope => client.listTabs(scope),
    executePlan: payload => client.executePlan({ ...payload, tabId }),
    executeBrowserAction: payload => client.executeBrowserAction({ ...payload, tabId })
  };
}

function targetLabel(step) {
  const ref = step?.action?.targetRef;
  if (!ref) return null;
  const elements = Array.isArray(step?.before?.interactiveElements) ? step.before.interactiveElements : [];
  return elements.find(element => element?.ref === ref)?.label || null;
}

function sequenceFor(result) {
  return (Array.isArray(result?.steps) ? result.steps : []).map(step => step?.action?.type || null);
}

function targetsFor(result) {
  return (Array.isArray(result?.steps) ? result.steps : []).map(targetLabel);
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function publicEpisodeResult(id, result, expectedActions, expectedTargets) {
  const actualActions = sequenceFor(result);
  const actualTargets = targetsFor(result);
  const goalSatisfied = result?.finalOutcome?.taskSucceeded === true && result?.finalBudget?.reasonCode === 'goal_satisfied';
  return {
    id,
    goalSatisfied,
    expectedActions,
    actualActions,
    expectedTargets,
    actualTargets,
    actionSequenceExact: sameJson(actualActions, expectedActions),
    targetSequenceExact: sameJson(actualTargets, expectedTargets),
    firstActionCorrect: actualActions[0] === expectedActions[0],
    firstTargetCorrect: actualTargets[0] === expectedTargets[0],
    actionCount: actualActions.length,
    expectedActionCount: expectedActions.length,
    efficient: actualActions.length === expectedActions.length,
    terminalDecision: result?.terminalDecision ? {
      status: result.terminalDecision.status || null,
      reasonCode: result.terminalDecision.reasonCode || null
    } : null,
    steps: (result?.steps || []).map(step => ({
      actionType: step?.action?.type || null,
      targetLabel: targetLabel(step),
      decisionReasonCode: step?.decision?.reasonCode || null,
      prototypeSource: step?.decision?.metadata?.prototypeSource || null,
      explicitActionIntent: step?.decision?.metadata?.explicitActionIntent === true,
      controlStatus: step?.control?.status || null,
      controlReasonCode: step?.control?.reasonCode || null,
      effectStatus: step?.effect?.status || null,
      effectCodes: Array.isArray(step?.effect?.codes) ? [...step.effect.codes] : []
    }))
  };
}

async function openScenarioTab(client, anchorTabId, baseUrl, route, timeoutMs) {
  const url = `${baseUrl}${route}`;
  const opened = await client.executeBrowserAction({
    tabId: anchorTabId,
    action: { browserActionVersion: '0.1.0', actionType: 'openNewTab', args: { url } }
  });
  const tabId = Number(opened?.tab?.tabId);
  if (!Number.isInteger(tabId) || tabId <= 0) throw new Error(`benchmark_tab_missing:${route}`);
  await waitForRoute(client, tabId, url, routeTitle(route), timeoutMs);
  return tabId;
}

async function closeTab(client, tabId) {
  if (!Number.isInteger(Number(tabId)) || Number(tabId) <= 0) return false;
  try {
    await client.executeBrowserAction({
      tabId: Number(tabId),
      action: { browserActionVersion: '0.1.0', actionType: 'closeTab', args: {} }
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function runEpisodeScenario({ client, anchorTabId, baseUrl, route, modelFile, instruction, passTitle, expectedActions, expectedTargets, transientText = null, recovery = false, timeoutMs = 10000 }) {
  let tabId = null;
  try {
    tabId = await openScenarioTab(client, anchorTabId, baseUrl, route, timeoutMs);
    const runtime = runtimeFor(client, tabId);
    const baseStrategy = createStrategy({ modelFile, minimumConfidence: 0 });
    const strategy = recovery
      ? createStrategy({ provider: createRecoveryExplorationProvider({ baseProvider: baseStrategy }) })
      : baseStrategy;
    const result = await executeBoundedEpisodeLoop({
      runtime,
      strategy,
      task: {
        taskId: `benchmark-${route}-${Date.now()}`,
        type: `fresh-intelligence-${route}`,
        instruction,
        args: {},
        successCriteria: [{ type: 'page', field: 'title', operator: 'equals', value: passTitle }],
        constraints: {},
        metadata: { benchmark: BENCHMARK_VERSION, evidenceClass: EVIDENCE_CLASS }
      },
      resolveTransientActionArgs: transientText
        ? ({ action }) => action?.type === 'typeText' ? { text: transientText } : null
        : null,
      postActionSettle: recovery
        ? { pollMs: 80, minWindowMs: 320, maxWindowMs: 760, stableSamples: 2 }
        : { pollMs: 80, minWindowMs: 240, maxWindowMs: 1000, stableSamples: 2 },
      budgets: {
        maxSteps: 5,
        maxDurationMs: 30000,
        maxConsecutiveFailures: 3,
        maxReplans: 4,
        maxStalledSteps: 3
      }
    });
    return publicEpisodeResult(route, result, expectedActions, expectedTargets);
  } finally {
    if (tabId) await closeTab(client, tabId);
  }
}

function missionCriterion(index, labels) {
  if (index === 0) return { type: 'element', match: { label: labels.missionNote }, expect: { exists: true, visible: true, enabled: true } };
  if (index === 1) return { type: 'element', match: { label: labels.missionSeal }, expect: { exists: true, visible: true, enabled: true } };
  if (index === 2) return { type: 'page', field: 'title', operator: 'equals', value: 'PASS_MISSION' };
  throw new Error(`benchmark_mission_index:${index}`);
}

async function runMissionScenario({ client, anchorTabId, baseUrl, modelFile, labels, transientText, timeoutMs = 10000 }) {
  const route = 'mission';
  let tabId = null;
  try {
    tabId = await openScenarioTab(client, anchorTabId, baseUrl, route, timeoutMs);
    const runtime = runtimeFor(client, tabId);
    const baseStrategy = createStrategy({ modelFile, minimumConfidence: 0 });
    const strategy = createStrategy({ provider: createRecoveryExplorationProvider({ baseProvider: baseStrategy }) });
    const instruction = `Click ${labels.missionStart}, then type the provided value into ${labels.missionNote} and press Enter, then click ${labels.missionSeal}`;
    const plan = createMissionPlan({
      missionId: `benchmark-mission-${labels.nonce}`,
      instruction,
      metadata: { benchmark: BENCHMARK_VERSION, evidenceClass: EVIDENCE_CLASS }
    });
    const result = await executeMissionWithStrategy({
      plan,
      runtime,
      strategy,
      resolveSubgoalTask: ({ subgoal, subgoalIndex }) => ({
        taskId: `benchmark-mission-${labels.nonce}:${subgoalIndex + 1}`,
        type: 'fresh-intelligence-mission',
        instruction: subgoal.instruction,
        args: {},
        successCriteria: [missionCriterion(subgoalIndex, labels)],
        constraints: {},
        metadata: { benchmark: BENCHMARK_VERSION, evidenceClass: EVIDENCE_CLASS, subgoalIndex }
      }),
      resolveTransientActionArgs: ({ action }) => action?.type === 'typeText' ? { text: transientText } : null,
      missionBudgets: { maxSubgoals: 3, maxDurationMs: 60000, stopOnSubgoalFailure: true },
      episodeBudgets: { maxSteps: 5, maxDurationMs: 25000, maxConsecutiveFailures: 3, maxReplans: 4, maxStalledSteps: 3 }
    });

    const expectedActions = [['click'], ['typeText', 'submit'], ['click']];
    const expectedTargets = [[labels.missionStart], [labels.missionNote, labels.missionNote], [labels.missionSeal]];
    const actualActions = (result?.subgoalResults || []).map(item => sequenceFor(item?.result));
    const actualTargets = (result?.subgoalResults || []).map(item => targetsFor(item?.result));
    const goalSatisfied = result?.ok === true && result?.reasonCode === 'mission_satisfied';
    return {
      id: route,
      goalSatisfied,
      expectedActions,
      actualActions,
      expectedTargets,
      actualTargets,
      actionSequenceExact: sameJson(actualActions, expectedActions),
      targetSequenceExact: sameJson(actualTargets, expectedTargets),
      firstActionCorrect: actualActions?.[0]?.[0] === 'click',
      firstTargetCorrect: actualTargets?.[0]?.[0] === labels.missionStart,
      actionCount: actualActions.flat().length,
      expectedActionCount: expectedActions.flat().length,
      efficient: actualActions.flat().length === expectedActions.flat().length,
      missionProgress: result?.progress || null,
      subgoals: (result?.subgoalResults || []).map(item => ({
        instruction: item?.instruction || null,
        status: item?.status || null,
        actions: sequenceFor(item?.result),
        targets: targetsFor(item?.result),
        finalBudgetReasonCode: item?.result?.finalBudget?.reasonCode || null
      }))
    };
  } finally {
    if (tabId) await closeTab(client, tabId);
  }
}

async function runAmbiguityScenario({ client, anchorTabId, baseUrl, modelFile, labels, timeoutMs = 10000 }) {
  const route = 'ambiguous';
  let tabId = null;
  try {
    tabId = await openScenarioTab(client, anchorTabId, baseUrl, route, timeoutMs);
    const observation = await client.observe(tabId);
    const strategy = createStrategy({ modelFile, minimumConfidence: 0 });
    const decision = await strategy.decide({
      task: {
        taskId: `benchmark-ambiguous-${labels.nonce}`,
        type: 'fresh-intelligence-ambiguity',
        instruction: `Click ${labels.ambiguous}`,
        args: {},
        successCriteria: [],
        constraints: {},
        metadata: { benchmark: BENCHMARK_VERSION, evidenceClass: EVIDENCE_CLASS, safeBlockExpected: true }
      },
      observation,
      history: []
    });
    const matching = (observation?.interactiveElements || []).filter(item => item?.label === labels.ambiguous);
    return {
      id: route,
      duplicateTargetCount: matching.length,
      expectedStatus: 'blocked',
      actualStatus: decision?.status || null,
      reasonCode: decision?.reasonCode || null,
      selectedTargetRef: decision?.action?.targetRef || decision?.targetRef || null,
      safeBlocked: matching.length > 1 && decision?.status === 'blocked'
    };
  } finally {
    if (tabId) await closeTab(client, tabId);
  }
}

function scoreBenchmark(scenarios, ambiguity) {
  const executable = scenarios;
  const byId = new Map(executable.map(item => [item.id, item]));

  const goalCompletion = 30 * (executable.filter(item => item.goalSatisfied).length / executable.length);
  const actionUnderstanding = 15 * (executable.filter(item => item.firstActionCorrect).length / executable.length);
  const grounding = 15 * (executable.filter(item => item.firstTargetCorrect).length / executable.length);

  let planQuality = 0;
  if (byId.get('text-en')?.actionSequenceExact) planQuality += 2;
  if (byId.get('text-vi')?.actionSequenceExact) planQuality += 2;
  if (byId.get('mission')?.actionSequenceExact && byId.get('mission')?.targetSequenceExact) planQuality += 6;

  const delayed = byId.get('delayed');
  const recovery = delayed?.goalSatisfied && sameJson(delayed?.actualActions, ['click', 'waitAndObserve']) ? 10 : 0;
  const generalization = 10 * (executable.filter(item => item.goalSatisfied && item.actionSequenceExact && item.targetSequenceExact).length / executable.length);
  const efficiency = 5 * (executable.filter(item => item.efficient).length / executable.length);
  const safeBlock = ambiguity?.safeBlocked === true ? 5 : 0;

  const dimensions = {
    goalCompletion: round1(goalCompletion),
    actionUnderstanding: round1(actionUnderstanding),
    targetGrounding: round1(grounding),
    planQuality: round1(planQuality),
    recovery: round1(recovery),
    unseenGeneralization: round1(generalization),
    efficiency: round1(efficiency),
    safeBlock: round1(safeBlock)
  };
  const total = round1(Object.values(dimensions).reduce((sum, value) => sum + Number(value || 0), 0));
  return { total, dimensions };
}

async function runBenchmark(options = {}) {
  const modelFile = path.resolve(String(options.modelFile || ''));
  if (!modelFile || !fs.existsSync(modelFile)) throw new Error(`model_file_missing:${modelFile}`);
  const model = JSON.parse(fs.readFileSync(modelFile, 'utf8'));
  const labels = makeLabels();
  const modelHashBefore = sha256File(modelFile);
  const server = createLabServer(labels);
  let client = null;

  try {
    const port = await listen(server);
    const baseUrl = `http://${HOST}:${port}/`;
    const agentId = options.agentId || await discoverRuntimeAgent(options.healthBase || 'http://127.0.0.1:3000');
    client = createBrokerRuntimeClient({
      url: options.broker || 'ws://127.0.0.1:3000',
      agentId,
      timeoutMs: Number(options.timeoutMs || 10000)
    });
    const anchorTabId = await activeAnchorTab(client);
    const transientA = `value-${crypto.randomBytes(10).toString('hex')}`;
    const transientB = `gia-tri-${crypto.randomBytes(10).toString('hex')}`;
    const transientMission = `audit-${crypto.randomBytes(10).toString('hex')}`;

    const scenarios = [];
    scenarios.push(await runEpisodeScenario({
      client, anchorTabId, baseUrl, route: 'click-en', modelFile,
      instruction: `Click ${labels.clickEn}`,
      passTitle: 'PASS_CLICK_EN', expectedActions: ['click'], expectedTargets: [labels.clickEn], timeoutMs: options.timeoutMs
    }));
    scenarios.push(await runEpisodeScenario({
      client, anchorTabId, baseUrl, route: 'click-vi', modelFile,
      instruction: `Hãy bấm ${labels.clickVi}`,
      passTitle: 'PASS_CLICK_VI', expectedActions: ['click'], expectedTargets: [labels.clickVi], timeoutMs: options.timeoutMs
    }));
    scenarios.push(await runEpisodeScenario({
      client, anchorTabId, baseUrl, route: 'text-en', modelFile,
      instruction: `Type the provided value into ${labels.textEn} and press Enter`, transientText: transientA,
      passTitle: 'PASS_TEXT_EN', expectedActions: ['typeText', 'submit'], expectedTargets: [labels.textEn, labels.textEn], timeoutMs: options.timeoutMs
    }));
    scenarios.push(await runEpisodeScenario({
      client, anchorTabId, baseUrl, route: 'text-vi', modelFile,
      instruction: `Hãy nhập giá trị được cung cấp vào ${labels.textVi} và nhấn Enter`, transientText: transientB,
      passTitle: 'PASS_TEXT_VI', expectedActions: ['typeText', 'submit'], expectedTargets: [labels.textVi, labels.textVi], timeoutMs: options.timeoutMs
    }));
    scenarios.push(await runEpisodeScenario({
      client, anchorTabId, baseUrl, route: 'delayed', modelFile,
      instruction: `Click ${labels.delayed}`, recovery: true,
      passTitle: 'PASS_DELAYED', expectedActions: ['click', 'waitAndObserve'], expectedTargets: [labels.delayed, null], timeoutMs: options.timeoutMs
    }));
    scenarios.push(await runMissionScenario({
      client, anchorTabId, baseUrl, modelFile, labels, transientText: transientMission, timeoutMs: options.timeoutMs
    }));
    const ambiguity = await runAmbiguityScenario({ client, anchorTabId, baseUrl, modelFile, labels, timeoutMs: options.timeoutMs });

    const modelHashAfter = sha256File(modelFile);
    const fitModuleImported = Object.keys(require.cache).some(file => /fit_strategy_offline_baseline\.js$/i.test(file));
    const score = scoreBenchmark(scenarios, ambiguity);
    const valid = modelHashBefore === modelHashAfter && !fitModuleImported;

    return {
      ok: valid,
      benchmark: 'agent-intelligence-browser-native',
      benchmarkVersion: BENCHMARK_VERSION,
      evidenceClass: EVIDENCE_CLASS,
      generatedNonce: labels.nonce,
      modelVersion: model?.modelVersion || model?.version || null,
      modelHashBefore,
      modelHashAfter,
      modelFileMutated: modelHashBefore !== modelHashAfter,
      trainingOrFitPerformed: fitModuleImported,
      score: valid ? score : { total: 0, dimensions: {} },
      scenarios,
      safetyScenario: ambiguity,
      interpretation: score.total >= 90 ? 'strong-controlled-generalization' : score.total >= 75 ? 'good-with-material-gaps' : score.total >= 60 ? 'partial-capability' : 'limited-generalization',
      note: 'Randomized labels prevent literal target replay. This is a controlled browser-native benchmark, not a claim of open-world intelligence.'
    };
  } finally {
    try { client?.close(); } catch (_) {}
    await closeServer(server);
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.model) throw new Error('--model is required');
  const output = await runBenchmark({
    modelFile: args.model,
    agentId: args.agent || null,
    healthBase: args['health-base'] || 'http://127.0.0.1:3000',
    broker: args.broker || 'ws://127.0.0.1:3000',
    timeoutMs: Number(args.timeout || 10000)
  });
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({
      ok: false,
      benchmark: 'agent-intelligence-browser-native',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  BENCHMARK_VERSION,
  EVIDENCE_CLASS,
  makeLabels,
  labHtml,
  createLabServer,
  waitForRoute,
  runtimeFor,
  targetLabel,
  publicEpisodeResult,
  missionCriterion,
  scoreBenchmark,
  runBenchmark,
  main
};