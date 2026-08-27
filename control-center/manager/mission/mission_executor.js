'use strict';

const { validateMissionPlan, createMissionController } = require('./mission_plan.js');

const MISSION_EXECUTOR_VERSION = '0.1.0';

function subgoalSucceeded(result) {
  return result?.finalOutcome?.taskSucceeded === true &&
    result?.finalControl?.status === 'done' &&
    result?.finalBudget?.terminal === true &&
    result?.finalBudget?.reasonCode === 'goal_satisfied';
}

function subgoalTerminalStatus(result) {
  if (subgoalSucceeded(result)) return 'done';
  if (result?.finalControl?.status === 'blocked') return 'blocked';
  return 'failed';
}

function missionBudgets(value = {}) {
  return {
    maxSubgoals: Number.isInteger(Number(value.maxSubgoals)) && Number(value.maxSubgoals) > 0 ? Number(value.maxSubgoals) : 16,
    maxDurationMs: Number.isFinite(Number(value.maxDurationMs)) && Number(value.maxDurationMs) > 0 ? Number(value.maxDurationMs) : 10 * 60 * 1000,
    stopOnSubgoalFailure: value.stopOnSubgoalFailure !== false
  };
}

async function executeMission(input = {}) {
  const plan = validateMissionPlan(input.plan);
  if (typeof input.executeSubgoal !== 'function') throw new Error('mission_execute_subgoal_required');
  const budgets = missionBudgets(input.budgets || {});
  const startedAt = Date.now();
  const controller = createMissionController(plan);
  const subgoalResults = [];
  const executionOrder = [];
  let stopReason = null;

  while (true) {
    const progress = controller.progress();
    if (progress.missionDone) {
      stopReason = 'mission_satisfied';
      break;
    }
    if (progress.missionTerminal && !progress.missionDone) {
      stopReason = 'mission_terminal_with_failure';
      break;
    }
    if (subgoalResults.length >= budgets.maxSubgoals) {
      stopReason = 'mission_subgoal_budget_exhausted';
      break;
    }
    if (Date.now() - startedAt >= budgets.maxDurationMs) {
      stopReason = 'mission_duration_budget_exhausted';
      break;
    }

    const subgoal = controller.startNext();
    if (!subgoal) {
      stopReason = 'mission_no_pending_subgoal';
      break;
    }
    executionOrder.push(subgoal.subgoalId);

    let result;
    try {
      result = await input.executeSubgoal({
        mission: controller.getPlan(),
        subgoal,
        subgoalIndex: subgoalResults.length
      });
    } catch (error) {
      result = {
        finalOutcome: { taskSucceeded: false, errorCode: 'subgoal_executor_threw' },
        finalControl: { status: 'failed', reasonCode: 'subgoal_executor_threw' },
        finalBudget: { terminal: true, reasonCode: 'subgoal_executor_threw' },
        error: String(error?.message || error)
      };
    }

    const terminalStatus = subgoalTerminalStatus(result);
    controller.finishCurrent(terminalStatus);
    subgoalResults.push({
      subgoalId: subgoal.subgoalId,
      instruction: subgoal.instruction,
      status: terminalStatus,
      result
    });

    if (terminalStatus !== 'done' && budgets.stopOnSubgoalFailure) {
      stopReason = `subgoal_${terminalStatus}`;
      break;
    }
  }

  const finalPlan = controller.getPlan();
  const progress = controller.progress();
  const expectedOrder = finalPlan.subgoals.slice(0, executionOrder.length).map(item => item.subgoalId);
  return {
    missionExecutorVersion: MISSION_EXECUTOR_VERSION,
    ok: progress.missionDone,
    status: progress.missionDone ? 'done' : (progress.missionTerminal ? 'failed' : 'stopped'),
    reasonCode: stopReason || (progress.missionDone ? 'mission_satisfied' : 'mission_stopped'),
    plan: finalPlan,
    progress,
    subgoalResults,
    usage: {
      subgoalsExecuted: subgoalResults.length,
      elapsedMs: Date.now() - startedAt
    },
    invariant: {
      orderedExecution: JSON.stringify(executionOrder) === JSON.stringify(expectedOrder),
      noSkippedCompletedSubgoals: finalPlan.subgoals.every((item, index) =>
        item.status !== 'done' || finalPlan.subgoals.slice(0, index).every(previous => previous.status === 'done')
      ),
      oneActiveSubgoalAtEnd: finalPlan.subgoals.filter(item => item.status === 'active').length <= 1
    }
  };
}

module.exports = {
  MISSION_EXECUTOR_VERSION,
  subgoalSucceeded,
  subgoalTerminalStatus,
  missionBudgets,
  executeMission
};
