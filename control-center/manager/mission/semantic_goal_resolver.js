'use strict';

const { normalizeMissionText } = require('./mission_plan.js');

const SEMANTIC_GOAL_RESOLVER_VERSION = '0.2.0';

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

function destinationNeedle(value) {
  return normalizeMissionText(value).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/.\s]/)[0];
}

function temporalEvidencePhrase(window) {
  if (!window || typeof window !== 'object') return null;
  const amount = Number(window.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = String(window.unit || '').toLowerCase();
  if (unit === 'day') return `${amount} ngày`;
  if (unit === 'week') return `${amount} tuần`;
  if (unit === 'month') return `${amount} tháng`;
  return String(window.phrase || '').trim() || null;
}

function semanticGoalStateFor(semantic = {}) {
  const kinds = new Set(Array.isArray(semantic.goalKinds) ? semantic.goalKinds : []);
  return {
    destinationReached: kinds.has('navigate') ? normalizeMissionText(semantic.destination) || null : null,
    relevantContentObserved: kinds.has('consume_content') ? normalizeMissionText(semantic.topic) || null : null,
    searchResultsObserved: kinds.has('search'),
    requestedInformationCaptured: kinds.has('retrieve_information'),
    requestedLocationObserved: kinds.has('retrieve_information') ? normalizeMissionText(semantic.location) || null : null,
    requestedTemporalWindowObserved: kinds.has('retrieve_information') ? temporalEvidencePhrase(semantic.temporalWindow) : null,
    contextualInteractionCompleted: kinds.has('interact_contextually'),
    featureExplorationCompleted: kinds.has('explore_interface')
  };
}

function compileGoalState(goalState = {}) {
  const criteria = [];
  const unresolved = [];

  if (goalState.destinationReached) {
    const needle = destinationNeedle(goalState.destinationReached);
    if (needle) criteria.push({ type: 'page', field: 'url', operator: 'includes', value: needle });
    else unresolved.push('navigate_destination_unresolvable');
  }

  if (goalState.relevantContentObserved) {
    criteria.push({
      type: 'element',
      match: { labelIncludes: goalState.relevantContentObserved },
      expect: { exists: true, visible: true }
    });
  }

  if (goalState.searchResultsObserved) {
    criteria.push({ type: 'pageSignal', key: 'searchResultsObserved', operator: 'equals', value: true });
  }

  if (goalState.requestedInformationCaptured) {
    let semanticEvidenceCount = 0;
    if (goalState.requestedLocationObserved) {
      semanticEvidenceCount += 1;
      criteria.push({
        type: 'element',
        match: { labelIncludes: goalState.requestedLocationObserved },
        expect: { exists: true, visible: true }
      });
    }
    if (goalState.requestedTemporalWindowObserved) {
      semanticEvidenceCount += 1;
      criteria.push({
        type: 'element',
        match: { labelIncludes: goalState.requestedTemporalWindowObserved },
        expect: { exists: true, visible: true }
      });
    }
    if (!semanticEvidenceCount) {
      criteria.push({ type: 'pageSignal', key: 'requestedInformationCaptured', operator: 'equals', value: true });
      unresolved.push('retrieval_semantic_evidence_missing');
    }
  }

  if (goalState.contextualInteractionCompleted) {
    criteria.push({ type: 'pageSignal', key: 'contextualInteractionCompleted', operator: 'equals', value: true });
  }

  if (goalState.featureExplorationCompleted) {
    criteria.push({ type: 'pageSignal', key: 'featureExplorationCompleted', operator: 'equals', value: true });
  }

  return { criteria: uniqueCriteria(criteria), unresolved };
}

function semanticCriteriaFor(semantic = {}) {
  const goalState = semanticGoalStateFor(semantic);
  const compiled = compileGoalState(goalState);
  return { ...compiled, goalState };
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
      semanticGoalState: resolution.goalState,
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
  destinationNeedle,
  temporalEvidencePhrase,
  semanticGoalStateFor,
  compileGoalState,
  semanticCriteriaFor,
  heuristicResolveSubgoalTask,
  createHeuristicSemanticGoalProvider,
  createSemanticGoalResolver
};
