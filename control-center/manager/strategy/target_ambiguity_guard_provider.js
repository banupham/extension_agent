'use strict';

const { actionTargetEligible, historyLastTargetRef } = require('./offline_baseline_provider.js');

const TARGET_AMBIGUITY_GUARD_VERSION = '0.1.0';

function normalizeSemanticLabel(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

function selectedElement(decision, observation) {
  const ref = String(decision?.action?.targetRef || decision?.targetRef || '').trim();
  if (!ref) return null;
  const elements = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  return elements.find(element => String(element?.ref || '').trim() === ref) || null;
}

function ambiguousMatches(decision, observation) {
  const action = decision?.action || null;
  const selected = selectedElement(decision, observation);
  if (!action || !selected) return [];
  const label = normalizeSemanticLabel(selected?.label);
  if (!label) return [];
  const elements = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  return elements.filter(element =>
    typeof element?.ref === 'string' && element.ref.trim() &&
    actionTargetEligible({ type: action.type }, element) &&
    normalizeSemanticLabel(element?.label) === label
  );
}

function createTargetAmbiguityGuardProvider(options = {}) {
  const baseProvider = options.baseProvider;
  if (!baseProvider || typeof baseProvider.decide !== 'function') {
    throw new Error('target_ambiguity_guard_base_provider_required');
  }

  return {
    name: `target-ambiguity-guard+${baseProvider.name || 'provider'}`,
    version: baseProvider.version || 'unknown',

    async decide(context = {}) {
      const decision = await baseProvider.decide(context);
      if (decision?.status !== 'act' || !decision?.action?.targetRef) return decision;

      const matches = ambiguousMatches(decision, context.observation);
      if (matches.length <= 1) return decision;

      const previousRef = historyLastTargetRef(context.history || []);
      const selectedRef = String(decision.action.targetRef || '').trim();
      if (previousRef && selectedRef === previousRef) {
        return {
          ...decision,
          metadata: {
            ...(decision.metadata || {}),
            targetAmbiguityGuardVersion: TARGET_AMBIGUITY_GUARD_VERSION,
            duplicateSemanticTargetCount: matches.length,
            ambiguityAllowedByTargetContinuity: true
          }
        };
      }

      return {
        status: 'blocked',
        confidence: decision.confidence ?? 0,
        reasonCode: 'target_ambiguous_multiple_matches',
        expectedOutcome: {},
        recovery: { suggested: 'request_disambiguation_or_human_review' },
        metadata: {
          ...(decision.metadata || {}),
          targetAmbiguityGuardVersion: TARGET_AMBIGUITY_GUARD_VERSION,
          duplicateSemanticTargetCount: matches.length,
          ambiguousTargetLabel: String(selectedElement(decision, context.observation)?.label || ''),
          proposedActionType: decision.action.type,
          proposedTargetRef: selectedRef,
          ambiguityAllowedByTargetContinuity: false
        }
      };
    }
  };
}

module.exports = {
  TARGET_AMBIGUITY_GUARD_VERSION,
  normalizeSemanticLabel,
  selectedElement,
  ambiguousMatches,
  createTargetAmbiguityGuardProvider
};
