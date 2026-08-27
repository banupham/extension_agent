'use strict';

const { validateAgentAction } = require('./agent_action_contract.js');

const SELF_EXPLORATION_VERSION = '0.1.0';

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function explorationStateSignature(observation) {
  const elements = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  return JSON.stringify({
    url: String(observation?.url || ''),
    title: String(observation?.title || ''),
    elements: elements.map(element => ({
      label: String(element?.label || ''),
      tag: String(element?.tag || ''),
      role: String(element?.role || ''),
      visible: element?.visible !== false,
      enabled: element?.enabled !== false,
      checked: typeof element?.checked === 'boolean' ? element.checked : null,
      selectedValue: element?.selectedValue == null ? null : String(element.selectedValue)
    }))
  });
}

function candidateTargets(observation, options = {}) {
  const prefix = normalizeText(options.targetLabelPrefix || 'Discovery ');
  const elements = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  return elements
    .filter(element => typeof element?.ref === 'string' && element.ref.trim())
    .filter(element => typeof element?.label === 'string' && element.label.trim())
    .filter(element => element.visible !== false && element.enabled !== false)
    .filter(element => !prefix || normalizeText(element.label).startsWith(prefix))
    .map(element => ({ ref: element.ref.trim(), label: element.label.trim() }))
    .sort((a, b) => normalizeText(a.label).localeCompare(normalizeText(b.label)) || a.ref.localeCompare(b.ref));
}

function createSelfExplorationProvider(options = {}) {
  const actionType = String(options.actionType || 'click').trim();
  const targetLabelPrefix = String(options.targetLabelPrefix || 'Discovery ');
  const triedByState = new Map();
  let decisionCount = 0;

  return {
    name: 'self-exploration-strategy',
    version: SELF_EXPLORATION_VERSION,

    async decide({ observation }) {
      const stateSignature = explorationStateSignature(observation);
      const stateTried = triedByState.get(stateSignature) || new Set();
      const candidates = candidateTargets(observation, { targetLabelPrefix });
      const candidate = candidates.find(item => !stateTried.has(normalizeText(item.label))) || null;

      if (!candidate) {
        return {
          status: 'blocked',
          confidence: 0,
          reasonCode: 'self_exploration_state_exhausted',
          recovery: { suggested: 'reset_or_expand_search' },
          metadata: {
            prototypeSource: 'selfExploration',
            candidateCount: candidates.length,
            triedCount: stateTried.size,
            decisionCount
          }
        };
      }

      stateTried.add(normalizeText(candidate.label));
      triedByState.set(stateSignature, stateTried);
      decisionCount += 1;

      const action = validateAgentAction({
        contractVersion: '0.1.0',
        type: actionType,
        targetRef: candidate.ref,
        args: {},
        intent: `self-exploration:${actionType}`,
        expectedOutcome: {}
      });

      return {
        status: 'act',
        action,
        targetRef: action.targetRef,
        confidence: 0,
        reasonCode: 'self_exploration_novel_target',
        expectedOutcome: {},
        recovery: {},
        metadata: {
          prototypeSource: 'selfExploration',
          targetLabel: candidate.label,
          candidateCount: candidates.length,
          stateAttemptIndex: stateTried.size - 1,
          decisionCount
        }
      };
    }
  };
}

function stepChangedSemantically(step) {
  if (!step?.before || !step?.after) return false;
  return explorationStateSignature(step.before) !== explorationStateSignature(step.after);
}

function progressiveExperienceResult(result) {
  if (!result || typeof result !== 'object') throw new Error('self_exploration_result_required');
  const steps = (Array.isArray(result.steps) ? result.steps : []).filter(step =>
    step?.outcome?.taskSucceeded === true || stepChangedSemantically(step)
  );
  if (!steps.length) throw new Error('self_exploration_no_progressive_steps');
  return { ...result, steps };
}

module.exports = {
  SELF_EXPLORATION_VERSION,
  normalizeText,
  explorationStateSignature,
  candidateTargets,
  createSelfExplorationProvider,
  stepChangedSemantically,
  progressiveExperienceResult
};
