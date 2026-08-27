'use strict';

const { normalizeMissionText } = require('./mission_plan.js');

const SEMANTIC_GOAL_RESOLVER_VERSION = '0.1.0';

function uniqueCriteria(criteria) {
  const seen = new Set();
  const out = [];
  for (const criterion of Array.isArray(criteria) ? criteria : []) {
    const key = JSON.stringify(criterion);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(criterion);
  }
  return out;
}

function semanticFact(key, operator, value) {
  return { type: 'semanticFact', key, operator, value };
}

function semanticCriteriaFor(semantic = {}) {
  const kinds = new Set(Array.isArray(semantic.goalKinds) ? semantic.goalKinds : []);
  const criteria = [];
  const unresolved = [];
  const destination = normalizeMissionText(semantic.destination);
  const topic = normalizeMissionText(semantic.topic);
  const location = normalizeMissionText(semantic.location);

  if (kinds.has('navigate')) {
    if (destination) criteria.push(semanticFact('site.identity', 'includes', destination));
    else unresolved.push('navigate_destination_missing');
  }

  if (kinds.has('consume_content')) {
    if (topic) criteria.push(semanticFact('content.semanticText', 'includes', topic));
    else unresolved.push('content_topic_missing');
  }

  if (kinds.has('search')) {
    criteria.push(semanticFact('signal.searchResultsObserved', 'equals', true));
  }

  if (kinds.has('retrieve_information')) {
    if (location) criteria.push(semanticFact('content.semanticText', 'includes', location));
    criteria.push(semanticFact('signal.requestedInformationCaptured', 'equals', true));
  }

  if (kinds.has('interact_contextually')) {
    criteria.push(semanticFact('signal.contextualInteractionCompleted', 'equals', true));
  }

  if (kinds.has('explore_interface')) {
    criteria.push(semanticFact('signal.featureExplorationCompleted', 'equals', true));
  }

  return {
    criteria: uniqueCriteria(criteria),
    unresolved
  };
}

function heuristicResolveSubgoalTask({ subgoal, semantic } = {}) {
  if (!subgoal || typeof subgoal !== 'object') throw new Error('semantic_goal_subgoal_required');
  if (!semantic || typeof semantic !== 'object') throw new Error('semantic_goal_semantic_required');
  const resolution = semanticCriteriaFor(semantic);
  return {
    taskId: `semantic-${String(subgoal.subgoalId || Date.now())}`,
    type: 'semantic-mission-subgoal',
    instruction: subgoal.instruction,
    args: {},
    successCriteria: resolution.criteria,
    constraints: {},
    metadata: {
      semanticGoalResolverVersion: SEMANTIC_GOAL_RESOLVER_VERSION,
      semanticGoalResolutionSource: 'heuristic-semantic-goal',
      unresolved: resolution.unresolved,
      titlePassCriterionRequired: false
    }
  };
}

function createHeuristicSemanticGoalProvider() {
  return {
    name: 'heuristic-semantic-goal',
    version: SEMANTIC_GOAL_RESOLVER_VERSION,
    async resolveSubgoalTask(input) {
      return heuristicResolveSubgoalTask(input);
    }
  };
}

function createSemanticGoalResolver(options = {}) {
  const provider = options.provider || createHeuristicSemanticGoalProvider();
  if (!provider || typeof provider.resolveSubgoalTask !== 'function') throw new Error('semantic_goal_provider_required');
  return {
    name: provider.name || 'semantic-goal-provider',
    version: provider.version || SEMANTIC_GOAL_RESOLVER_VERSION,
    async resolveSubgoalTask(input) {
      const task = await provider.resolveSubgoalTask(input);
      if (!task || typeof task !== 'object') throw new Error('semantic_goal_task_required');
      return {
        ...task,
        metadata: {
          ...(task.metadata || {}),
          semanticGoalProvider: provider.name || 'semantic-goal-provider'
        }
      };
    }
  };
}

module.exports = {
  SEMANTIC_GOAL_RESOLVER_VERSION,
  uniqueCriteria,
  semanticFact,
  semanticCriteriaFor,
  heuristicResolveSubgoalTask,
  createHeuristicSemanticGoalProvider,
  createSemanticGoalResolver
};
