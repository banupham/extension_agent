'use strict';

const path = require('path');
const { validateAgentAction } = require('./agent_action_contract.js');
const {
  RECOVERY_ACTION_TYPES,
  RECOVERY_TARGET_REQUIRED,
  triggerFromHistory
} = require('./recovery_policy_memory.js');
const { normalizeInstruction } = require('./self_experience_memory.js');
const {
  readRecoveryOutcomeMemory,
  recoveryOutcomeStats
} = require('./recovery_outcome_memory.js');

const RECOVERY_EXPLORATION_VERSION = '0.3.0';
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
  let ordinal = 0;
  for (const type of normalizeRecoveryActionTypes(actionTypes)) {
    for (const target of candidateTargets(observation, type)) {
      out.push({
        type,
        targetRef: target.targetRef,
        targetLabel: target.targetLabel,
        key: `${type}|${normalizeInstruction(target.targetLabel)}`,
        ordinal: ordinal++
      });
    }
  }
  return out;
}

function taskExplorationKey(task) {
  return normalizeInstruction(task?.instruction) || '<unknown-task>';
}

function rootRecoveryTriggerFromHistory(history = []) {
  const direct = triggerFromHistory(history);
  if (!direct) return null;
  const last = Array.isArray(history) && history.length ? history[history.length - 1] : null;
  const source = String(last?.decisionSource || '').trim();
  const recoverySource = source === 'recoveryExploration' || source === 'recoveryPolicy';
  const rootActionType = String(last?.recoveryTriggerActionType || '').trim();
  if (!recoverySource || !rootActionType) return direct;
  return {
    actionType: rootActionType,
    targetLabel: typeof last?.recoveryTriggerTargetLabel === 'string' && last.recoveryTriggerTargetLabel.trim()
      ? last.recoveryTriggerTargetLabel.trim()
      : null,
    controlStatus: 'failed',
    reasonCode: String(last?.recoveryTriggerReasonCode || '').trim(),
    effectStatus: String(last?.recoveryTriggerEffectStatus || '').trim() || null,
    effectCodes: Array.isArray(last?.recoveryTriggerEffectCodes) ? [...last.recoveryTriggerEffectCodes] : []
  };
}

function sameRecoveryTrigger(entry, trigger) {
  if (!entry || !trigger) return false;
  if (String(entry.recoveryTriggerActionType || '').trim() !== String(trigger.actionType || '').trim()) return false;
  if (normalizeInstruction(entry.recoveryTriggerTargetLabel) !== normalizeInstruction(trigger.targetLabel)) return false;
  return true;
}

function attemptedRecoveryKeysFromHistory(history = [], trigger = null) {
  const keys = new Set();
  for (const entry of Array.isArray(history) ? history : []) {
    const source = String(entry?.decisionSource || '').trim();
    if (source !== 'recoveryExploration' && source !== 'recoveryPolicy') continue;
    if (trigger && !sameRecoveryTrigger(entry, trigger)) continue;
    const type = String(entry?.actionType || '').trim();
    if (!type) continue;
    keys.add(`${type}|${normalizeInstruction(entry?.actionTargetLabel)}`);
  }
  return keys;
}

function rankCandidatesByOutcomeHistory(candidates, records, task, trigger) {
  return (Array.isArray(candidates) ? candidates : [])
    .map(candidate => ({
      ...candidate,
      historical: recoveryOutcomeStats(records, {
        task,
        trigger,
        recovery: { type: candidate.type, targetLabel: candidate.targetLabel }
      })
    }))
    .sort((a, b) =>
      b.historical.confidence - a.historical.confidence ||
      b.historical.successes - a.historical.successes ||
      a.historical.failures - b.historical.failures ||
      a.ordinal - b.ordinal
    );
}

function semanticCandidateHistory(ranked) {
  return (Array.isArray(ranked) ? ranked : []).map(candidate => ({
    type: candidate.type,
    targetLabel: candidate.targetLabel,
    attempts: candidate.historical.attempts,
    successes: candidate.historical.successes,
    failures: candidate.historical.failures,
    successRate: candidate.historical.successRate,
    confidence: candidate.historical.confidence
  }));
}

function createRecoveryExplorationProvider(options = {}) {
  const baseProvider = options.baseProvider;
  if (!baseProvider || typeof baseProvider.decide !== 'function') throw new Error('recovery_exploration_base_provider_required');
  const actionTypes = normalizeRecoveryActionTypes(options.actionTypes);
  const triedByTask = new Map();
  const staticOutcomeRecords = Array.isArray(options.outcomeRecords) ? options.outcomeRecords : null;
  const outcomeMemoryFile = options.outcomeMemoryFile ? path.resolve(options.outcomeMemoryFile) : null;

  function currentOutcomeRecords() {
    if (staticOutcomeRecords) return staticOutcomeRecords;
    return outcomeMemoryFile ? readRecoveryOutcomeMemory(outcomeMemoryFile) : [];
  }

  return {
    name: 'recovery-self-exploration',
    version: RECOVERY_EXPLORATION_VERSION,

    async decide({ task, observation, history = [] }) {
      const trigger = rootRecoveryTriggerFromHistory(history);
      if (!trigger) return baseProvider.decide({ task, observation, history });

      const key = taskExplorationKey(task);
      const tried = triedByTask.get(key) || new Set();
      for (const attempted of attemptedRecoveryKeysFromHistory(history, trigger)) tried.add(attempted);

      const ranked = rankCandidatesByOutcomeHistory(
        recoveryCandidates(observation, actionTypes),
        currentOutcomeRecords(),
        task,
        trigger
      );
      const candidate = ranked.find(item => !tried.has(item.key)) || null;

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
        confidence: candidate.historical.attempts ? candidate.historical.confidence : 0,
        reasonCode: 'recovery_self_exploration',
        expectedOutcome: {},
        recovery: {},
        metadata: {
          prototypeSource: 'recoveryExploration',
          triggerActionType: trigger.actionType,
          triggerTargetLabel: trigger.targetLabel,
          triggerReasonCode: trigger.reasonCode,
          triggerEffectStatus: trigger.effectStatus,
          triggerEffectCodes: trigger.effectCodes,
          explorationActionType: candidate.type,
          explorationTargetLabel: candidate.targetLabel,
          attemptedRecoveryCount: tried.size,
          candidateCount: ranked.length,
          actionTypes,
          historicalAttempts: candidate.historical.attempts,
          historicalSuccesses: candidate.historical.successes,
          historicalFailures: candidate.historical.failures,
          historicalSuccessRate: candidate.historical.successRate,
          historicalConfidence: candidate.historical.confidence,
          candidateHistory: semanticCandidateHistory(ranked),
          outcomeMemory: !!outcomeMemoryFile
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
  rootRecoveryTriggerFromHistory,
  sameRecoveryTrigger,
  attemptedRecoveryKeysFromHistory,
  rankCandidatesByOutcomeHistory,
  semanticCandidateHistory,
  createRecoveryExplorationProvider
};
