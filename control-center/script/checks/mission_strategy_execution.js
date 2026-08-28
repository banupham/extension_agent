'use strict';

const assert = require('assert');
const { createMissionPlan } = require('../../manager/mission/mission_plan.js');
const { executeMissionWithStrategy } = require('../../manager/mission/mission_strategy_executor.js');

function observation(id, title) {
  return {
    observationId: id,
    capturedAt: new Date().toISOString(),
    url: 'http://mission.test/',
    title,
    viewport: { width: 1200, height: 800 },
    scroll: { x: 0, y: 0 },
    focusedElement: null,
    interactiveElements: [{ ref: 'e1', tag: 'button', role: 'button', label: 'Mission Action', visible: true, enabled: true }],
    pageSignals: {},
    privacy: { redacted: true }
  };
}

async function main() {
  const plan = createMissionPlan({
    missionId: 'mission-strategy',
    instruction: 'Mở Atlas và xem nội dung về robotics; sau đó kiểm tra dữ liệu ở Orion trong 3 ngày tới; cuối cùng khám phá giao diện Nova'
  });

  let title = 'MISSION READY';
  let expectedTitle = null;
  let observeCount = 0;
  let executeCount = 0;
  const runtime = {
    async observe() {
      observeCount += 1;
      return observation(`obs-${observeCount}`, title);
    },
    async executePlan() {
      executeCount += 1;
      title = expectedTitle;
      return { ok: true };
    }
  };

  const result = await executeMissionWithStrategy({
    plan,
    runtime,
    resolveSubgoalTask: async ({ subgoalIndex, subgoal, semantic }) => {
      expectedTitle = `MISSION SG${subgoalIndex + 1} PASS`;
      assert(semantic);
      return {
        taskId: `task-${subgoalIndex + 1}`,
        type: 'mission-contract',
        instruction: subgoal.instruction,
        successCriteria: [{ type: 'page', field: 'title', operator: 'equals', value: expectedTitle }]
      };
    },
    createStrategy: async ({ semantic }) => ({
      async decide({ history }) {
        assert.equal(history.length, 0);
        assert(semantic);
        return {
          status: 'act',
          action: { type: 'click', targetRef: 'e1', args: {} },
          confidence: 0.7,
          reasonCode: 'mission_contract_action',
          metadata: { prototypeSource: 'missionContract' }
        };
      }
    }),
    episodeBudgets: { maxSteps: 2, maxDurationMs: 120000, maxConsecutiveFailures: 1, maxReplans: 1, maxStalledSteps: 1 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.reasonCode, 'mission_satisfied');
  assert.equal(result.subgoalResults.length, 3);
  assert.equal(executeCount, 3);
  assert.equal(result.semanticMission.subgoals.length, 3);
  assert.equal(result.semanticMission.subgoals[0].destination, 'Atlas');
  assert.equal(result.semanticMission.subgoals[1].location, 'Orion');
  assert.equal(result.semanticMission.subgoals[1].temporalWindow.amount, 3);
  assert.equal(result.semanticMission.subgoals[2].goalKinds.includes('explore_interface'), true);
  assert.equal(result.invariant.orderedExecution, true);
  assert.equal(result.invariant.semanticSubgoalCountMatchesPlan, true);
  assert.equal(result.invariant.allCompletedSubgoalsUsedGoalCheckedEpisodes, true);
  assert(result.subgoalResults.every(item => item.result.invariant.selectorUsedByStrategy === false));

  console.log('Mission Strategy execution bridge contract: PASS');
}

if (require.main === module) {
  main().catch(error => {
    console.error('Mission Strategy execution bridge contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { observation, main };
