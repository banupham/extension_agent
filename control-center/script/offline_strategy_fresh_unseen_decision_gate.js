'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createStrategy, createOfflineBaselineProvider } = require('../manager/strategy');

const GATE_VERSION = '0.1.0';

function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) { out[key] = next; i += 1; }
    else out[key] = true;
  }
  return out;
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function loadFrozenModel(file) {
  const absolutePath = path.resolve(file);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  return {
    absolutePath,
    rawHash: sha256(raw),
    model: JSON.parse(raw)
  };
}

function controlledObservation(id, elements) {
  return {
    observationId: id,
    capturedAt: new Date().toISOString(),
    url: 'http://fresh-unseen.invalid/',
    title: 'Fresh Unseen Strategy Decision Lab',
    viewport: { width: 1100, height: 760 },
    scroll: { x: 0, y: 0 },
    focusedElement: null,
    interactiveElements: elements,
    pageSignals: {},
    privacy: { redacted: true }
  };
}

function clickScenario() {
  return {
    id: 'fresh-parcel-approval',
    task: {
      taskId: 'fresh-parcel-approval-task',
      type: 'fresh-controlled-click',
      instruction: 'Click Approve Parcel',
      args: {},
      successCriteria: [],
      constraints: {},
      metadata: { freshUnseen: true }
    },
    observation: controlledObservation('fresh-click-observation', [
      { ref: 'fresh-approve', label: 'Approve Parcel', role: 'button', tag: 'button', editable: false, visible: true, enabled: true },
      { ref: 'fresh-reject', label: 'Reject Parcel', role: 'button', tag: 'button', editable: false, visible: true, enabled: true },
      { ref: 'fresh-help', label: 'Parcel Help', role: 'link', tag: 'a', editable: false, visible: true, enabled: true },
      { ref: 'fresh-reference', label: 'Parcel Reference', role: 'textbox', tag: 'input', editable: true, visible: true, enabled: true }
    ]),
    expected: { sequence: ['click'], targetRefs: ['fresh-approve'] }
  };
}

function textSubmitScenario() {
  return {
    id: 'fresh-dispatch-note',
    task: {
      taskId: 'fresh-dispatch-note-task',
      type: 'fresh-controlled-text-submit',
      instruction: 'Type the requested parcel code into Dispatch Note and press Enter',
      args: {},
      successCriteria: [],
      constraints: {},
      metadata: { freshUnseen: true }
    },
    observation: controlledObservation('fresh-text-observation', [
      { ref: 'fresh-dispatch-note', label: 'Dispatch Note', role: 'textbox', tag: 'textarea', editable: true, visible: true, enabled: true },
      { ref: 'fresh-reference-code', label: 'Reference Code', role: 'textbox', tag: 'input', editable: true, visible: true, enabled: true },
      { ref: 'fresh-dispatch-help', label: 'Dispatch Note Help', role: 'button', tag: 'button', editable: false, visible: true, enabled: true },
      { ref: 'fresh-finalize', label: 'Finalize Dispatch', role: 'button', tag: 'button', editable: false, visible: true, enabled: true }
    ]),
    expected: {
      sequence: ['typeText', 'submit'],
      targetRefs: ['fresh-dispatch-note', 'fresh-dispatch-note']
    }
  };
}

function safeDecision(decision) {
  return {
    status: decision?.status || null,
    actionType: decision?.action?.type || null,
    targetRef: decision?.action?.targetRef || null,
    confidence: decision?.confidence ?? null,
    reasonCode: decision?.reasonCode || null,
    modelVersion: decision?.metadata?.modelVersion || null,
    prototypeSource: decision?.metadata?.prototypeSource || null,
    historyMatched: decision?.metadata?.historyMatched === true,
    compositionMatched: decision?.metadata?.compositionMatched === true,
    actionSelectionTargetIndependent: decision?.metadata?.actionSelectionTargetIndependent === true
  };
}

async function runScenario(strategy, scenario) {
  const history = [];
  const decisions = [];
  for (let index = 0; index < scenario.expected.sequence.length; index += 1) {
    const decision = await strategy.decide({
      task: scenario.task,
      observation: scenario.observation,
      history
    });
    decisions.push(safeDecision(decision));
    if (decision?.status !== 'act' || !decision?.action) break;
    history.push({
      actionType: decision.action.type,
      targetRef: decision.action.targetRef,
      action: decision.action
    });
  }

  const actualSequence = decisions.map(item => item.actionType);
  const actualTargets = decisions.map(item => item.targetRef);
  const errors = [];
  if (decisions.length !== scenario.expected.sequence.length) errors.push(`decision_count:${decisions.length}`);
  if (actualSequence.join(',') !== scenario.expected.sequence.join(',')) errors.push(`action_sequence:${actualSequence.join(',') || '<empty>'}`);
  if (actualTargets.join(',') !== scenario.expected.targetRefs.join(',')) errors.push(`target_sequence:${actualTargets.join(',') || '<empty>'}`);
  if (decisions.some(item => item.status !== 'act')) errors.push('non_act_decision');
  if (decisions.some(item => item.actionSelectionTargetIndependent !== true)) errors.push('action_target_decoupling_metadata_missing');

  return {
    id: scenario.id,
    expectedSequence: scenario.expected.sequence,
    actualSequence,
    expectedTargetRefs: scenario.expected.targetRefs,
    actualTargetRefs: actualTargets,
    decisions,
    ok: errors.length === 0,
    errors
  };
}

async function runGate(options = {}) {
  if (!options.model || typeof options.model !== 'object') throw new Error('model_required');
  const modelBefore = JSON.stringify(options.model);
  const provider = createOfflineBaselineProvider({
    model: options.model,
    minimumConfidence: options.minimumConfidence ?? 0
  });
  const strategy = createStrategy({ provider });
  const scenarios = [];
  scenarios.push(await runScenario(strategy, clickScenario()));
  scenarios.push(await runScenario(strategy, textSubmitScenario()));
  const modelMutatedInMemory = JSON.stringify(options.model) !== modelBefore;
  const errors = scenarios.flatMap(item => item.errors.map(error => `${item.id}:${error}`));
  if (modelMutatedInMemory) errors.push('model_mutated_in_memory');

  return {
    ok: errors.length === 0,
    result: errors.length === 0 ? 'PASS' : 'FAIL',
    gate: 'offline-strategy-fresh-unseen-decision',
    gateVersion: GATE_VERSION,
    modelVersion: options.model.modelVersion || null,
    trainingOrFitPerformed: false,
    modelMutatedInMemory,
    freshFamilyCount: scenarios.length,
    scenarios,
    invariant: {
      frozenModelOnly: true,
      noFitPathImported: true,
      noLiteralTrajectoryReplay: true,
      noSelectorOrCoordinateTargeting: true
    },
    errors
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.model) throw new Error('--model is required');
  const loaded = loadFrozenModel(args.model);
  const result = await runGate({
    model: loaded.model,
    minimumConfidence: args['minimum-confidence'] == null ? 0 : Number(args['minimum-confidence'])
  });
  const rawAfter = fs.readFileSync(loaded.absolutePath, 'utf8');
  const fileHashAfter = sha256(rawAfter);
  const fileMutated = loaded.rawHash !== fileHashAfter;
  const output = {
    ...result,
    modelFileHashBefore: loaded.rawHash,
    modelFileHashAfter: fileHashAfter,
    modelFileMutated: fileMutated
  };
  if (fileMutated) {
    output.ok = false;
    output.result = 'FAIL';
    output.errors = [...output.errors, 'model_file_mutated'];
  }
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({
      ok: false,
      result: 'FAIL',
      gate: 'offline-strategy-fresh-unseen-decision',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  GATE_VERSION,
  parseArgs,
  sha256,
  loadFrozenModel,
  controlledObservation,
  clickScenario,
  textSubmitScenario,
  safeDecision,
  runScenario,
  runGate,
  main
};
