'use strict';

const { validateAgentAction } = require('./agent_action_contract.js');

function tokenList(value) {
  return (String(value || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter(Boolean);
}

function tokens(value) {
  return new Set(tokenList(value));
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

function isSequencePrefix(prefix, sequence) {
  if (!Array.isArray(prefix) || !Array.isArray(sequence) || prefix.length > sequence.length) return false;
  return prefix.every((value, index) => value === sequence[index]);
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

function tokenRelated(taskToken, anchorToken) {
  if (taskToken === anchorToken) return true;
  if (taskToken.length < 4 || anchorToken.length < 4) return false;
  return taskToken.startsWith(anchorToken) || anchorToken.startsWith(taskToken);
}

function prototypeAnchorTokens(model) {
  const prototypes = Array.isArray(model?.actionPrototypes) ? model.actionPrototypes : [];
  const tokenSets = prototypes.map(proto => {
    const set = new Set(tokenList(proto.type));
    for (const label of proto.targetLabels || []) {
      for (const token of tokenList(label)) set.add(token);
    }
    return { proto, set };
  });
  const frequency = new Map();
  for (const item of tokenSets) {
    for (const token of item.set) frequency.set(token, Number(frequency.get(token) || 0) + 1);
  }
  return tokenSets.map(item => {
    const typeTokens = new Set(tokenList(item.proto.type));
    const anchors = [...item.set].filter(token =>
      token.length >= 3 && (typeTokens.has(token) || frequency.get(token) === 1)
    );
    return { type: item.proto.type, anchors };
  });
}

function inferCompositionalSequence(model, task) {
  const taskTokens = tokenList(task?.instruction);
  if (!taskTokens.length) return [];
  const mentions = [];
  for (const item of prototypeAnchorTokens(model)) {
    let firstIndex = -1;
    for (let i = 0; i < taskTokens.length && firstIndex < 0; i += 1) {
      if (item.anchors.some(anchor => tokenRelated(taskTokens[i], anchor))) firstIndex = i;
    }
    if (firstIndex >= 0) mentions.push({ type: item.type, index: firstIndex });
  }
  return mentions
    .sort((a, b) => a.index - b.index || a.type.localeCompare(b.type))
    .map(item => item.type);
}

function compositionalChoice(model, task, history = []) {
  const sequence = inferCompositionalSequence(model, task);
  const priorActionTypes = historyActionTypes(history);
  if (sequence.length < 2 || !isSequencePrefix(priorActionTypes, sequence) || priorActionTypes.length >= sequence.length) return null;
  const nextType = sequence[priorActionTypes.length];
  const proto = (model.actionPrototypes || []).find(item => item.type === nextType) || null;
  if (!proto) return null;
  const scored = scorePrototypes([proto], task)[0];
  return scored ? {
    ...scored,
    historyMatched: false,
    compositionMatched: true,
    compositionSequence: sequence,
    priorActionTypes,
    prototypeSource: 'taskComposition'
  } : null;
}

function choosePrototype(model, task, history = []) {
  const priorActionTypes = historyActionTypes(history);
  const historyMatches = (model.historyPrototypes || []).filter(proto =>
    sameActionHistory(proto.priorActionTypes, priorActionTypes)
  );
  const historyScored = scorePrototypes(historyMatches, task);
  const historyChosen = historyScored[0] || null;
  const composition = compositionalChoice(model, task, history);

  if (composition && (!historyChosen || historyChosen.proto.type !== composition.proto.type)) {
    return composition;
  }

  if (historyChosen) {
    return {
      ...historyChosen,
      historyMatched: true,
      compositionMatched: false,
      compositionSequence: composition?.compositionSequence || [],
      priorActionTypes,
      prototypeSource: 'historyPrototypes'
    };
  }

  if (composition) return composition;

  const scored = scorePrototypes(model.actionPrototypes, task);
  const chosen = scored[0] || null;
  return chosen ? {
    ...chosen,
    historyMatched: false,
    compositionMatched: false,
    compositionSequence: [],
    priorActionTypes,
    prototypeSource: 'actionPrototypes'
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

function decisionMetadata(model, chosen) {
  return {
    modelVersion: model.modelVersion || null,
    prototypeType: chosen.proto.type,
    instructionScore: chosen.instructionScore,
    targetLabelScore: chosen.targetLabelScore,
    historyMatched: chosen.historyMatched,
    compositionMatched: chosen.compositionMatched === true,
    compositionSequence: chosen.compositionSequence || [],
    priorActionTypes: chosen.priorActionTypes,
    prototypeSource: chosen.prototypeSource
  };
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
          metadata: decisionMetadata(model, chosen)
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
            ...decisionMetadata(model, chosen),
            error: String(error?.message || error)
          }
        };
      }

      return {
        status: 'act',
        action,
        targetRef: action.targetRef,
        confidence: chosen.score,
        reasonCode: chosen.compositionMatched ? 'offline_baseline_task_composition' : 'offline_baseline_prototype_match',
        expectedOutcome: action.expectedOutcome || {},
        recovery: {},
        metadata: decisionMetadata(model, chosen)
      };
    }
  };
}

module.exports = {
  tokenList,
  tokens,
  jaccard,
  bestSimilarity,
  historyActionTypes,
  sameActionHistory,
  isSequencePrefix,
  validateModel,
  scorePrototypes,
  tokenRelated,
  prototypeAnchorTokens,
  inferCompositionalSequence,
  compositionalChoice,
  choosePrototype,
  chooseTargetRef,
  createOfflineBaselineProvider
};