'use strict';

const { validateAgentAction } = require('./agent_action_contract.js');
const {
  RECOVERY_ACTION_TYPES,
  RECOVERY_TARGET_REQUIRED,
  triggerFromHistory
} = require('./recovery_policy_memory.js');
const { normalizeInstruction } = require('./self_experience_memory.js');

const RECOVERY_EXPLORATION_VERSION = '0.1.0';
const DEFAULT_RECOVERY_ACTION_TYPES = Object.freeze([
  'waitAndObserve',
  'scrollVertical',
  'scrollHorizontal',
  'scrollIntoView'
]);

function normalizeRecoveryActionTypes(value) {
  const input = Array.isArray(value) && value.length ? value : DEFAULT_RECOVERY_ACTION_TYPES;
  const out = [];
  for (const raw of input) {
    const type = String(raw || '').trim();
    if (!type || out.includes(type)) continue;
    if (!RECOVERY_ACTION_TYPES.has(type)) throw new Error(`recovery_exploration_action_unsupported:${type}`);
    out.push(type);
  }
  if (!out.length) throw new Error('recovery_exploration_actions_required');
  return out;
}

function candidateTargets(observation, type) {
  if (!RECOVERY_TARGET_REQUIRED.has(type)) return [{ targetRef: null, targetLabel: null }];
  const elements = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  return elements
    .filter(element => typeof element?.ref === 'string' && element.ref.trim())
    .filter(element => typeof element?.label === 'string' && element.label.trim())
    .filter(element => element.enabled !== false)
    .filter(element => type === 'scrollIntoView' || element.visible !== false)
    .map(element => ({ targetRef: element.ref.trim(), targetLabel: element.label.trim() }))
    .sort((a, b) => normalizeInstruction(a.targetLabel).localeCompare(normalizeInstruction(b.targetLabel)));
}

function recoveryCandidates(observation, actionTypes) {
  const out = [];
  for (const type of normalizeRecoveryActionTypes(actionTypes)) {
    for (const target of candidateTargets(observation, type)) {
      out.push({
        type,
        targetRef: target.targetRef,
        targetLabel: target.targetLabel,
        key: `${type}|${normalizeInstruction(target.targetLabel)}`
      });
    }
  }
  return out;
}

function taskExplorationKey(task) {
  return normalizeInstruction(task?.instruction) || '<unknown-task>';
}

function createRecoveryExplorationProvider(options = {}) {
  const baseProvider = options.baseProvider;
  if (!baseProvider || typeof baseProvider.decide !== 'function') throw new Error('recovery_exploration_base_provider_required');
  const actionTypes = normalizeRecoveryActionTypes(options.actionTypes);
  const triedByTask = new Map();

  return {
    name: 'recovery-self-exploration',
    version: RECOVERY_EXPLORATION_VERSION,

    async decide({ task, observation, history = [] }) {
      const trigger = triggerFromHistory(history);
      if (!trigger) return baseProvider.decide({ task, observation, history });

      const key = taskExplorationKey(task);
      const tried = triedByTask.get(key) || new Set();
      const candidates = recoveryCandidates(observation, actionTypes);
      const candidate = candidates.find(item => !tried.has(item.key)) || null;

      if (!candidate) {
        return baseProvider.decide({ task, observation, history });
      }

      tried.add(candidate.key);
      triedByTask.set(key, tried);
      const action = validateAgentAction({
        contractVersion: '0.1.0',
        type: candidate.type,
        targetRef: candidate.targetRef,
        args: {},
        intent: `recovery-self-exploration:${candidate.type}`,
        expectedOutcome: {}
      });

      return {
        status: 'act',
        action,
        targetRef: action.targetRef,
        confidence: 0,
        reasonCode: 'recovery_self_exploration',
        expectedOutcome: {},
        recovery: {},
        metadata: {
          prototypeSource: 'recoveryExploration',
          triggerActionType: trigger.actionType,
          triggerEffectStatus: trigger.effectStatus,
          triggerEffectCodes: trigger.effectCodes,
          explorationActionType: candidate.type,
          explorationTargetLabel: candidate.targetLabel,
          attemptedRecoveryCount: tried.size,
          candidateCount: candidates.length,
          actionTypes
        }
      };
    }
  };
}

module.exports = {
  RECOVERY_EXPLORATION_VERSION,
  DEFAULT_RECOVERY_ACTION_TYPES,
  normalizeRecoveryActionTypes,
  candidateTargets,
  recoveryCandidates,
  taskExplorationKey,
  createRecoveryExplorationProvider
};
