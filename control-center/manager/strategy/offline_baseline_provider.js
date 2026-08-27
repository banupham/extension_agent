'use strict';

const { validateAgentAction } = require('./agent_action_contract.js');

const TASK_FEATURE_NAMES = [
  'textEntryIntent',
  'submitIntent',
  'enterIntent',
  'clickIntent'
];

function normalizeText(value) {
  return String(value || '')
    .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

function tokenList(value) {
  return normalizeText(value).match(/[\p{L}\p{N}]+/gu) || [];
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

function hasAny(words, candidates) {
  return candidates.some(candidate => words.has(candidate));
}

function taskSemanticFeatures(task) {
  const instruction = String(task?.instruction || '');
  const original = instruction.normalize('NFKC').toLowerCase();
  const words = new Set(tokenList(instruction));
  const normalized = ` ${normalizeText(instruction).replace(/\s+/g, ' ').trim()} `;
  const enterIntent = /\b(?:press|hit)\s+enter\b/.test(normalized) ||
    /(?:nhấn|bấm|ấn)\s+enter/u.test(original);
  const textEntryIntent = hasAny(words, ['type', 'fill', 'write']) ||
    original.includes('nhập') || original.includes('gõ') ||
    /\benter\b.+\b(?:into|in)\b/.test(normalized);
  const submitIntent = enterIntent || hasAny(words, ['submit', 'search', 'send', 'confirm']) ||
    ['gửi', 'tìm', 'nộp', 'xác nhận'].some(phrase => original.includes(phrase));
  const clickIntent = hasAny(words, ['click', 'tap', 'open', 'choose', 'select']) ||
    original.includes('nhấp') || original.includes('mở') || original.includes('chọn') ||
    (/bấm\s+/u.test(original) && !/bấm\s+enter/u.test(original));
  return { textEntryIntent, submitIntent, enterIntent, clickIntent };
}

function taskFeatureScore(proto, task) {
  const current = taskSemanticFeatures(task);
  const learned = proto?.taskFeatures || {};
  const active = TASK_FEATURE_NAMES.filter(name => current[name] === true);
  if (!active.length) return 0.5;
  let total = 0;
  for (const name of active) {
    const value = Number(learned[name]);
    total += Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  }
  return total / active.length;
}

function historyActionTypes(history) {
  return (Array.isArray(history) ? history : [])
    .map(item => String(item?.actionType || item?.action?.type || '').trim())
    .filter(Boolean);
}

function historyLastTargetRef(history) {
  const items = Array.isArray(history) ? history : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const ref = items[index]?.targetRef || items[index]?.action?.targetRef;
    if (typeof ref === 'string' && ref.trim()) return ref.trim();
  }
  return null;
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
  if (proto.targetTraits != null) {
    if (!proto.targetTraits || typeof proto.targetTraits !== 'object' || Array.isArray(proto.targetTraits)) {
      throw new Error(`${name}.targetTraits must be an object`);
    }
    for (const key of ['roles', 'tags']) {
      if (proto.targetTraits[key] != null && !Array.isArray(proto.targetTraits[key])) {
        throw new Error(`${name}.targetTraits.${key} must be an array`);
      }
    }
  }
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

function normalizedElementTag(element) {
  return String(element?.tag || element?.tagName || '').trim().toLowerCase();
}

function normalizedElementRole(element) {
  return String(element?.role || '').trim().toLowerCase();
}

function elementAvailable(element) {
  return element?.visible !== false && element?.rendered !== false && element?.enabled !== false;
}

function targetTraitScore(proto, element) {
  const traits = proto?.targetTraits;
  if (!traits || typeof traits !== 'object') return 0.5;
  const parts = [];
  const roles = Array.isArray(traits.roles) ? traits.roles.map(value => String(value).toLowerCase()) : [];
  const tags = Array.isArray(traits.tags) ? traits.tags.map(value => String(value).toLowerCase()) : [];
  const role = normalizedElementRole(element);
  const tag = normalizedElementTag(element);
  if (roles.length && role) parts.push(roles.includes(role) ? 1 : 0);
  if (tags.length && tag) parts.push(tags.includes(tag) ? 1 : 0);
  const editableKnown = Number(traits.editableKnown || 0);
  const editableRate = Number(traits.editableRate);
  if (editableKnown > 0 && Number.isFinite(editableRate) && typeof element?.editable === 'boolean') {
    parts.push(1 - Math.abs(Math.max(0, Math.min(1, editableRate)) - (element.editable ? 1 : 0)));
  }
  return parts.length ? parts.reduce((sum, value) => sum + value, 0) / parts.length : 0.5;
}

function elementTargetCompatibility(proto, task, element) {
  if (!elementAvailable(element)) return { score: 0, prototypeLabelScore: 0, taskLabelScore: 0, traitScore: 0 };
  const label = String(element?.label || '').trim();
  const labelTokens = tokens(label);
  const taskTokens = tokens(task?.instruction);
  const prototypeLabelScore = label
    ? bestSimilarity(labelTokens, proto?.targetLabels || [])
    : 0;
  const taskLabelScore = label ? jaccard(taskTokens, labelTokens) : 0;
  const traitScore = targetTraitScore(proto, element);
  const hasTraits = proto?.targetTraits && typeof proto.targetTraits === 'object';
  const score = hasTraits
    ? (0.45 * taskLabelScore) + (0.20 * prototypeLabelScore) + (0.35 * traitScore)
    : (0.75 * prototypeLabelScore) + (0.25 * taskLabelScore);
  return { score, prototypeLabelScore, taskLabelScore, traitScore };
}

function bestTargetCompatibility(proto, task, observation) {
  const elements = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  let best = 0;
  for (const element of elements) {
    const result = elementTargetCompatibility(proto, task, element);
    best = Math.max(best, Number(result?.score || 0));
  }
  return best;
}

function scorePrototypes(prototypes, task, observation = null) {
  const taskTokens = tokens(task?.instruction);
  return (prototypes || []).map(proto => {
    const instructionScore = bestSimilarity(taskTokens, proto.instructions);
    const targetLabelScore = bestSimilarity(taskTokens, proto.targetLabels);
    const featureScore = taskFeatureScore(proto, task);
    const semanticTargetScore = observation ? bestTargetCompatibility(proto, task, observation) : 0.5;
    const score = (0.12 * instructionScore) +
      (0.08 * targetLabelScore) +
      (0.45 * featureScore) +
      (0.35 * semanticTargetScore);
    return { proto, score, instructionScore, targetLabelScore, featureScore, semanticTargetScore };
  }).sort((a, b) => (
    b.score - a.score ||
    b.featureScore - a.featureScore ||
    b.semanticTargetScore - a.semanticTargetScore ||
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

function compositionalChoice(model, task, observationOrHistory = null, maybeHistory = []) {
  const observation = Array.isArray(observationOrHistory) ? null : observationOrHistory;
  const history = Array.isArray(observationOrHistory) ? observationOrHistory : maybeHistory;
  const sequence = inferCompositionalSequence(model, task);
  const priorActionTypes = historyActionTypes(history);
  if (sequence.length < 2 || !isSequencePrefix(priorActionTypes, sequence) || priorActionTypes.length >= sequence.length) return null;
  const nextType = sequence[priorActionTypes.length];
  const proto = (model.actionPrototypes || []).find(item => item.type === nextType) || null;
  if (!proto) return null;
  const scored = scorePrototypes([proto], task, observation)[0];
  return scored ? {
    ...scored,
    historyMatched: false,
    compositionMatched: true,
    compositionSequence: sequence,
    priorActionTypes,
    prototypeSource: 'taskComposition'
  } : null;
}

function choosePrototype(model, task, observationOrHistory = null, maybeHistory = []) {
  const observation = Array.isArray(observationOrHistory) ? null : observationOrHistory;
  const history = Array.isArray(observationOrHistory) ? observationOrHistory : maybeHistory;
  const priorActionTypes = historyActionTypes(history);
  const historyMatches = (model.historyPrototypes || []).filter(proto =>
    sameActionHistory(proto.priorActionTypes, priorActionTypes)
  );
  const historyScored = scorePrototypes(historyMatches, task, observation);
  const historyChosen = historyScored[0] || null;
  const composition = compositionalChoice(model, task, observation, history);

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

  const scored = scorePrototypes(model.actionPrototypes, task, observation);
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

function shouldReusePreviousTarget(proto) {
  const continuity = proto?.targetContinuity || {};
  const known = Number(continuity.known || 0);
  const rate = Number(continuity.sameAsPreviousRate);
  return known > 0 && Number.isFinite(rate) && rate >= 0.75;
}

function chooseTargetRef(proto, task, observation, history = []) {
  const elements = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  if (!elements.length) return null;

  if (shouldReusePreviousTarget(proto)) {
    const previousRef = historyLastTargetRef(history);
    if (previousRef) {
      const previous = elements.find(element => element?.ref === previousRef && elementAvailable(element));
      if (previous) return previousRef;
    }
  }

  const candidates = elements
    .filter(element => typeof element?.ref === 'string' && element.ref.trim() && elementAvailable(element))
    .map(element => {
      const compatibility = elementTargetCompatibility(proto, task, element);
      return {
        ref: element.ref.trim(),
        ...compatibility
      };
    })
    .sort((a, b) => (
      b.score - a.score ||
      b.traitScore - a.traitScore ||
      b.taskLabelScore - a.taskLabelScore ||
      b.prototypeLabelScore - a.prototypeLabelScore ||
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
    taskFeatureScore: chosen.featureScore,
    semanticTargetScore: chosen.semanticTargetScore,
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
      const chosen = choosePrototype(model, task, observation, history);
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

      const targetRef = chooseTargetRef(chosen.proto, task, observation, history);
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
  TASK_FEATURE_NAMES,
  normalizeText,
  tokenList,
  tokens,
  jaccard,
  bestSimilarity,
  taskSemanticFeatures,
  taskFeatureScore,
  historyActionTypes,
  historyLastTargetRef,
  sameActionHistory,
  isSequencePrefix,
  validateModel,
  normalizedElementTag,
  normalizedElementRole,
  elementAvailable,
  targetTraitScore,
  elementTargetCompatibility,
  bestTargetCompatibility,
  scorePrototypes,
  tokenRelated,
  prototypeAnchorTokens,
  inferCompositionalSequence,
  compositionalChoice,
  choosePrototype,
  shouldReusePreviousTarget,
  chooseTargetRef,
  createOfflineBaselineProvider
};
