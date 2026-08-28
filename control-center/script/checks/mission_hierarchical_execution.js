'use strict';

const assert = require('assert');
const { createMissionPlan } = require('../../manager/mission/mission_plan.js');
const { executeMission } = require('../../manager/mission/mission_executor.js');

function successResult(label) {
  return {
    label,
    finalOutcome: { taskSucceeded: true },
    finalControl: { status: 'done', reasonCode: 'goal_satisfied' },
    finalBudget: { terminal: true, reasonCode: 'goal_satisfied' }
  };
}

async function main() {
  const plan = createMissionPlan({
    missionId: 'mission-exec',
    instruction: 'Khảo sát nguồn A; sau đó kiểm tra nguồn B; cuối cùng tổng hợp nguồn C'
  });
  const seen = [];
  const result = await executeMission({
    plan,
    executeSubgoal: async ({ subgoal }) => {
      seen.push(subgoal.subgoalId);
      return successResult(subgoal.subgoalId);
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'done');
  assert.equal(result.reasonCode, 'mission_satisfied');
  assert.equal(result.progress.done, 3);
  assert.equal(result.progress.progress, 1);
  assert.deepEqual(seen, ['mission-exec:sg-1', 'mission-exec:sg-2', 'mission-exec:sg-3']);
  assert.equal(result.invariant.orderedExecution, true);
  assert.equal(result.invariant.noSkippedCompletedSubgoals, true);

  const failingPlan = createMissionPlan({
    missionId: 'mission-fail',
    instruction: 'Làm bước một; sau đó làm bước hai; cuối cùng làm bước ba'
  });
  const failing = await executeMission({
    plan: failingPlan,
    executeSubgoal: async ({ subgoalIndex }) => {
      if (subgoalIndex === 1) {
        return {
          finalOutcome: { taskSucceeded: false },
          finalControl: { status: 'blocked', reasonCode: 'needs_replan' },
          finalBudget: { terminal: true, reasonCode: 'blocked' }
        };
      }
      return successResult(`step-${subgoalIndex}`);
    }
  });

  assert.equal(failing.ok, false);
  assert.equal(failing.reasonCode, 'subgoal_blocked');
  assert.equal(failing.usage.subgoalsExecuted, 2);
  assert.equal(failing.plan.subgoals[0].status, 'done');
  assert.equal(failing.plan.subgoals[1].status, 'blocked');
  assert.equal(failing.plan.subgoals[2].status, 'pending');
  assert.equal(failing.invariant.orderedExecution, true);

  console.log('Hierarchical mission execution contract: PASS');
}

if (require.main === module) {
  main().catch(error => {
    console.error('Hierarchical mission execution contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { successResult, main };
