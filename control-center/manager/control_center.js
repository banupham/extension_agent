#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { URL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const CHECKS = path.join(ROOT, 'script', 'checks');
const SERVER_JS = path.join(ROOT, 'server', 'server.js');
const EXTENSION = path.join(ROOT, 'extension', 'stealth-extension');
const PUBLIC = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state_v3.json');
const MANAGER_LOG_FILE = path.join(DATA_DIR, 'control_center.log');
const VARIANTS = path.join(__dirname, 'variants');
const HOST = '127.0.0.1';
const PORT = Number(process.env.MANAGER_PORT || 8788);
const BROKER_PORT = Number(process.env.BROKER_PORT || 3000);
const BROKER_URL = `http://127.0.0.1:${BROKER_PORT}`;
const BROKER_WS = `ws://127.0.0.1:${BROKER_PORT}`;
const MANAGER_VERSION = '3.10';

for (const p of [DATA_DIR, VARIANTS]) fs.mkdirSync(p, { recursive: true });

function initialState() {
  return {
    agentAliases: {},
    agentLaunchers: {},
    launchers: [],
    schedules: [],
    runs: [],
    apiToken: crypto.randomBytes(24).toString('hex'),
    nextIds: { launcher: 1, schedule: 1, run: 1 }
  };
}
function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { ...initialState(), ...raw, nextIds: { ...initialState().nextIds, ...(raw.nextIds || {}) } };
  } catch { return initialState(); }
}
let state = loadState();

for (const r of state.runs || []) {
  if (r.status === 'queued' || r.status === 'running') {
    r.status = 'interrupted';
    r.currentPhase = 'manager_restarted';
    r.error = r.error || 'Control Center restarted before this run was finalized';
    r.endedAt = r.endedAt || new Date().toISOString();
    r.pid = undefined;
  }
}

function saveState() {
  if (state.runs.length > 160) state.runs.splice(0, state.runs.length - 160);
  const persisted = {
    ...state,
    runs: state.runs.map(r => ({
      ...r,
      diagnostics: Array.isArray(r.diagnostics) ? r.diagnostics.slice(-80) : [],
      log: String(r.log || '').slice(-80000),
      pid: undefined
    }))
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(persisted, null, 2));
}
saveState();

const runProcesses = new Map();
const launcherProcesses = new Map();
const queues = new Map();
const workerPromises = new Map();
const activeRunByAgent = new Map();
const taskByRunId = new Map();
const runStreamBuffers = new Map();
const runFinishers = new Map();
const sequentialQueue = [];
let sequentialWorkerActive = false;
let brokerProcess = null;
let brokerLog = '';

function managerLog(event, data = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...data });
  try { fs.appendFileSync(MANAGER_LOG_FILE, line + '\n'); } catch (_) {}
  console.log('[manager]', line);
}
function runDiag(run, event, data = {}) {
  if (!run) return;
  if (!Array.isArray(run.diagnostics)) run.diagnostics = [];
  run.diagnostics.push({ ts: new Date().toISOString(), event, ...data });
  run.diagnostics = run.diagnostics.slice(-80);
  run.lastDiagnostic = event;
  managerLog(event, { runId: run.id, scenarioId: run.scenarioId, agentId: run.agentId, ...data });
}

function safeName(s) { return String(s || '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'scenario'; }
function scenarioFiles() {
  const excluded = new Set(['run_check.js', 'keyboard_probe_server.js']);
  const arr = [];
  if (fs.existsSync(CHECKS)) for (const f of fs.readdirSync(CHECKS)) {
    if (!f.endsWith('.js') || excluded.has(f)) continue;
    arr.push({ id: 'checks/' + f, name: f, file: path.join(CHECKS, f), kind: 'base' });
  }
  if (fs.existsSync(VARIANTS)) for (const f of fs.readdirSync(VARIANTS)) {
    if (!f.endsWith('.js')) continue;
    arr.push({ id: 'variants/' + f, name: f, file: path.join(VARIANTS, f), kind: 'variant' });
  }
  return arr.sort((a,b) => a.name.localeCompare(b.name));
}
function findScenario(id) { return scenarioFiles().find(x => x.id === id); }

function httpJson(urlPath) {
  return new Promise(resolve => {
    const req = http.get(BROKER_URL + urlPath, { timeout: 1200 }, res => {
      let s=''; res.on('data',d=>s+=d); res.on('end',()=>{ try { resolve(JSON.parse(s)); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.on('timeout',()=>{req.destroy();resolve(null);});
  });
}
async function getAgentsRaw() {
  const j = await httpJson('/agents');
  return j && j.ok && Array.isArray(j.agents) ? j.agents : [];
}
function normalizeAgent(a) {
  const tabs = Array.isArray(a.meta?.tabs) ? a.meta.tabs : [];
  const activeFromTabs = tabs.find(t => t.active) || null;
  const activeTab = a.meta?.activeTab || activeFromTabs || null;
  const alias = state.agentAliases[a.agentId] || a.meta?.label || '';
  return {
    agentId: a.agentId,
    connected: !!a.connected,
    connectedAt: a.connectedAt || null,
    lastSeen: a.lastSeen || null,
    alias,
    displayName: alias || (activeTab?.title ? activeTab.title.slice(0, 52) : `Browser ${String(a.agentId).slice(0,8)}`),
    activeTab,
    tabs,
    tabCount: Number(a.meta?.tabCount ?? tabs.length),
    userAgent: a.meta?.userAgent || '',
    platform: a.meta?.platform || '',
    extensionVersion: a.meta?.extensionVersion || '',
    launcherId: state.agentLaunchers[a.agentId] || null
  };
}
async function getAgents() { return (await getAgentsRaw()).map(normalizeAgent); }
async function brokerHealth() { const j = await httpJson('/health'); return j && j.ok ? j : null; }

function readManagerLogTail(maxLines = 120) {
  try {
    const lines = fs.readFileSync(MANAGER_LOG_FILE, 'utf8').trim().split(/\r?\n/);
    return lines.slice(-maxLines).join('\n');
  } catch { return ''; }
}

function startBroker() {
  if (brokerProcess) return;
  brokerProcess = spawn(process.execPath, [SERVER_JS], {
    cwd: path.dirname(SERVER_JS),
    env: { ...process.env, WS_PORT: String(BROKER_PORT), WS_HOST: '127.0.0.1' },
    windowsHide: true
  });
  const append = d => brokerLog = (brokerLog + d.toString()).slice(-40000);
  brokerProcess.stdout.on('data', append); brokerProcess.stderr.on('data', append);
  brokerProcess.on('exit', () => { brokerProcess = null; });
  brokerProcess.on('error', append);
}

function normalizeArgs(args) {
  if (Array.isArray(args)) return args.map(x => String(x)).filter(Boolean).slice(0, 80);
  if (!String(args || '').trim()) return [];
  const out = []; const re = /"([^"]*)"|'([^']*)'|([^\s]+)/g; let m;
  while ((m = re.exec(String(args))) && out.length < 80) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
function validateBrowserExe(exePath) {
  const p = path.resolve(String(exePath || '').trim());
  if (!p || !fs.existsSync(p)) throw new Error('Browser executable does not exist');
  const base = path.basename(p).toLowerCase();
  const allowed = ['chrome.exe','chromium.exe','msedge.exe','brave.exe','brave-browser.exe'];
  if (process.platform === 'win32' && !allowed.includes(base)) throw new Error('Executable must be a Chromium browser (chrome.exe, chromium.exe, msedge.exe, brave.exe)');
  return p;
}
function launcherById(id) { return state.launchers.find(x => x.id === id); }
function launchBrowserDefinition(def, extraArgs = []) {
  const exePath = validateBrowserExe(def.exePath);
  const args = [...normalizeArgs(def.args), ...normalizeArgs(extraArgs)];
  const cwd = def.cwd && fs.existsSync(def.cwd) ? def.cwd : path.dirname(exePath);
  const child = spawn(exePath, args, { cwd, detached: false, windowsHide: false });
  launcherProcesses.set(def.id, child);
  child.on('exit', () => launcherProcesses.delete(def.id));
  child.on('error', () => launcherProcesses.delete(def.id));
  return { ok: true, pid: child.pid, launcherId: def.id, exePath, args };
}

function newRun(task) {
  const id = 'run-' + state.nextIds.run++;
  const r = {
    id, scenarioId:task.scenarioId, agentId:task.agentId,
    agentName: state.agentAliases[task.agentId] || String(task.agentId).slice(0,12),
    status:'queued', createdAt:new Date().toISOString(), startedAt:null, endedAt:null,
    exitCode:null, log:'', timingProfile:task.timingProfile||null,
    totalSteps:0, completedSteps:0, currentStep:null, currentAction:null, currentPhase:'queued',
    lastStepDurationMs:null, resultOk:null, failedStep:null, error:null, userStopped:false,
    diagnostics:[{ts:new Date().toISOString(),event:'run_created'}], lastDiagnostic:'run_created'
  };
  state.runs.push(r); saveState(); return r;
}
const RUN_EVENT_PREFIX = '@@RUN_EVENT@@';

function finalizeRun(run, status, details = {}) {
  if (!run || ['done', 'failed', 'stopped', 'interrupted'].includes(run.status)) return false;
  runDiag(run, 'run_finalizing', { status, error: details.error || null, exitCode: details.exitCode ?? null });
  run.status = status;
  run.endedAt = run.endedAt || new Date().toISOString();
  if (details.exitCode !== undefined) run.exitCode = details.exitCode;
  if (details.error) run.error = String(details.error);
  run.pid = undefined;
  if (status === 'done') {
    run.currentPhase = 'done';
    run.resultOk = run.resultOk !== false;
    if (run.totalSteps) run.completedSteps = run.totalSteps;
  } else if (status === 'failed') {
    run.currentPhase = run.currentPhase === 'sequence_failed' ? 'sequence_failed' : 'failed';
  } else if (status === 'stopped') {
    run.currentPhase = 'stopped';
  } else if (status === 'interrupted') {
    run.currentPhase = 'interrupted';
  }
  const finisher = runFinishers.get(run.id);
  if (finisher) {
    runFinishers.delete(run.id);
    finisher({ ok: status === 'done', runId: run.id, code: run.exitCode ?? null, status });
  }
  saveState();
  return true;
}
function applyRunEvent(run, evt) {
  if (!evt || typeof evt !== 'object') return;
  if (evt.type === 'plan') {
    runDiag(run, 'runner_plan', { totalSteps: Number(evt.totalSteps) || 0 });
    run.totalSteps = Number(evt.totalSteps) || run.totalSteps || 0;
    run.currentPhase = 'preparing';
    return;
  }
  if (evt.type === 'progress') {
    runDiag(run, 'runner_progress', { step: evt.step, action: evt.action, phase: evt.phase, completedSteps: evt.completedSteps, totalSteps: evt.totalSteps });
    if (Number.isFinite(Number(evt.totalSteps))) run.totalSteps = Number(evt.totalSteps);
    if (Number.isFinite(Number(evt.completedSteps))) run.completedSteps = Number(evt.completedSteps);
    if (Number.isFinite(Number(evt.step))) run.currentStep = Number(evt.step);
    if (evt.action) run.currentAction = String(evt.action);
    if (evt.phase) run.currentPhase = String(evt.phase);
    if (Number.isFinite(Number(evt.durationMs))) run.lastStepDurationMs = Number(evt.durationMs);
    if (evt.error) run.error = String(evt.error);
    return;
  }
  if (evt.type === 'summary') {
    runDiag(run, 'runner_summary', { ok: !!evt.ok, failedStep: evt.failedStep ?? null, error: evt.error || null });
    run.resultOk = !!evt.ok;
    if (evt.failedStep != null) run.failedStep = Number(evt.failedStep);
    if (evt.error) run.error = String(evt.error);
    run.currentPhase = evt.ok ? 'sequence_done' : 'sequence_failed';
    if (evt.ok && run.totalSteps) run.completedSteps = run.totalSteps;
    finalizeRun(run, evt.ok ? 'done' : 'failed', { error: evt.error || null });
    const child = runProcesses.get(run.id);
    if (child) setTimeout(() => {
      const still = runProcesses.get(run.id);
      if (still && !still.killed) { try { still.kill(); } catch (_) {} }
    }, 1500);
    return;
  }
  if (evt.type === 'transport_error') {
    run.error = String(evt.error || 'Transport error');
    run.currentPhase = 'transport_error';
  }
}
function consumeStdout(run, chunk) {
  const prev = runStreamBuffers.get(run.id) || '';
  const combined = prev + chunk.toString();
  const lines = combined.split(/\r?\n/);
  runStreamBuffers.set(run.id, lines.pop() || '');
  for (const line of lines) {
    if (line.startsWith(RUN_EVENT_PREFIX)) {
      try { applyRunEvent(run, JSON.parse(line.slice(RUN_EVENT_PREFIX.length))); } catch (_) {}
    } else run.log = (run.log + line + '\n').slice(-80000);
  }
  saveState();
}
function flushStdout(run) {
  const rest = runStreamBuffers.get(run.id) || '';
  runStreamBuffers.delete(run.id);
  if (!rest) return;
  if (rest.startsWith(RUN_EVENT_PREFIX)) {
    try { applyRunEvent(run, JSON.parse(rest.slice(RUN_EVENT_PREFIX.length))); } catch (_) { run.log=(run.log+rest).slice(-80000); }
  } else run.log=(run.log+rest).slice(-80000);
}

function executeTask(task) {
  return new Promise(resolve => {
    const scenario = findScenario(task.scenarioId);
    if (!scenario || !task.agentId) {
      if (task.run) finalizeRun(task.run, 'failed', { error: 'Missing scenario or selected online browser' });
      return resolve({ ok: false, error: 'Missing scenario or selected online browser' });
    }
    const run = task.run || newRun(task);
    runDiag(run, 'execute_task_enter');
    activeRunByAgent.set(task.agentId, run.id);
    run.status = 'running';
    run.currentPhase = 'starting';
    run.startedAt = new Date().toISOString();
    run.endedAt = null;
    saveState();
    let settled = false;
    const settle = result => {
      if (settled) return;
      settled = true;
      runFinishers.delete(run.id);
      if (activeRunByAgent.get(task.agentId) === run.id) activeRunByAgent.delete(task.agentId);
      taskByRunId.delete(run.id);
      resolve(result);
    };
    runFinishers.set(run.id, settle);
    const env = { ...process.env, AGENT_WS: BROKER_WS, TARGET_AGENT_ID: task.agentId, TRACE_PLAN: task.tracePlan ? '1' : '0' };
    if (task.timingProfile) {
      if (task.timingProfile.delayScale != null) env.DELAY_SCALE = String(task.timingProfile.delayScale);
      if (task.timingProfile.jitterPct != null) env.DELAY_JITTER_PCT = String(task.timingProfile.jitterPct);
    }
    runDiag(run, 'child_spawn_request', { file: scenario.file, targetAgentId: task.agentId });
    const child = spawn(process.execPath, [scenario.file], { cwd: CHECKS, env, windowsHide: true });
    runProcesses.set(run.id, child);
    run.pid = child.pid;
    runDiag(run, 'child_spawned', { pid: child.pid });
    saveState();
    child.stdout.on('data', d => consumeStdout(run, d));
    child.stderr.on('data', d => { run.log = (run.log + d.toString()).slice(-80000); saveState(); });
    child.on('exit', code => {
      runDiag(run, 'child_exit', { code });
      flushStdout(run);
      runProcesses.delete(run.id);
      if (['done', 'failed', 'stopped', 'interrupted'].includes(run.status)) {
        run.exitCode = code;
        saveState();
        return settle({ ok: run.status === 'done', runId: run.id, code, status: run.status });
      }
      if (run.userStopped) finalizeRun(run, 'stopped', { exitCode: code });
      else if (code !== 0 || run.resultOk === false) finalizeRun(run, 'failed', { exitCode: code, error: run.error || (code !== 0 ? `Process exited with code ${code}` : null) });
      else finalizeRun(run, 'done', { exitCode: code });
      settle({ ok: run.status === 'done', runId: run.id, code, status: run.status });
    });
    child.on('error', err => {
      runDiag(run, 'child_error', { error: err.message });
      runProcesses.delete(run.id);
      runStreamBuffers.delete(run.id);
      run.log = (run.log + '\n' + err.message).slice(-80000);
      finalizeRun(run, 'failed', { error: err.message });
      settle({ ok: false, error: err.message, runId: run.id, status: 'failed' });
    });
  });
}

function worker(agentId) {
  const id = String(agentId);
  const existing = workerPromises.get(id);
  if (existing) return existing;
  const p = (async () => {
    managerLog('worker_start', { agentId: id, queued: (queues.get(id) || []).length });
    try {
      const q = queues.get(id) || [];
      while (q.length) {
        const task = q.shift();
        runDiag(task.run, 'worker_dequeued', { remaining: q.length });
        await executeTask(task);
      }
    } catch (err) {
      managerLog('worker_error', { agentId: id, error: String(err && err.stack || err) });
    } finally {
      workerPromises.delete(id);
      activeRunByAgent.delete(id);
      const q = queues.get(id) || [];
      managerLog('worker_stop', { agentId: id, queued: q.length });
      if (q.length) setImmediate(() => worker(id));
    }
  })();
  workerPromises.set(id, p);
  return p;
}

async function sequentialWorker() {
  if (sequentialWorkerActive) return;
  sequentialWorkerActive = true;
  try {
    while (sequentialQueue.length) await executeTask(sequentialQueue.shift());
  } finally {
    sequentialWorkerActive = false;
    if (sequentialQueue.length) sequentialWorker();
  }
}
async function submitBatch({scenarioIds,agentIds,mode='parallel',tracePlan=false,timingProfile=null,assignmentMode='all',assignments={}}) {
  const scenarios=(scenarioIds||[]).filter(id=>findScenario(id));
  const agents=await getAgents(); const online=new Map(agents.map(a=>[a.agentId,a]));
  const usable=[...new Set((agentIds||[]).map(String))].filter(id=>online.has(id));
  if(!scenarios.length||!usable.length) throw new Error('Select at least one scenario and one ONLINE browser');
  assignmentMode = String(assignmentMode || 'all');
  assignments = assignments && typeof assignments === 'object' ? assignments : {};
  const tasks=[];
  if (assignmentMode === 'all') {
    for (const agentId of usable) for (const scenarioId of scenarios) tasks.push({scenarioId,agentId,tracePlan,timingProfile});
  } else if (assignmentMode === 'pair') {
    usable.forEach((agentId, i) => tasks.push({scenarioId: scenarios[i % scenarios.length],agentId,tracePlan,timingProfile}));
  } else if (assignmentMode === 'random') {
    usable.forEach(agentId => tasks.push({scenarioId: scenarios[Math.floor(Math.random() * scenarios.length)],agentId,tracePlan,timingProfile}));
  } else if (assignmentMode === 'manual') {
    for (const agentId of usable) {
      const scenarioId = String(assignments[agentId] || '');
      if (!scenarios.includes(scenarioId)) throw new Error(`Manual assignment missing/invalid for browser ${agentId}`);
      tasks.push({scenarioId,agentId,tracePlan,timingProfile});
    }
  } else throw new Error(`Unknown assignment mode: ${assignmentMode}`);
  const runs=tasks.map(t=>{
    t.run=newRun(t);
    taskByRunId.set(t.run.id, t);
    runDiag(t.run, 'batch_task_created', { mode, assignmentMode });
    return t.run.id;
  });
  if(mode==='sequential') {
    for (const t of tasks) { sequentialQueue.push(t); runDiag(t.run, 'sequential_enqueued', { queueLength: sequentialQueue.length }); }
    sequentialWorker();
  } else {
    for(const t of tasks){
      const id=String(t.agentId);
      if(!queues.has(id))queues.set(id,[]);
      queues.get(id).push(t);
      runDiag(t.run, 'parallel_enqueued', { queueLength: queues.get(id).length });
    }
    for(const id of usable) setImmediate(()=>worker(String(id)));
  }
  return runs;
}

setInterval(async () => {
  const agents = await getAgents().catch(() => []);
  const online = new Set(agents.filter(a => a.connected).map(a => String(a.agentId)));
  const now = Date.now();
  for (const run of state.runs) {
    if (run.status !== 'queued') continue;
    const id = String(run.agentId);
    const task = taskByRunId.get(run.id);
    const ageMs = Math.max(0, now - new Date(run.createdAt).getTime());
    if (!online.has(id)) {
      if (ageMs > 1500 && run.lastDiagnostic !== 'waiting_agent_offline') { runDiag(run, 'waiting_agent_offline', { ageMs }); saveState(); }
      continue;
    }
    if (!task) {
      if (ageMs > 1500 && run.lastDiagnostic !== 'missing_runtime_task') { runDiag(run, 'missing_runtime_task', { ageMs }); saveState(); }
      continue;
    }
    const q = queues.get(id) || [];
    const inQueue = q.some(t => t.run && t.run.id === run.id);
    const workerActive = workerPromises.has(id);
    const activeRun = activeRunByAgent.get(id) || null;
    if (!inQueue && !workerActive && !activeRun) {
      if (!queues.has(id)) queues.set(id, []);
      queues.get(id).push(task);
      runDiag(run, 'watchdog_requeued', { ageMs });
      saveState();
      setImmediate(() => worker(id));
    } else if (inQueue && !workerActive) {
      runDiag(run, 'watchdog_worker_restart', { ageMs, queueLength: q.length });
      saveState();
      setImmediate(() => worker(id));
    } else if (ageMs > 3000 && run.lastDiagnostic !== 'queued_worker_busy') {
      runDiag(run, 'queued_worker_busy', { ageMs, inQueue, workerActive, activeRun });
      saveState();
    }
  }
}, 750);

function generateVariants(scenarioId,count,minScale,maxScale,maxJitter) {
  const base=findScenario(scenarioId); if(!base) throw Error('Scenario not found');
  if(base.kind==='variant' || /__variant_\d+/i.test(base.name||'')) throw Error('Chỉ được tạo variant từ scenario gốc, không tạo variant từ variant');
  count=Math.max(1,Math.min(30,Number(count)||5));
  minScale=Number(minScale);maxScale=Number(maxScale);maxJitter=Number(maxJitter);
  if(!Number.isFinite(minScale))minScale=.9;if(!Number.isFinite(maxScale))maxScale=1.1;if(maxScale<minScale)[minScale,maxScale]=[maxScale,minScale];
  const made=[];
  for(let i=1;i<=count;i++){
    const scale=+(minScale+Math.random()*(maxScale-minScale)).toFixed(3);
    const jitter=Math.round(Math.random()*Math.max(0,Math.min(50,Number.isFinite(maxJitter)?maxJitter:10)));
    const name=`${safeName(path.basename(base.name,'.js'))}__variant_${String(i).padStart(2,'0')}.js`;
    let reqPath=path.relative(VARIANTS,base.file).replace(/\\/g,'/'); if(!reqPath.startsWith('.'))reqPath='./'+reqPath;
    const code=`// Robustness timing variant; functional actions are unchanged.\nprocess.env.DELAY_SCALE=process.env.DELAY_SCALE||${JSON.stringify(String(scale))};\nprocess.env.DELAY_JITTER_PCT=process.env.DELAY_JITTER_PCT||${JSON.stringify(String(jitter))};\nrequire(${JSON.stringify(reqPath)});\n`;
    fs.writeFileSync(path.join(VARIANTS,name),code); made.push({name,scale,jitter});
  }
  return made;
}

function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',d=>{s+=d;if(s.length>3_000_000)req.destroy();});req.on('end',()=>{try{resolve(s?JSON.parse(s):{});}catch(e){reject(e);}});});}
function json(res,code,obj){const b=JSON.stringify(obj);res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(b);}
function file(res,p,type){if(!fs.existsSync(p)){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});fs.createReadStream(p).pipe(res);}
function externalTokenOk(req, data) { return String(req.headers['x-control-token'] || data?.token || '') === String(state.apiToken); }

async function api(req,res,u){
  try{
    if(req.method==='GET'&&u.pathname==='/api/state'){
      const agents=await getAgents(); const health=await brokerHealth();
      return json(res,200,{ok:true,agents,launchers:state.launchers.map(x=>({...x,running:launcherProcesses.has(x.id)})),scenarios:scenarioFiles(),schedules:state.schedules,runs:state.runs,runtime:{managerVersion:MANAGER_VERSION,broker:health,brokerLog:brokerLog.slice(-8000),extensionPath:EXTENSION,apiToken:state.apiToken,brokerWs:BROKER_WS,managerLog:readManagerLogTail(120)}});
    }
    if(req.method==='GET'&&u.pathname==='/api/v1/agents'){
      if(String(req.headers['x-control-token']||'')!==String(state.apiToken))return json(res,403,{ok:false,error:'Invalid X-Control-Token'});
      return json(res,200,{ok:true,agents:await getAgents()});
    }
    const d=await body(req);
    if(req.method==='POST'&&u.pathname==='/api/agent/rename'){
      const agents=await getAgents(); if(!agents.some(a=>a.agentId===d.agentId)) throw Error('Agent is not online');
      const name=String(d.name||'').trim().slice(0,80); if(name)state.agentAliases[d.agentId]=name; else delete state.agentAliases[d.agentId]; saveState(); return json(res,200,{ok:true});
    }
    if(req.method==='POST'&&u.pathname==='/api/agent/link-launcher'){
      if(d.launcherId&&!launcherById(d.launcherId))throw Error('Launcher not found');
      if(d.launcherId)state.agentLaunchers[d.agentId]=d.launcherId;else delete state.agentLaunchers[d.agentId];saveState();return json(res,200,{ok:true});
    }
    if(req.method==='POST'&&u.pathname==='/api/launcher/save'){
      const exePath=validateBrowserExe(d.exePath); let x=d.id&&launcherById(d.id);
      if(!x){x={id:'launcher-'+state.nextIds.launcher++};state.launchers.push(x);}
      Object.assign(x,{name:String(d.name||path.basename(exePath)).trim().slice(0,100),exePath,args:normalizeArgs(d.args),cwd:String(d.cwd||'').trim(),notes:String(d.notes||'').trim().slice(0,500)});saveState();return json(res,200,{ok:true,launcher:x});
    }
    if(req.method==='POST'&&u.pathname==='/api/launcher/remove'){
      state.launchers=state.launchers.filter(x=>x.id!==d.id);for(const [agent,id] of Object.entries(state.agentLaunchers))if(id===d.id)delete state.agentLaunchers[agent];saveState();return json(res,200,{ok:true});
    }
    if(req.method==='POST'&&u.pathname==='/api/launcher/launch'){
      const x=launcherById(d.id);if(!x)throw Error('Launcher not found');return json(res,200,launchBrowserDefinition(x,d.extraArgs||[]));
    }
    if(req.method==='POST'&&u.pathname==='/api/v1/launch'){
      if(!externalTokenOk(req,d))return json(res,403,{ok:false,error:'Invalid X-Control-Token'});
      const x=d.launcherId?launcherById(d.launcherId):null;
      if(x)return json(res,200,launchBrowserDefinition(x,d.extraArgs||[]));
      if(!d.exePath)throw Error('launcherId or exePath is required');
      const temp={id:'external',exePath:d.exePath,args:d.args||[],cwd:d.cwd||''};return json(res,200,launchBrowserDefinition(temp,d.extraArgs||[]));
    }
    if(req.method==='POST'&&u.pathname==='/api/v1/run'){
      if(!externalTokenOk(req,d))return json(res,403,{ok:false,error:'Invalid X-Control-Token'});
      const runs=await submitBatch({scenarioIds:d.scenarioIds||[],agentIds:d.agentIds||[],mode:d.mode||'parallel',assignmentMode:d.assignmentMode||'all',assignments:d.assignments||{},tracePlan:!!d.tracePlan});
      return json(res,200,{ok:true,runs});
    }
    if(req.method==='POST'&&u.pathname==='/api/open-extension-folder'){if(process.platform==='win32')spawn('explorer.exe',[EXTENSION],{detached:true,windowsHide:false});return json(res,200,{ok:true,path:EXTENSION});}
    if(req.method==='POST'&&u.pathname==='/api/run'){const runs=await submitBatch(d);return json(res,200,{ok:true,runs});}
    if(req.method==='POST'&&u.pathname==='/api/run/stop'){const r=state.runs.find(x=>x.id===d.id);if(r){r.userStopped=true;r.currentPhase='stopping';saveState();}const c=runProcesses.get(d.id);if(c)c.kill();return json(res,200,{ok:true});}
    if(req.method==='POST'&&u.pathname==='/api/variants'){const base=findScenario(d.scenarioId);const made=generateVariants(d.scenarioId,d.count,d.minScale,d.maxScale,d.maxJitter);return json(res,200,{ok:true,baseName:base?.name||d.scenarioId,made});}
    if(req.method==='POST'&&u.pathname==='/api/scenario/import'){const name=safeName(d.filename||'imported.js');if(!name.endsWith('.js'))throw Error('Only .js files');fs.writeFileSync(path.join(CHECKS,name),String(d.content||''));return json(res,200,{ok:true,id:'checks/'+name});}
    if(req.method==='POST'&&u.pathname==='/api/schedule/save'){
      let x=d.id&&state.schedules.find(s=>s.id===d.id);if(!x){x={id:'schedule-'+state.nextIds.schedule++};state.schedules.push(x);}
      Object.assign(x,{name:d.name||x.id,scenarioIds:d.scenarioIds||[],agentIds:d.agentIds||[],mode:d.mode||'parallel',assignmentMode:d.assignmentMode||'all',assignments:d.assignments||{},startAt:d.startAt,repeatMinutes:Math.max(0,Number(d.repeatMinutes||0)),enabled:d.enabled!==false,lastRunAt:x.lastRunAt||null,nextRunAt:d.startAt});saveState();return json(res,200,{ok:true,schedule:x});
    }
    if(req.method==='POST'&&u.pathname==='/api/schedule/remove'){state.schedules=state.schedules.filter(x=>x.id!==d.id);saveState();return json(res,200,{ok:true});}
    return json(res,404,{ok:false,error:'Not found'});
  }catch(e){return json(res,400,{ok:false,error:e.message});}
}

setInterval(async()=>{
  const now=Date.now();for(const s of state.schedules){if(!s.enabled||!s.nextRunAt)continue;const due=new Date(s.nextRunAt).getTime();if(!Number.isFinite(due)||due>now)continue;
    try{await submitBatch(s);s.lastRunAt=new Date().toISOString();s.nextRunAt=s.repeatMinutes>0?new Date(now+s.repeatMinutes*60000).toISOString():null;if(!s.nextRunAt)s.enabled=false;delete s.lastError;saveState();}
    catch(e){s.lastError=e.message;s.enabled=false;saveState();}
  }
},3000);

startBroker();
const srv=http.createServer((req,res)=>{
  const u=new URL(req.url,`http://${req.headers.host||HOST}`);
  if(u.pathname.startsWith('/api/'))return api(req,res,u);
  if(u.pathname==='/'||u.pathname==='/index.html')return file(res,path.join(PUBLIC,'index.html'),'text/html; charset=utf-8');
  if(u.pathname==='/app.js')return file(res,path.join(PUBLIC,'app.js'),'application/javascript; charset=utf-8');
  if(u.pathname==='/style.css')return file(res,path.join(PUBLIC,'style.css'),'text/css; charset=utf-8');
  res.writeHead(404);res.end('Not found');
});
srv.on('error', err => { console.error('Control Center startup error:', err.message); process.exitCode = 1; });
srv.listen(PORT,HOST,()=>console.log(`Control Center V${MANAGER_VERSION}: http://${HOST}:${PORT}`));
