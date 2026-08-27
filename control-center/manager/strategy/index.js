'use strict';

const {
  STRATEGY_CONTRACT_VERSION,
  validateTask,
  validateObservation,
  validateDecision
} = require('./contracts');
const { createBaselineStrategy } = require('./baseline_strategy');
const { createOfflineBaselineProvider } = require('./offline_baseline_provider');
const { resolveOfflineStrategyModel } = require('./offline_model_loader');

function resolveProvider(provider) {
  if (!provider || provider === 'baseline') return createBaselineStrategy();
  if (typeof provider === 'object' && typeof provider.decide === 'function') return provider;
  throw new Error('strategy provider must be "baseline" or an object implementing decide()');
}

function resolveStrategyProvider(options = {}) {
  const hasModelSource = !!options.model || !!options.modelFile;
  if (hasModelSource && options.provider) throw new Error('strategy_provider_and_model_source_ambiguous');
  if (!hasModelSource) {
    return {
      provider: resolveProvider(options.provider),
      modelMetadata: resolveOfflineStrategyModel({}).metadata
    };
  }

  const resolved = resolveOfflineStrategyModel({
    model: options.model || null,
    modelFile: options.modelFile || null
  });
  return {
    provider: createOfflineBaselineProvider({
      model: resolved.model,
      minimumConfidence: options.minimumConfidence
    }),
    modelMetadata: resolved.metadata
  };
}

function createStrategy(options = {}) {
  const resolved = resolveStrategyProvider(options);
  const provider = resolved.provider;

  return {
    contractVersion: STRATEGY_CONTRACT_VERSION,
    provider: {
      name: provider.name || 'custom',
      version: provider.version || 'unknown'
    },
    model: resolved.modelMetadata,

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
  resolveProvider,
  resolveStrategyProvider,
  ...require('./contracts'),
  ...require('./agent_action_contract'),
  ...require('./execution_surface_contract'),
  ...require('./execution_behavior_contract'),
  ...require('./offline_baseline_provider'),
  ...require('./offline_model_loader'),
  ...require('./self_experience_memory'),
  ...require('./self_exploration_provider'),
  ...require('./recovery_policy_memory'),
  ...require('./recovery_exploration_provider'),
  ...require('./recovery_outcome_memory'),
  ...require('./recovery_memory_consolidation'),
  ...require('./adaptive_recovery_provider'),
  ...require('./recovery_transfer_provider')
};
