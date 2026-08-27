'use strict';

const assert = require('assert');
const { createMissionPlan } = require('../../manager/mission/mission_plan.js');
const { executeMissionWithStrategy } = require('../../manager/mission/mission_strategy_executor.js');

function observation(id, state) {
  return {
    observationId: id,
    capturedAt: new Date().toISOString(),
    url: state.url,
    title: state.title,
    viewport: { width: 1200, height: 800 },
    scroll: { x: 0, y: 0 },
    focusedElement: null,
    interactiveElements: [
      { ref: 'e1', tag: 'button', role: 'button', label: 'Mission Action', visible: true, enabled: true },
      ...(state.labels || []).map((label, index) => ({ ref: `content-${index + 1}`, tag: 'a', role: 'link', label, visible: true, enabled: true }))
    ],
    pageSignals: { ...(state.signals || {}) },
    privacy: { redacted: true }
  };
}

async function main() {
  const plan = createMissionPlan({
    missionId: 'semantic-goal-execution',
    instruction: 'Mở Atlas và xem nội dung về robotics; cuối cùng khám phá các tính năng Nova'
  });

  let observeCount = 0;
  let activeSubgoal = 0;
  const state = {
    url: 'https://home.example/',
    title: 'Home',
    labels: [],
    signals: {}
  };

  const runtime = {
    async observe() {
      observeCount += 1;
      return observation(`obs-${observeCount}`, state);
    },
    async executePlan() {
      if (activeSubgoal === 0) {
        state.url = 'https://atlas.example/library';
        state.title = 'Atlas Library';
        state.labels = ['Robotics field guide'];
      } else {
        state.url = 'https://nova.example/features';
        state.title = 'Nova Features';
        state.labels = ['Feature catalog'];
        state.signals.featureExplorationCompleted = true;
      }
      return { ok: true };
    }
  };

  const result = await executeMissionWithStrategy({
    plan,
    runtime,
    createStrategy: async ({ subgoalIndex, task }) => {
      activeSubgoal = subgoalIndex;
      assert(task.successCriteria.length > 0);
      assert.equal(task.successCriteria.some(item => item.type === 'page' && item.field === 'title'), false);
      return {
        async decide({ history }) {
          assert.equal(history.length, 0);
          return {
            status: 'act',
            action: { type: 'click', targetRef: 'e1', args: {} },
            confidence: 0.7,
            reasonCode: 'semantic_goal_contract_action',
            metadata: { prototypeSource: 'semanticGoalContract' }
          };
        }
      };
    },
    episodeBudgets: { maxSteps: 2, maxDurationMs: 120000, maxConsecutiveFailures: 1, maxReplans: 1, maxStalledSteps: 1 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.reasonCode, 'mission_satisfied');
  assert.equal(result.subgoalResults.length, 2);
  assert.equal(result.invariant.orderedExecution, true);
  assert.equal(result.invariant.allCompletedSubgoalsUsedGoalCheckedEpisodes, true);
  assert.equal(result.invariant.noPassTitleCriterionRequired, true);
  assert.equal(result.subgoalResults[0].result.task.successCriteria[0].field, 'url');
  assert.equal(result.subgoalResults[0].result.task.successCriteria[1].type, 'element');
  assert.equal(result.subgoalResults[1].result.task.successCriteria[0].type, 'pageSignal');
  assert(result.subgoalResults.every(item => item.result.finalBudget.reasonCode === 'goal_satisfied'));

  console.log('Mission semantic goal execution contract: PASS');
}

if (require.main === module) {
  main().catch(error => {
    console.error('Mission semantic goal execution contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { observation, main };
