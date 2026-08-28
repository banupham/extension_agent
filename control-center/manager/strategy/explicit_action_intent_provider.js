'use strict';

const { validateAgentAction } = require('./agent_action_contract.js');
const {
  scorePrototypes,
  chooseTargetRef,
  historyActionTypes,
  sameActionHistory
} = require('./offline_baseline_provider.js');

const EXPLICIT_ACTION_INTENT_VERSION = '0.1.0';

function normalizeInstruction(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase();
}

function explicitActionType(task, history = []) {
  const prior = historyActionTypes(history);
  if (prior.length) return null;

  const text = normalizeInstruction(task?.instruction);
  if (!text) return null;

  if (/^(?:please\s+)?(?:press|hit)\s+enter\b/u.test(text) || /^(?:hãy\s+)?(?:nhấn|bấm|ấn)\s+enter\b/u.test(text)) {
    return 'submit';
  }
  if (/^(?:please\s+)?(?:click|tap)\b/u.test(text) || /^(?:hãy\s+)?(?:nhấp|bấm)\b/u.test(text)) {
    return 'click';
  }
  if (/^(?:please\s+)?(?:type|fill|write)\b/u.test(text) || /^(?:hãy\s+)?(?:nhập|gõ)\b/u.test(text)) {
    return 'typeText';
  }
  if (/^(?:please\s+)?(?:submit|send)\b/u.test(text) || /^(?:hãy\s+)?(?:gửi|nộp)\b/u.test(text)) {
    return 'submit';
  }
  return null;
}

function candidateSource(model, type, history = []) {
  const prior = historyActionTypes(history);
  const historyCandidates = (model?.historyPrototypes || []).filter(proto =>
    proto?.type === type && sameActionHistory(proto?.priorActionTypes || [], prior)
  );
  if (historyCandidates.length) return { prototypes: historyCandidates, source: 'historyPrototypes' };

  const actionCandidates = (model?.actionPrototypes || []).filter(proto => proto?.type === type);
  return { prototypes: actionCandidates, source: 'actionPrototypes' };
}

function explicitDecisionMetadata(model, chosen, source, explicitType) {
  return {
    modelVersion: model?.modelVersion || null,
    prototypeType: chosen?.proto?.type || null,
    instructionScore: chosen?.instructionScore ?? null,
    targetLabelScore: chosen?.targetLabelScore ?? null,
    taskFeatureScore: chosen?.featureScore ?? null,
    semanticTargetScore: chosen?.semanticTargetScore ?? null,
    actionSelectionTargetIndependent: true,
    historyMatched: source === 'historyPrototypes',
    compositionMatched: false,
    compositionSequence: [],
    priorActionTypes: [],
    prototypeSource: source,
    explicitActionIntent: true,
    explicitActionType: explicitType,
    explicitActionIntentVersion: EXPLICIT_ACTION_INTENT_VERSION
  };
}

function createExplicitActionIntentProvider(options = {}) {
  const baseProvider = options.baseProvider;
  const model = options.model;
  if (!baseProvider || typeof baseProvider.decide !== 'function') throw new Error('explicit_action_intent_base_provider_required');
  if (!model || typeof model !== 'object') throw new Error('explicit_action_intent_model_required');

  const minimumConfidence = Number.isFinite(Number(options.minimumConfidence))
    ? Math.max(0, Math.min(1, Number(options.minimumConfidence)))
    : 0;

  return {
    name: `explicit-action-intent+${baseProvider.name || 'provider'}`,
    version: baseProvider.version || String(model.modelVersion || 'unknown'),

    async decide(context = {}) {
      const explicitType = explicitActionType(context.task, context.history || []);
      const baseDecision = await baseProvider.decide(context);
      if (!explicitType) return baseDecision;

      if (baseDecision?.status === 'act' && baseDecision?.action?.type === explicitType) {
        return {
          ...baseDecision,
          metadata: {
            ...(baseDecision.metadata || {}),
            explicitActionIntent: true,
            explicitActionType: explicitType,
            explicitActionIntentVersion: EXPLICIT_ACTION_INTENT_VERSION
          }
        };
      }

      const selected = candidateSource(model, explicitType, context.history || []);
      const chosen = scorePrototypes(selected.prototypes, context.task, context.observation)[0] || null;
      if (!chosen) return baseDecision;

      const metadata = explicitDecisionMetadata(model, chosen, selected.source, explicitType);
      if (chosen.score < minimumConfidence) {
        return {
          status: 'blocked',
          confidence: chosen.score,
          reasonCode: 'offline_baseline_confidence_below_threshold',
          recovery: { suggested: 'reobserve_or_human_review' },
          metadata
        };
      }

      const targetRef = chooseTargetRef(chosen.proto, context.task, context.observation, context.history || []);
      let action;
      try {
        action = validateAgentAction({
          contractVersion: '0.1.0',
          type: explicitType,
          targetRef,
          args: {},
          intent: `offline-baseline:${explicitType}`,
          expectedOutcome: {}
        });
      } catch (error) {
        return {
          status: 'blocked',
          confidence: chosen.score,
          reasonCode: 'offline_baseline_target_not_found',
          recovery: { suggested: 'reobserve' },
          metadata: { ...metadata, error: String(error?.message || error) }
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
        metadata
      };
    }
  };
}

module.exports = {
  EXPLICIT_ACTION_INTENT_VERSION,
  normalizeInstruction,
  explicitActionType,
  candidateSource,
  explicitDecisionMetadata,
  createExplicitActionIntentProvider
};
