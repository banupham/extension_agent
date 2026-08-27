'use strict';

const crypto = require('crypto');
const {
  validateAgentAction
} = require('./agent_action_contract.js');
const {
  tokens,
  jaccard
} = require('./offline_baseline_provider.js');
const {
  normalizeInstruction,
  targetLabelForStep,
  assertNoForbiddenKeys
} = require('./self_experience_memory.js');

const RECOVERY_POLICY_VERSION = '0.1.0';
const RECOVERY_POLICY_KIND = 'strategy-recovery-policy';

// Recovery is semantic. v0.1 intentionally learns only actions that do not require
// storing task payloads such as typed text, URLs, coordinates, selectors, or CDP.
const RECOVERY_ACTION_TYPES = new Set([
  'click', 'doubleClick', 'hover', 'moveTo', 'scrollVertical', 'scrollHorizontal',
  'scrollIntoView', 'focus', 'toggle', 'submit', 'play', 'pause', 'mute', 'unmute',
  'waitAndObserve', 'dismiss', 'reload', 'back', 'forward'
]);
const RECOVERY_TARGET_REQUIRED = new Set([
  'click', 'doubleClick', 'hover', 'moveTo', 'scrollIntoView', 'focus',
  'toggle', 'submit', 'play', 'pause', 'mute', 'unmute', 'dismiss'
]);
const RECOVERY_TRIGGER_EFFECTS = new Set(['no_effect', 'execution_failed']);

function normalizeCodes(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(Boolean))].sort();
}

function stepEffect(step) {
  const explicit = step?.effect && typeof step.effect === 'object' ? step.effect : null;
  return {
    status: String(explicit?.status || step?.outcome?.metadata?.actionEffectStatus || '').trim() || null,
    codes: normalizeCodes(explicit?.codes || step?.outcome?.metadata?.actionEffectCodes)
  };
}

function isRecoveryTriggerStep(step) {
  const effect = stepEffect(step);
  return step?.control?.status === 'failed' || RECOVERY_TRIGGER_EFFECTS.has(effect.status);
}

function isUsefulRecoveryStep(step) {
  const effect = stepEffect(step);
  const progressDelta = Number(step?.outcome?.metadata?.progressDelta || 0);
  return step?.outcome?.taskSucceeded === true || progressDelta > 0 || effect.status === 'effect_observed';
}

function validateRecoveryRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('recovery_policy_record_required');
  if (record.memoryVersion !== RECOVERY_POLICY_VERSION) throw new Error('recovery_policy_version_unsupported');
  if (record.kind !== RECOVERY_POLICY_KIND) throw new Error('recovery_policy_kind_invalid');
  if (record.source !== 'agent-self-experience') throw new Error('recovery_policy_source_invalid');
  if (typeof record.recoveryId !== 'string' || !record.recoveryId.trim()) throw new Error('recovery_policy_id_required');
  if (typeof record?.task?.instruction !== 'string' || !record.task.instruction.trim()) throw new Error('recovery_policy_task_required');

  const trigger = record.trigger;
  if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) throw new Error('recovery_policy_trigger_required');
  const triggerActionType = String(trigger.actionType || '').trim();
  if (!triggerActionType) throw new Error('recovery_policy_trigger_action_required');
  if (typeof trigger.controlStatus !== 'string' || !trigger.controlStatus.trim()) throw new Error('recovery_policy_trigger_control_required');
  if (typeof trigger.reasonCode !== 'string' || !trigger.reasonCode.trim()) throw new Error('recovery_policy_trigger_reason_required');
  if (trigger.effectStatus != null && typeof trigger.effectStatus !== 'string') throw new Error('recovery_policy_trigger_effect_invalid');
  if (!Array.isArray(trigger.effectCodes)) throw new Error('recovery_policy_trigger_codes_required');

  const recovery = record.recovery;
  if (!recovery || typeof recovery !== 'object' || Array.isArray(recovery)) throw new Error('recovery_policy_action_required');
  const recoveryType = String(recovery.type || '').trim();
  if (!RECOVERY_ACTION_TYPES.has(recoveryType)) throw new Error(`recovery_policy_action_unsupported:${recoveryType || '<empty>'}`);
  const targetLabel = typeof recovery.targetLabel === 'string' && recovery.targetLabel.trim()
    ? recovery.targetLabel.trim()
    : null;
  if (RECOVERY_TARGET_REQUIRED.has(recoveryType) && !targetLabel) throw new Error('recovery_policy_target_label_required');
  if (!RECOVERY_TARGET_REQUIRED.has(recoveryType) && targetLabel) throw new Error('recovery_policy_target_label_not_allowed');

  if (record?.verification?.sourceEpisodeSucceeded !== true) throw new Error('recovery_policy_source_episode_not_successful');
  if (record?.verification?.privacyRedacted !== true) throw new Error('recovery_policy_privacy_not_verified');
  assertNoForbiddenKeys(record);
  return record;
}

function recoveryFingerprint(record) {
  return crypto.createHash('sha256').update(JSON.stringify({
    task: normalizeInstruction(record?.task?.instruction),
    trigger: {
      actionType: record?.trigger?.actionType,
      targetLabel: normalizeInstruction(record?.trigger?.targetLabel),
      controlStatus: record?.trigger?.controlStatus,
      reasonCode: record?.trigger?.reasonCode,
      effectStatus: record?.trigger?.effectStatus,
      effectCodes: normalizeCodes(record?.trigger?.effectCodes)
    },
    recovery: {
      type: record?.recovery?.type,
      targetLabel: normalizeInstruction(record?.recovery?.targetLabel)
    }
  })).digest('hex');
}

function buildRecoveryRecords({ task, result, learnedAt = new Date().toISOString() } = {}) {
  if (!task || typeof task.instruction !== 'string' || !task.instruction.trim()) throw new Error('recovery_policy_task_required');
  if (!result || typeof result !== 'object') throw new Error('recovery_policy_result_required');
  if (result?.finalOutcome?.taskSucceeded !== true) throw new Error('recovery_policy_requires_successful_episode');
  if (result?.finalBudget?.terminal !== true || result?.finalBudget?.reasonCode !== 'goal_satisfied') {
    throw new Error('recovery_policy_requires_goal_satisfied_budget');
  }

  const steps = Array.isArray(result.steps) ? result.steps : [];
  const records = [];
  for (let index = 0; index + 1 < steps.length; index += 1) {
    const triggerStep = steps[index];
    const nextStep = steps[index + 1];
    if (!isRecoveryTriggerStep(triggerStep) || !isUsefulRecoveryStep(nextStep)) continue;

    const triggerAction = validateAgentAction(triggerStep?.action || triggerStep?.decision?.action || null);
    const recoveryAction = validateAgentAction(nextStep?.action || nextStep?.decision?.action || null);
    if (!RECOVERY_ACTION_TYPES.has(recoveryAction.type)) continue;

    const triggerEffect = stepEffect(triggerStep);
    const triggerTargetLabel = targetLabelForStep(triggerStep);
    const recoveryTargetLabel = RECOVERY_TARGET_REQUIRED.has(recoveryAction.type)
      ? targetLabelForStep(nextStep)
      : null;
    if (RECOVERY_TARGET_REQUIRED.has(recoveryAction.type) && !recoveryTargetLabel) continue;

    const base = {
      memoryVersion: RECOVERY_POLICY_VERSION,
      kind: RECOVERY_POLICY_KIND,
      source: 'agent-self-experience',
      learnedAt,
      task: { instruction: task.instruction.trim() },
      trigger: {
        actionType: triggerAction.type,
        targetLabel: triggerTargetLabel,
        controlStatus: String(triggerStep?.control?.status || 'failed'),
        reasonCode: String(triggerStep?.control?.reasonCode || triggerStep?.outcome?.errorCode || 'unspecified'),
        effectStatus: triggerEffect.status,
        effectCodes: triggerEffect.codes
      },
      recovery: {
        type: recoveryAction.type,
        targetLabel: recoveryTargetLabel
      },
      verification: {
        sourceEpisodeSucceeded: true,
        recoveryStepHadUsefulEffect: true,
        privacyRedacted: true,
        selectorsStored: false,
        rawCoordinatesStored: false,
        observationLocalRefsStored: false,
        privateReasoningStored: false,
        taskPayloadArgsStored: false
      }
    };
    const recoveryId = `recovery-${recoveryFingerprint(base).slice(0, 20)}`;
    records.push(validateRecoveryRecord({ ...base, recoveryId }));
  }
  return records;
}

function triggerFromHistory(history = []) {
  const last = Array.isArray(history) && history.length ? history[history.length - 1] : null;
  if (!last) return null;
  const effectStatus = String(last.effectStatus || '').trim() || null;
  if (last.controlStatus !== 'failed' && !RECOVERY_TRIGGER_EFFECTS.has(effectStatus)) return null;
  return {
    actionType: String(last.actionType || '').trim(),
    targetLabel: typeof last.actionTargetLabel === 'string' ? last.actionTargetLabel.trim() : null,
    controlStatus: String(last.controlStatus || '').trim(),
    reasonCode: String(last.reasonCode || '').trim(),
    effectStatus,
    effectCodes: normalizeCodes(last.effectCodes)
  };
}

function labelSimilarity(a, b) {
  const aa = normalizeInstruction(a);
  const bb = normalizeInstruction(b);
  if (!aa && !bb) return 1;
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;
  return jaccard(tokens(aa), tokens(bb));
}

function recoveryScore(record, task, trigger) {
  if (!trigger?.actionType || trigger.actionType !== record.trigger.actionType) return -1;
  const taskScore = jaccard(tokens(task?.instruction), tokens(record.task.instruction));
  const effectScore = jaccard(new Set(trigger.effectCodes), new Set(record.trigger.effectCodes));
  const targetScore = labelSimilarity(trigger.targetLabel, record.trigger.targetLabel);
  const statusScore = trigger.effectStatus && trigger.effectStatus === record.trigger.effectStatus ? 1 : 0;
  const reasonScore = trigger.reasonCode && trigger.reasonCode === record.trigger.reasonCode ? 1 : 0;
  return taskScore * 0.45 + effectScore * 0.2 + targetScore * 0.15 + statusScore * 0.1 + reasonScore * 0.1;
}

function selectRecovery(records, task, history = [], minimumScore = 0.55) {
  const trigger = triggerFromHistory(history);
  if (!trigger) return null;
  const candidates = (Array.isArray(records) ? records : [])
    .map(validateRecoveryRecord)
    .map(record => ({ record, score: recoveryScore(record, task, trigger) }))
    .filter(item => item.score >= minimumScore)
    .sort((a, b) => b.score - a.score || String(b.record.learnedAt || '').localeCompare(String(a.record.learnedAt || '')));
  const best = candidates[0] || null;
  return best ? { ...best, trigger } : null;
}

function targetRefForLabel(targetLabel, observation) {
  const label = normalizeInstruction(targetLabel);
  if (!label) return null;
  const elements = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  const exact = elements.filter(element =>
    typeof element?.ref === 'string' && element.ref.trim() &&
    normalizeInstruction(element?.label) === label &&
    element.visible !== false && element.enabled !== false
  );
  if (exact.length === 1) return exact[0].ref.trim();

  const ranked = elements
    .filter(element => typeof element?.ref === 'string' && element.ref.trim() && element.visible !== false && element.enabled !== false)
    .map(element => ({ ref: element.ref.trim(), score: labelSimilarity(targetLabel, element?.label) }))
    .sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
  return ranked[0]?.score >= 0.6 ? ranked[0].ref : null;
}

function createRecoveryPolicyProvider(options = {}) {
  const baseProvider = options.baseProvider;
  if (!baseProvider || typeof baseProvider.decide !== 'function') throw new Error('recovery_policy_base_provider_required');
  const records = Array.isArray(options.records) ? options.records.map(validateRecoveryRecord) : [];
  const minimumScore = Number.isFinite(Number(options.minimumScore))
    ? Math.max(0, Math.min(1, Number(options.minimumScore)))
    : 0.55;

  return {
    name: 'learned-recovery-policy',
    version: RECOVERY_POLICY_VERSION,

    async decide({ task, observation, history = [] }) {
      const recalled = selectRecovery(records, task, history, minimumScore);
      if (recalled) {
        const recovery = recalled.record.recovery;
        const targetRef = RECOVERY_TARGET_REQUIRED.has(recovery.type)
          ? targetRefForLabel(recovery.targetLabel, observation)
          : null;
        if (!RECOVERY_TARGET_REQUIRED.has(recovery.type) || targetRef) {
          const action = validateAgentAction({
            contractVersion: '0.1.0',
            type: recovery.type,
            targetRef,
            args: {},
            intent: `learned-recovery:${recovery.type}`,
            expectedOutcome: {}
          });
          return {
            status: 'act',
            action,
            targetRef: action.targetRef,
            confidence: recalled.score,
            reasonCode: 'learned_recovery_policy',
            expectedOutcome: {},
            recovery: {},
            metadata: {
              prototypeSource: 'recoveryPolicy',
              recoveryId: recalled.record.recoveryId,
              recoveryScore: recalled.score,
              triggerActionType: recalled.trigger.actionType,
              triggerEffectStatus: recalled.trigger.effectStatus,
              triggerEffectCodes: recalled.trigger.effectCodes
            }
          };
        }
      }
      return baseProvider.decide({ task, observation, history });
    }
  };
}

module.exports = {
  RECOVERY_POLICY_VERSION,
  RECOVERY_POLICY_KIND,
  RECOVERY_ACTION_TYPES,
  RECOVERY_TARGET_REQUIRED,
  RECOVERY_TRIGGER_EFFECTS,
  normalizeCodes,
  stepEffect,
  isRecoveryTriggerStep,
  isUsefulRecoveryStep,
  validateRecoveryRecord,
  recoveryFingerprint,
  buildRecoveryRecords,
  triggerFromHistory,
  recoveryScore,
  selectRecovery,
  targetRefForLabel,
  createRecoveryPolicyProvider
};
