'use strict';

const {
  STRATEGY_CONTRACT_VERSION,
  validateTask,
  validateObservation,
  validateDecision
} = require('./contracts');
const { createBaselineStrategy } = require('./baseline_strategy');

function resolveProvider(provider) {
  if (!provider || provider === 'baseline') return createBaselineStrategy();
  if (typeof provider === 'object' && typeof provider.decide === 'function') return provider;
  throw new Error('strategy provider must be "baseline" or an object implementing decide()');
}

function createStrategy(options = {}) {
  const provider = resolveProvider(options.provider);

  return {
    contractVersion: STRATEGY_CONTRACT_VERSION,
    provider: {
      name: provider.name || 'custom',
      version: provider.version || 'unknown'
    },

    async decide({ task, observation, history = [] }) {
      const normalizedTask = validateTask(task);
      const normalizedObservation = validateObservation(observation);
      const normalizedHistory = Array.isArray(history) ? history : [];

      const rawDecision = await provider.decide({
        task: normalizedTask,
        observation: normalizedObservation,
        history: normalizedHistory
      });

      return validateDecision(rawDecision);
    }
  };
}

module.exports = {
  createStrategy,
  ...require('./contracts'),
  ...require('./agent_action_contract'),
  ...require('./execution_surface_contract'),
  ...require('./execution_behavior_contract'),
  ...require('./offline_baseline_provider'),
  ...require('./self_experience_memory')
};
