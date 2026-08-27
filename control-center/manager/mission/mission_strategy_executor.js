'use strict';

const { validateTask } = require('../strategy/contracts.js');
const { executeBoundedEpisodeLoop } = require('../agent/bounded_episode_loop.js');
const { resolveBehaviorBaseline } = require('../behavior/baseline_loader.js');
const { executeMission } = require('./mission_executor.js');
const { createSemanticMissionInterpreter } = require('./semantic_mission_interpreter.js');
const { createSemanticGoalResolver } = require('./semantic_goal_resolver.js');

const MISSION_STRATEGY_EXECUTOR_VERSION = '0.4.0';

function semanticBySubgoal(semanticMission) {
  return new Map((Array.isArray(semanticMission?.subgoals) ? semanticMission.subgoals : [])
    .map(item => [String(item?.subgoalId || ''), item]));
}

function validateResolverTask(rawTask, subgoal) {
  const task = validateTask({
    ...(rawTask || {}),
    taskId: rawTask?.taskId || `mission-subgoal-${subgoal.subgoalId}`,
    type: rawTask?.type || 'mission-subgoal',
    instruction: rawTask?.instruction || subgoal.instruction
  });
  if (!task.successCriteria.length) throw new Error(`mission_subgoal_success_criteria_required:${subgoal.subgoalId}`);
  return task;
}

async function executeMissionWithStrategy(input = {}) {
  if (!input.plan) throw new Error('mission_strategy_plan_required');
  if (!input.runtime) throw new Error('mission_strategy_runtime_required');
  if (!input.strategy && typeof input.createStrategy !== 'function') throw new Error('mission_strategy_provider_required');

  const behaviorBaseline = resolveBehaviorBaseline({
    baseline: input.baseline || null,
    baselineFile: input.baselineFile || null
  });
  const interpreter = input.interpreter || createSemanticMissionInterpreter();
  const goalResolver = input.goalResolver || createSemanticGoalResolver();
  const resolveSubgoalTask = typeof input.resolveSubgoalTask === 'function'
    ? input.resolveSubgoalTask
    : args => goalResolver.resolveSubgoalTask(args);
  const semanticMission = await interpreter.interpretPlan(input.plan);
  const semantics = semanticBySubgoal(semanticMission);

  const missionResult = await executeMission({
    plan: input.plan,
    budgets: input.missionBudgets,
    executeSubgoal: async ({ mission, subgoal, subgoalIndex }) => {
      const semantic = semantics.get(subgoal.subgoalId) || null;
      const rawTask = await resolveSubgoalTask({ mission, subgoal, semantic, subgoalIndex });
      const task = validateResolverTask(rawTask, subgoal);
      const strategy = typeof input.createStrategy === 'function'
        ? await input.createStrategy({ mission, subgoal, semantic, task, subgoalIndex })
        : input.strategy;
      if (!strategy || typeof strategy.decide !== 'function') throw new Error(`mission_strategy_invalid:${subgoal.subgoalId}`);

      const result = await executeBoundedEpisodeLoop({
        runtime: input.runtime,
        strategy,
        task,
        baseline: behaviorBaseline.artifact,
        budgets: input.episodeBudgets,
        postActionSettle: input.postActionSettle,
        resolveTransientActionArgs: typeof input.resolveTransientActionArgs === 'function'
          ? context => input.resolveTransientActionArgs({
            mission,
            subgoal,
            semantic,
            subgoalIndex,
            ...context
          })
          : null,
        onStep: typeof input.onStep === 'function'
          ? context => input.onStep({
            mission,
            subgoal,
            semantic,
            subgoalIndex,
            ...context
          })
          : null
      });
      return {
        ...result,
        missionSubgoal: {
          subgoalId: subgoal.subgoalId,
          instruction: subgoal.instruction,
          semantic,
          semanticGoalState: task.metadata?.semanticGoalState || null,
          semanticGoalResolutionSource: task.metadata?.semanticGoalResolutionSource || null
        }
      };
    }
  });

  const completed = missionResult.subgoalResults.filter(item => item.status === 'done');
  return {
    missionStrategyExecutorVersion: MISSION_STRATEGY_EXECUTOR_VERSION,
    semanticMission,
    behaviorBaseline: behaviorBaseline.metadata,
    ...missionResult,
    invariant: {
      ...(missionResult.invariant || {}),
      semanticSubgoalCountMatchesPlan: semanticMission.subgoals.length === missionResult.plan.subgoals.length,
      allCompletedSubgoalsUsedGoalCheckedEpisodes: completed
        .every(item => item?.result?.finalBudget?.reasonCode === 'goal_satisfied'),
      noPassTitleCriterionRequired: completed
        .every(item => item?.result?.task?.metadata?.titlePassCriterionRequired !== true),
      behaviorBaselineNeverReplaysLiteralTrajectory: behaviorBaseline.metadata.literalTrajectoryReplay === false,
      transientPayloadRedactedAcrossCompletedSubgoals: completed
        .every(item => item?.result?.invariant?.transientPayloadRedacted === true)
    }
  };
}

module.exports = {
  MISSION_STRATEGY_EXECUTOR_VERSION,
  semanticBySubgoal,
  validateResolverTask,
  executeMissionWithStrategy
};
