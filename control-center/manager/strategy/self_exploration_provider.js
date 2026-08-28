'use strict';

const { validateAgentAction } = require('./agent_action_contract.js');

const SELF_EXPLORATION_VERSION = '0.2.0';

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function explorationStateSignature(observation) {
  const elements = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  return JSON.stringify({
    url: String(observation?.url || ''),
    title: String(observation?.title || ''),
    scroll: {
      x: Number(observation?.scroll?.x || 0),
      y: Number(observation?.scroll?.y || 0)
    },
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

function normalizeActionTypes(value) {
  const input = Array.isArray(value) && value.length ? value : ['click', 'scrollIntoView'];
  const out = [];
  for (const raw of input) {
    const type = String(raw || '').trim();
    if (!type || out.includes(type)) continue;
    validateAgentAction({
      contractVersion: '0.1.0',
      type,
      targetRef: 'probe-ref',
      args: {},
      intent: 'self-exploration-probe',
      expectedOutcome: {}
    });
    out.push(type);
  }
  if (!out.length) throw new Error('self_exploration_action_types_required');
  return out;
}

function explorationCandidates(observation, options = {}) {
  const actionTypes = normalizeActionTypes(options.actionTypes);
  const targets = candidateTargets(observation, options);
  const candidates = [];
  for (const type of actionTypes) {
    for (const target of targets) {
      candidates.push({
        type,
        ref: target.ref,
        label: target.label,
        key: `${type}|${normalizeText(target.label)}`
      });
    }
  }
  return candidates;
}

function createSelfExplorationProvider(options = {}) {
  const targetLabelPrefix = String(options.targetLabelPrefix || 'Discovery ');
  const actionTypes = normalizeActionTypes(options.actionTypes);
  const triedByState = new Map();
  let decisionCount = 0;

  return {
    name: 'self-exploration-strategy',
    version: SELF_EXPLORATION_VERSION,

    async decide({ observation }) {
      const stateSignature = explorationStateSignature(observation);
      const stateTried = triedByState.get(stateSignature) || new Set();
      const candidates = explorationCandidates(observation, { targetLabelPrefix, actionTypes });
      const candidate = candidates.find(item => !stateTried.has(item.key)) || null;

      if (!candidate) {
        return {
          status: 'blocked',
          confidence: 0,
          reasonCode: 'self_exploration_state_exhausted',
          recovery: { suggested: 'expand_action_space_or_reset_state' },
          metadata: {
            prototypeSource: 'selfExploration',
            candidateCount: candidates.length,
            triedCount: stateTried.size,
            decisionCount,
            actionTypes
          }
        };
      }

      stateTried.add(candidate.key);
      triedByState.set(stateSignature, stateTried);
      decisionCount += 1;

      const action = validateAgentAction({
        contractVersion: '0.1.0',
        type: candidate.type,
        targetRef: candidate.ref,
        args: {},
        intent: `self-exploration:${candidate.type}`,
        expectedOutcome: {}
      });

      return {
        status: 'act',
        action,
        targetRef: action.targetRef,
        confidence: 0,
        reasonCode: 'self_exploration_novel_action_target',
        expectedOutcome: {},
        recovery: {},
        metadata: {
          prototypeSource: 'selfExploration',
          targetLabel: candidate.label,
          explorationActionType: candidate.type,
          candidateCount: candidates.length,
          stateAttemptIndex: stateTried.size - 1,
          decisionCount,
          actionTypes
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
  normalizeActionTypes,
  explorationCandidates,
  createSelfExplorationProvider,
  stepChangedSemantically,
  progressiveExperienceResult
};
