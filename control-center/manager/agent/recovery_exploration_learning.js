'use strict';

const { executeBoundedEpisodeLoop } = require('./bounded_episode_loop.js');
const { validateAgentAction } = require('../strategy/agent_action_contract.js');
const { targetLabelForStep } = require('../strategy/self_experience_memory.js');
const {
  RECOVERY_POLICY_VERSION,
  RECOVERY_POLICY_KIND,
  RECOVERY_ACTION_TYPES,
  RECOVERY_TARGET_REQUIRED,
  stepEffect,
  isRecoveryTriggerStep,
  isUsefulRecoveryStep,
  recoveryFingerprint,
  validateRecoveryRecord,
  appendRecoveryRecords
} = require('../strategy/recovery_policy_memory.js');
const { recordRecoveryOutcomes } = require('../strategy/recovery_outcome_memory.js');

const RECOVERY_EXPLORATION_LEARNING_VERSION = '0.2.0';

function firstUsefulRecoveryIndex(steps, triggerIndex) {
  for (let index = triggerIndex + 1; index < steps.length; index += 1) {
    if (isUsefulRecoveryStep(steps[index])) return index;
  }
  return -1;
}

function buildExploratoryRecoveryRecords({ task, result, learnedAt = new Date().toISOString() } = {}) {
  if (!task || typeof task.instruction !== 'string' || !task.instruction.trim()) {
    throw new Error('recovery_exploration_task_required');
  }
  if (!result || typeof result !== 'object') throw new Error('recovery_exploration_result_required');
  if (result?.finalOutcome?.taskSucceeded !== true) throw new Error('recovery_exploration_requires_successful_episode');
  if (result?.finalBudget?.terminal !== true || result?.finalBudget?.reasonCode !== 'goal_satisfied') {
    throw new Error('recovery_exploration_requires_goal_satisfied_budget');
  }

  const steps = Array.isArray(result.steps) ? result.steps : [];
  const records = [];

  for (let triggerIndex = 0; triggerIndex + 1 < steps.length; triggerIndex += 1) {
    const triggerStep = steps[triggerIndex];
    if (!isRecoveryTriggerStep(triggerStep)) continue;

    const recoveryIndex = firstUsefulRecoveryIndex(steps, triggerIndex);
    if (recoveryIndex < 0) continue;
    const recoveryStep = steps[recoveryIndex];
    const triggerAction = validateAgentAction(triggerStep?.action || triggerStep?.decision?.action || null);
    const recoveryAction = validateAgentAction(recoveryStep?.action || recoveryStep?.decision?.action || null);
    if (!RECOVERY_ACTION_TYPES.has(recoveryAction.type)) continue;

    const recoveryTargetLabel = RECOVERY_TARGET_REQUIRED.has(recoveryAction.type)
      ? targetLabelForStep(recoveryStep)
      : null;
    if (RECOVERY_TARGET_REQUIRED.has(recoveryAction.type) && !recoveryTargetLabel) continue;

    const triggerEffect = stepEffect(triggerStep);
    const base = {
      memoryVersion: RECOVERY_POLICY_VERSION,
      kind: RECOVERY_POLICY_KIND,
      source: 'agent-self-experience',
      learnedAt,
      task: { instruction: task.instruction.trim() },
      trigger: {
        actionType: triggerAction.type,
        targetLabel: targetLabelForStep(triggerStep),
        controlStatus: String(triggerStep?.control?.status || 'failed'),
        reasonCode: String(triggerStep?.control?.reasonCode || triggerStep?.outcome?.errorCode || 'unspecified'),
        effectStatus: triggerEffect.status,
        effectCodes: triggerEffect.codes
      },
      recovery: {
        type: recoveryAction.type,
        targetLabel: recoveryTargetLabel
      },
      verification: {
        sourceEpisodeSucceeded: true,
        recoveryStepHadUsefulEffect: true,
        exploratoryRetriesSkipped: Math.max(0, recoveryIndex - triggerIndex - 1),
        privacyRedacted: true,
        selectorsStored: false,
        rawCoordinatesStored: false,
        observationLocalRefsStored: false,
        privateReasoningStored: false,
        taskPayloadArgsStored: false
      }
    };
    const recoveryId = `recovery-${recoveryFingerprint(base).slice(0, 20)}`;
    records.push(validateRecoveryRecord({ ...base, recoveryId }));
  }

  return records;
}

function learnExploratoryRecoveryFromSuccessfulEpisode({ file, task, result, learnedAt = new Date().toISOString() } = {}) {
  if (!file) throw new Error('recovery_exploration_memory_file_required');
  const records = buildExploratoryRecoveryRecords({ task, result, learnedAt });
  const write = appendRecoveryRecords(file, records);
  return {
    learned: records.length > 0,
    records,
    recordIds: records.map(record => record.recoveryId),
    write
  };
}

async function executeRecoveryExplorationLearningEpisode(input = {}) {
  if (!input.recoveryMemoryFile) throw new Error('recovery_exploration_memory_file_required');
  const result = await executeBoundedEpisodeLoop(input);

  const recoveryOutcomeLearning = input.recoveryOutcomeMemoryFile
    ? recordRecoveryOutcomes({
      file: input.recoveryOutcomeMemoryFile,
      task: result.task,
      result
    })
    : { attempted: 0, appended: 0, records: [], writes: [], file: null };

  let recoveryLearning = {
    attempted: false,
    learned: false,
    reasonCode: 'episode_not_successful',
    records: [],
    recordIds: [],
    write: null
  };

  if (
    result?.finalOutcome?.taskSucceeded === true &&
    result?.finalBudget?.terminal === true &&
    result?.finalBudget?.reasonCode === 'goal_satisfied'
  ) {
    const learned = learnExploratoryRecoveryFromSuccessfulEpisode({
      file: input.recoveryMemoryFile,
      task: result.task,
      result
    });
    recoveryLearning = {
      attempted: true,
      learned: learned.learned,
      reasonCode: learned.learned ? 'exploratory_recovery_learned' : 'no_recovery_transition_found',
      records: learned.records,
      recordIds: learned.recordIds,
      write: learned.write
    };
  }

  return {
    ...result,
    recoveryExplorationLearningVersion: RECOVERY_EXPLORATION_LEARNING_VERSION,
    recoveryLearning,
    recoveryOutcomeLearning
  };
}

module.exports = {
  RECOVERY_EXPLORATION_LEARNING_VERSION,
  firstUsefulRecoveryIndex,
  buildExploratoryRecoveryRecords,
  learnExploratoryRecoveryFromSuccessfulEpisode,
  executeRecoveryExplorationLearningEpisode
};
