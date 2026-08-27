'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ACTION_TYPES, validateAgentAction } = require('./agent_action_contract.js');
const { tokens, jaccard, historyActionTypes } = require('./offline_baseline_provider.js');

const SELF_EXPERIENCE_MEMORY_VERSION = '0.1.0';
const SELF_EXPERIENCE_KIND = 'strategy-self-experience';
const FORBIDDEN_MEMORY_KEYS = new Set([
  'selector', 'selectors', 'cdpPlan', 'cdpPacket', 'rawCdp', 'tabId',
  'password', 'cookie', 'cookies', 'authorization', 'accessToken', 'refreshToken',
  'clipboard', 'paymentSecret', 'privateReasoning', 'chainOfThought',
  'coordinate', 'coordinates', 'clientX', 'clientY', 'screenX', 'screenY',
  'clickX', 'clickY', 'cdpMethod', 'targetRef', 'rect'
]);

function normalizeInstruction(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function assertNoForbiddenKeys(value, at = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${at}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_MEMORY_KEYS.has(key)) throw new Error(`self_experience_forbidden_key:${at}.${key}`);
    assertNoForbiddenKeys(child, `${at}.${key}`);
  }
}

function targetLabelForStep(step) {
  const targetRef = String(step?.action?.targetRef || step?.mappedAction?.targetRef || '').trim();
  if (!targetRef) return null;
  const elements = Array.isArray(step?.before?.interactiveElements) ? step.before.interactiveElements : [];
  const hit = elements.find(element => element?.ref === targetRef);
  const label = typeof hit?.label === 'string' ? hit.label.trim() : '';
  return label || null;
}

function validateExperience(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('self_experience_record_required');
  if (record.memoryVersion !== SELF_EXPERIENCE_MEMORY_VERSION) throw new Error('self_experience_version_unsupported');
  if (record.kind !== SELF_EXPERIENCE_KIND) throw new Error('self_experience_kind_invalid');
  if (record.source !== 'agent-self-experience') throw new Error('self_experience_source_invalid');
  if (typeof record.experienceId !== 'string' || !record.experienceId.trim()) throw new Error('self_experience_id_required');
  if (typeof record?.task?.instruction !== 'string' || !record.task.instruction.trim()) throw new Error('self_experience_task_required');
  if (!Array.isArray(record.sequence) || !record.sequence.length) throw new Error('self_experience_sequence_required');
  for (const [index, step] of record.sequence.entries()) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error(`self_experience_sequence_${index}_invalid`);
    if (!ACTION_TYPES.has(String(step.type || '').trim())) throw new Error(`self_experience_sequence_${index}_type_invalid`);
    if (typeof step.targetLabel !== 'string' || !step.targetLabel.trim()) throw new Error(`self_experience_sequence_${index}_target_label_required`);
  }
  if (record?.terminal?.reasonCode !== 'goal_satisfied') throw new Error('self_experience_terminal_not_goal_satisfied');
  if (record?.verification?.goalSatisfied !== true) throw new Error('self_experience_goal_not_verified');
  if (record?.verification?.privacyRedacted !== true) throw new Error('self_experience_privacy_not_verified');
  assertNoForbiddenKeys(record);
  return record;
}

function experienceFingerprint(record) {
  return crypto.createHash('sha256').update(JSON.stringify({
    instruction: normalizeInstruction(record?.task?.instruction),
    sequence: (record?.sequence || []).map(step => [step.type, String(step.targetLabel || '').toLowerCase()])
  })).digest('hex');
}

function buildSuccessfulExperience({ task, result, learnedAt = new Date().toISOString() } = {}) {
  if (!task || typeof task.instruction !== 'string' || !task.instruction.trim()) throw new Error('self_experience_task_required');
  if (!result || typeof result !== 'object') throw new Error('self_experience_result_required');
  if (result?.finalOutcome?.taskSucceeded !== true) throw new Error('self_experience_requires_successful_goal');
  if (result?.finalControl?.status !== 'done') throw new Error('self_experience_requires_done_control');
  if (result?.finalBudget?.terminal !== true || result?.finalBudget?.reasonCode !== 'goal_satisfied') {
    throw new Error('self_experience_requires_goal_satisfied_budget');
  }
  const steps = Array.isArray(result.steps) ? result.steps : [];
  if (!steps.length) throw new Error('self_experience_steps_required');

  const sequence = steps.map((step, index) => {
    const action = validateAgentAction(step?.action || step?.mappedAction || step?.decision?.action || null);
    const targetLabel = targetLabelForStep(step);
    if (!targetLabel) throw new Error(`self_experience_target_label_missing:${index}`);
    return { stepIndex: index, type: action.type, targetLabel };
  });

  const base = {
    memoryVersion: SELF_EXPERIENCE_MEMORY_VERSION,
    kind: SELF_EXPERIENCE_KIND,
    source: 'agent-self-experience',
    learnedAt,
    task: { instruction: task.instruction.trim() },
    sequence,
    terminal: { reasonCode: 'goal_satisfied' },
    verification: {
      goalSatisfied: true,
      terminalBudget: true,
      privacyRedacted: true,
      selectorsStored: false,
      rawCoordinatesStored: false,
      observationLocalRefsStored: false,
      privateReasoningStored: false
    }
  };
  const experienceId = `selfexp-${experienceFingerprint(base).slice(0, 20)}`;
  return validateExperience({ ...base, experienceId });
}

function readExperienceMemory(file) {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) return [];
  const text = fs.readFileSync(resolved, 'utf8');
  const out = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      out.push(validateExperience(JSON.parse(line)));
    } catch (error) {
      throw new Error(`self_experience_memory_invalid_line:${index + 1}:${String(error?.message || error)}`);
    }
  }
  return out;
}

function appendExperience(file, record) {
  const validated = validateExperience(record);
  const resolved = path.resolve(file);
  const existing = readExperienceMemory(resolved);
  const fingerprint = experienceFingerprint(validated);
  const duplicate = existing.find(item => experienceFingerprint(item) === fingerprint) || null;
  if (duplicate) {
    return { appended: false, duplicate: true, experienceId: duplicate.experienceId, recordCount: existing.length, file: resolved };
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.appendFileSync(resolved, `${JSON.stringify(validated)}\n`, 'utf8');
  return { appended: true, duplicate: false, experienceId: validated.experienceId, recordCount: existing.length + 1, file: resolved };
}

function sequenceIsPrefix(priorActionTypes, sequence) {
  if (!Array.isArray(priorActionTypes) || !Array.isArray(sequence) || priorActionTypes.length >= sequence.length) return false;
  return priorActionTypes.every((type, index) => type === sequence[index]?.type);
}

function selectExperience(experiences, task, history = [], minimumSimilarity = 0.8) {
  const priorActionTypes = historyActionTypes(history);
  const taskTokens = tokens(task?.instruction);
  const candidates = (Array.isArray(experiences) ? experiences : [])
    .map(validateExperience)
    .filter(record => sequenceIsPrefix(priorActionTypes, record.sequence))
    .map(record => ({
      record,
      score: jaccard(taskTokens, tokens(record.task.instruction))
    }))
    .filter(item => item.score >= minimumSimilarity)
    .sort((a, b) => b.score - a.score || String(b.record.learnedAt || '').localeCompare(String(a.record.learnedAt || '')));
  const best = candidates[0] || null;
  return best ? { ...best, priorActionTypes } : null;
}

function chooseTargetRefFromExperience(sequenceStep, observation) {
  const targetLabel = String(sequenceStep?.targetLabel || '').trim();
  if (!targetLabel) return null;
  const elements = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  const exact = elements.filter(element =>
    typeof element?.ref === 'string' && element.ref.trim() &&
    typeof element?.label === 'string' && normalizeInstruction(element.label) === normalizeInstruction(targetLabel) &&
    element.visible !== false && element.enabled !== false
  );
  if (exact.length === 1) return exact[0].ref.trim();

  const labelTokens = tokens(targetLabel);
  const ranked = elements
    .filter(element => typeof element?.ref === 'string' && element.ref.trim() && typeof element?.label === 'string' && element.label.trim())
    .filter(element => element.visible !== false && element.enabled !== false)
    .map(element => ({ ref: element.ref.trim(), score: jaccard(labelTokens, tokens(element.label)) }))
    .sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
  return ranked[0]?.score >= 0.5 ? ranked[0].ref : null;
}

function createSelfExperienceProvider(options = {}) {
  const baseProvider = options.baseProvider;
  if (!baseProvider || typeof baseProvider.decide !== 'function') throw new Error('self_experience_base_provider_required');
  const minimumSimilarity = Number.isFinite(Number(options.minimumSimilarity))
    ? Math.max(0, Math.min(1, Number(options.minimumSimilarity)))
    : 0.8;
  const memoryFile = options.memoryFile ? path.resolve(options.memoryFile) : null;
  const staticExperiences = Array.isArray(options.experiences) ? options.experiences.map(validateExperience) : null;

  function currentExperiences() {
    return staticExperiences || (memoryFile ? readExperienceMemory(memoryFile) : []);
  }

  return {
    name: 'self-experience-strategy',
    version: SELF_EXPERIENCE_MEMORY_VERSION,

    async decide({ task, observation, history = [] }) {
      const recalled = selectExperience(currentExperiences(), task, history, minimumSimilarity);
      if (recalled) {
        const next = recalled.record.sequence[recalled.priorActionTypes.length];
        const targetRef = chooseTargetRefFromExperience(next, observation);
        if (targetRef) {
          const action = validateAgentAction({
            contractVersion: '0.1.0',
            type: next.type,
            targetRef,
            args: {},
            intent: `self-experience:${next.type}`,
            expectedOutcome: {}
          });
          return {
            status: 'act',
            action,
            targetRef: action.targetRef,
            confidence: recalled.score,
            reasonCode: 'self_experience_recall',
            expectedOutcome: {},
            recovery: {},
            metadata: {
              prototypeSource: 'selfExperience',
              experienceId: recalled.record.experienceId,
              recallScore: recalled.score,
              priorActionTypes: recalled.priorActionTypes,
              learnedSequence: recalled.record.sequence.map(step => step.type)
            }
          };
        }
      }
      return baseProvider.decide({ task, observation, history });
    }
  };
}

module.exports = {
  SELF_EXPERIENCE_MEMORY_VERSION,
  SELF_EXPERIENCE_KIND,
  FORBIDDEN_MEMORY_KEYS,
  normalizeInstruction,
  assertNoForbiddenKeys,
  targetLabelForStep,
  validateExperience,
  experienceFingerprint,
  buildSuccessfulExperience,
  readExperienceMemory,
  appendExperience,
  sequenceIsPrefix,
  selectExperience,
  chooseTargetRefFromExperience,
  createSelfExperienceProvider
};
