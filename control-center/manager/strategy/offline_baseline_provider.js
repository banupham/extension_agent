'use strict';

const { validateAgentAction } = require('./agent_action_contract.js');

function tokens(value) {
  return new Set((String(value || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter(Boolean));
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  const union = new Set([...a, ...b]);
  if (!union.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / union.size;
}

function bestSimilarity(needleTokens, phrases) {
  let best = 0;
  for (const phrase of phrases || []) best = Math.max(best, jaccard(needleTokens, tokens(phrase)));
  return best;
}

function historyActionTypes(history) {
  return (Array.isArray(history) ? history : [])
    .map(item => String(item?.actionType || item?.action?.type || '').trim())
    .filter(Boolean);
}

function sameActionHistory(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function validatePrototype(proto, name) {
  if (!proto || typeof proto !== 'object' || Array.isArray(proto)) throw new Error(`${name} must be an object`);
  if (typeof proto.type !== 'string' || !proto.type.trim()) throw new Error(`${name}.type required`);
  if (!Array.isArray(proto.instructions)) throw new Error(`${name}.instructions must be an array`);
  if (!Array.isArray(proto.targetLabels)) throw new Error(`${name}.targetLabels must be an array`);
}

function validateModel(model) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) throw new Error('offline baseline model object required');
  if (model.kind !== 'offline-semantic-prototype-baseline') throw new Error(`unsupported offline baseline model kind: ${model.kind || '<missing>'}`);
  if (!Array.isArray(model.actionPrototypes) || model.actionPrototypes.length === 0) throw new Error('offline baseline model requires actionPrototypes');
  for (const [index, proto] of model.actionPrototypes.entries()) validatePrototype(proto, `actionPrototypes[${index}]`);
  if (model.historyPrototypes != null) {
    if (!Array.isArray(model.historyPrototypes)) throw new Error('historyPrototypes must be an array');
    for (const [index, proto] of model.historyPrototypes.entries()) {
      validatePrototype(proto, `historyPrototypes[${index}]`);
      if (!Array.isArray(proto.priorActionTypes)) throw new Error(`historyPrototypes[${index}].priorActionTypes must be an array`);
      for (const [historyIndex, actionType] of proto.priorActionTypes.entries()) {
        if (typeof actionType !== 'string' || !actionType.trim()) {
          throw new Error(`historyPrototypes[${index}].priorActionTypes[${historyIndex}] required`);
        }
      }
    }
  }
  return model;
}

function scorePrototypes(prototypes, task) {
  const taskTokens = tokens(task?.instruction);
  return (prototypes || []).map(proto => {
    const instructionScore = bestSimilarity(taskTokens, proto.instructions);
    const targetLabelScore = bestSimilarity(taskTokens, proto.targetLabels);
    const score = (0.35 * instructionScore) + (0.65 * targetLabelScore);
    return { proto, score, instructionScore, targetLabelScore };
  }).sort((a, b) => (
    b.score - a.score ||
    b.targetLabelScore - a.targetLabelScore ||
    b.instructionScore - a.instructionScore ||
    a.proto.type.localeCompare(b.proto.type)
  ));
}

function choosePrototype(model, task, history = []) {
  const priorActionTypes = historyActionTypes(history);
  const historyMatches = (model.historyPrototypes || []).filter(proto =>
    sameActionHistory(proto.priorActionTypes, priorActionTypes)
  );
  const useHistory = historyMatches.length > 0;
  const candidates = useHistory ? historyMatches : model.actionPrototypes;
  const scored = scorePrototypes(candidates, task);
  const chosen = scored[0] || null;
  return chosen ? {
    ...chosen,
    historyMatched: useHistory,
    priorActionTypes,
    prototypeSource: useHistory ? 'historyPrototypes' : 'actionPrototypes'
  } : null;
}

function chooseTargetRef(proto, task, observation) {
  const elements = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  if (!elements.length || !(proto?.targetLabels || []).length) return null;
  const taskTokens = tokens(task?.instruction);
  const candidates = elements
    .filter(el => typeof el?.ref === 'string' && el.ref.trim() && typeof el?.label === 'string' && el.label.trim())
    .map(el => {
      const labelTokens = tokens(el.label);
      const prototypeLabelScore = Math.max(...proto.targetLabels.map(label => jaccard(labelTokens, tokens(label))));
      const taskLabelScore = jaccard(taskTokens, labelTokens);
      return {
        ref: el.ref.trim(),
        score: (0.75 * prototypeLabelScore) + (0.25 * taskLabelScore),
        prototypeLabelScore,
        taskLabelScore
      };
    })
    .sort((a, b) => (
      b.score - a.score ||
      b.prototypeLabelScore - a.prototypeLabelScore ||
      b.taskLabelScore - a.taskLabelScore ||
      a.ref.localeCompare(b.ref)
    ));
  return candidates[0]?.ref || null;
}

function createOfflineBaselineProvider(options = {}) {
  const model = validateModel(options.model);
  const minimumConfidence = Number.isFinite(Number(options.minimumConfidence))
    ? Math.max(0, Math.min(1, Number(options.minimumConfidence)))
    : 0;

  return {
    name: 'offline-semantic-prototype-baseline',
    version: String(model.modelVersion || '0.1.0'),

    async decide({ task, observation, history = [] }) {
      const chosen = choosePrototype(model, task, history);
      if (!chosen) {
        return {
          status: 'blocked',
          confidence: 0,
          reasonCode: 'offline_baseline_no_prototype',
          recovery: { suggested: 'provider_upgrade_required' }
        };
      }

      if (chosen.score < minimumConfidence) {
        return {
          status: 'blocked',
          confidence: chosen.score,
          reasonCode: 'offline_baseline_confidence_below_threshold',
          recovery: { suggested: 'reobserve_or_human_review' },
          metadata: {
            modelVersion: model.modelVersion || null,
            prototypeType: chosen.proto.type,
            instructionScore: chosen.instructionScore,
            targetLabelScore: chosen.targetLabelScore,
            historyMatched: chosen.historyMatched,
            priorActionTypes: chosen.priorActionTypes,
            prototypeSource: chosen.prototypeSource
          }
        };
      }

      const targetRef = chooseTargetRef(chosen.proto, task, observation);
      let action;
      try {
        action = validateAgentAction({
          contractVersion: '0.1.0',
          type: chosen.proto.type,
          targetRef,
          args: {},
          intent: `offline-baseline:${chosen.proto.type}`,
          expectedOutcome: {}
        });
      } catch (error) {
        return {
          status: 'blocked',
          confidence: chosen.score,
          reasonCode: 'offline_baseline_target_not_found',
          recovery: { suggested: 'reobserve' },
          metadata: {
            modelVersion: model.modelVersion || null,
            prototypeType: chosen.proto.type,
            historyMatched: chosen.historyMatched,
            priorActionTypes: chosen.priorActionTypes,
            prototypeSource: chosen.prototypeSource,
            error: String(error?.message || error)
          }
        };
      }

      return {
        status: 'act',
        action,
        targetRef: action.targetRef,
        confidence: chosen.score,
        reasonCode: 'offline_baseline_prototype_match',
        expectedOutcome: action.expectedOutcome || {},
        recovery: {},
        metadata: {
          modelVersion: model.modelVersion || null,
          instructionScore: chosen.instructionScore,
          targetLabelScore: chosen.targetLabelScore,
          historyMatched: chosen.historyMatched,
          priorActionTypes: chosen.priorActionTypes,
          prototypeSource: chosen.prototypeSource
        }
      };
    }
  };
}

module.exports = {
  tokens,
  jaccard,
  bestSimilarity,
  historyActionTypes,
  sameActionHistory,
  validateModel,
  scorePrototypes,
  choosePrototype,
  chooseTargetRef,
  createOfflineBaselineProvider
};
