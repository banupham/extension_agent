'use strict';

const { executeBoundedEpisodeLoop } = require('./bounded_episode_loop.js');
const { learnRecoveryFromSuccessfulEpisode } = require('../strategy/recovery_policy_memory.js');

const SELF_LEARNING_EPISODE_VERSION = '0.1.0';

async function executeSelfLearningEpisode(input = {}) {
  const recoveryMemoryFile = input.recoveryMemoryFile;
  if (!recoveryMemoryFile) throw new Error('self_learning_recovery_memory_file_required');

  const result = await executeBoundedEpisodeLoop(input);
  let recoveryLearning = {
    attempted: false,
    learned: false,
    reasonCode: 'episode_not_successful',
    recordIds: [],
    write: null
  };

  if (
    result?.finalOutcome?.taskSucceeded === true &&
    result?.finalBudget?.terminal === true &&
    result?.finalBudget?.reasonCode === 'goal_satisfied'
  ) {
    const learned = learnRecoveryFromSuccessfulEpisode({
      file: recoveryMemoryFile,
      task: result.task,
      result
    });
    recoveryLearning = {
      attempted: true,
      learned: learned.learned,
      reasonCode: learned.learned ? 'recovery_learned' : 'no_recovery_transition_found',
      recordIds: learned.recordIds,
      write: learned.write
    };
  }

  return {
    ...result,
    selfLearningEpisodeVersion: SELF_LEARNING_EPISODE_VERSION,
    recoveryLearning
  };
}

module.exports = {
  SELF_LEARNING_EPISODE_VERSION,
  executeSelfLearningEpisode
};
