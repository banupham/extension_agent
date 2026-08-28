'use strict';

const assert = require('assert');
const { runGate, EXPECTED_ACTION_LABELS } = require('../offline_strategy_semantic_mission_gate.js');

function makeObservation(index, state) {
  const elements = [
    { ref: 'e0', tag: 'button', role: 'button', label: 'Mission Atlas', visible: true, enabled: true, rect: { x: 20, y: 20, width: 120, height: 40 } },
    { ref: 'e1', tag: 'button', role: 'button', label: 'Mission Orion', visible: true, enabled: true, rect: { x: 160, y: 20, width: 120, height: 40 } }
  ];
  if (state.stage === 1) elements.push({ ref: 'e2', tag: 'a', role: 'link', label: 'Robotics field guide', visible: true, enabled: true, rect: { x: 20, y: 100, width: 180, height: 30 } });
  if (state.stage === 2) {
    elements.push({ ref: 'e2', tag: 'a', role: 'link', label: 'Hồ Chí Minh forecast', visible: true, enabled: true, rect: { x: 20, y: 100, width: 180, height: 30 } });
    elements.push({ ref: 'e3', tag: 'a', role: 'link', label: '3 ngày tới', visible: true, enabled: true, rect: { x: 20, y: 140, width: 120, height: 30 } });
  }
  return {
    observationId: `obs-${index}`,
    capturedAt: Date.now(),
    url: state.stage === 0 ? 'http://127.0.0.1:8091/mission' : state.stage === 1 ? 'http://127.0.0.1:8091/mission/atlas' : 'http://127.0.0.1:8091/mission/orion',
    title: 'Semantic Mission Lab',
    viewport: { width: 1200, height: 800 },
    scroll: { x: 0, y: 0 },
    focusedRef: null,
    interactiveElements: elements
  };
}

async function main() {
  const state = { stage: 0 };
  let observationIndex = 0;
  let executionCount = 0;
  const runtime = {
    async observe() {
      observationIndex += 1;
      return makeObservation(observationIndex, state);
    },
    async listTabs() {
      return [{ title: 'Semantic Mission Lab', url: makeObservation(0, state).url, active: true }];
    },
    async executePlan() {
      executionCount += 1;
      state.stage = Math.min(2, state.stage + 1);
      return { ok: true };
    }
  };

  const result = await runGate({ runtime });
  assert.equal(result.ok, true);
  assert.equal(result.result, 'PASS');
  assert.equal(executionCount, 2);
  assert.deepEqual(result.actionLabels, EXPECTED_ACTION_LABELS);
  assert.equal(result.subgoals.length, 2);
  assert(result.subgoals.every(item => item.status === 'done'));
  assert(result.subgoals.every(item => !item.successCriteria.some(criterion => criterion.type === 'page' && criterion.field === 'title')));
  assert.equal(result.subgoals[1].successCriteria.some(criterion => criterion.type === 'pageSignal'), false);
  assert.equal(result.invariant.noPassTitleCriterionRequired, true);
  console.log('Offline Strategy semantic mission gate contract: PASS');
}

if (require.main === module) {
  main().catch(error => {
    console.error('Offline Strategy semantic mission gate contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { makeObservation, main };
