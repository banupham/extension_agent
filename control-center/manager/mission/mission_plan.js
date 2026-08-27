'use strict';

const MISSION_PLAN_VERSION = '0.1.0';
const SUBGOAL_STATUSES = new Set(['pending', 'active', 'done', 'blocked', 'failed']);
const TERMINAL_SUBGOAL_STATUSES = new Set(['done', 'blocked', 'failed']);

function normalizeMissionText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
}

function connectorPattern() {
  return /(?:\s*[;\n]+\s*|\s*,?\s*\b(?:sau\s+đó|tiếp\s+theo|kế\s+tiếp|cuối\s+cùng|sau\s+cùng|rồi|then|next|after\s+that|finally)\b\s*)/giu;
}

function splitMissionInstruction(instruction) {
  const text = normalizeMissionText(instruction);
  if (!text) throw new Error('mission_instruction_required');
  const clauses = text
    .split(connectorPattern())
    .map(normalizeMissionText)
    .map(value => value.replace(/^[,.;:\-–—\s]+|[,.;:\-–—\s]+$/gu, '').trim())
    .filter(Boolean);
  return clauses.length ? clauses : [text];
}

function validateSubgoal(subgoal, index = 0) {
  if (!subgoal || typeof subgoal !== 'object' || Array.isArray(subgoal)) throw new Error(`mission_subgoal_${index}_required`);
  const subgoalId = normalizeMissionText(subgoal.subgoalId);
  const instruction = normalizeMissionText(subgoal.instruction);
  const status = normalizeMissionText(subgoal.status || 'pending').toLowerCase();
  if (!subgoalId) throw new Error(`mission_subgoal_${index}_id_required`);
  if (!instruction) throw new Error(`mission_subgoal_${index}_instruction_required`);
  if (!SUBGOAL_STATUSES.has(status)) throw new Error(`mission_subgoal_${index}_status_invalid`);
  return {
    subgoalId,
    order: Number.isInteger(Number(subgoal.order)) ? Number(subgoal.order) : index,
    instruction,
    status,
    successCriteria: Array.isArray(subgoal.successCriteria) ? subgoal.successCriteria : [],
    constraints: subgoal.constraints && typeof subgoal.constraints === 'object' && !Array.isArray(subgoal.constraints)
      ? { ...subgoal.constraints }
      : {},
    metadata: subgoal.metadata && typeof subgoal.metadata === 'object' && !Array.isArray(subgoal.metadata)
      ? { ...subgoal.metadata }
      : {}
  };
}

function validateMissionPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('mission_plan_required');
  if (plan.planVersion !== MISSION_PLAN_VERSION) throw new Error('mission_plan_version_unsupported');
  const missionId = normalizeMissionText(plan.missionId);
  const instruction = normalizeMissionText(plan.instruction);
  if (!missionId) throw new Error('mission_id_required');
  if (!instruction) throw new Error('mission_instruction_required');
  if (!Array.isArray(plan.subgoals) || !plan.subgoals.length) throw new Error('mission_subgoals_required');
  const subgoals = plan.subgoals.map(validateSubgoal).sort((a, b) => a.order - b.order);
  const ids = new Set();
  for (const subgoal of subgoals) {
    if (ids.has(subgoal.subgoalId)) throw new Error(`mission_subgoal_duplicate:${subgoal.subgoalId}`);
    ids.add(subgoal.subgoalId);
  }
  if (subgoals.filter(item => item.status === 'active').length > 1) throw new Error('mission_multiple_active_subgoals');
  return {
    planVersion: MISSION_PLAN_VERSION,
    missionId,
    instruction,
    subgoals,
    constraints: plan.constraints && typeof plan.constraints === 'object' && !Array.isArray(plan.constraints)
      ? { ...plan.constraints }
      : {},
    metadata: plan.metadata && typeof plan.metadata === 'object' && !Array.isArray(plan.metadata)
      ? { ...plan.metadata }
      : {}
  };
}

function createMissionPlan({ missionId, instruction, constraints = {}, metadata = {} } = {}) {
  const id = normalizeMissionText(missionId || `mission-${Date.now()}`);
  const text = normalizeMissionText(instruction);
  if (!text) throw new Error('mission_instruction_required');
  const clauses = splitMissionInstruction(text);
  return validateMissionPlan({
    planVersion: MISSION_PLAN_VERSION,
    missionId: id,
    instruction: text,
    constraints,
    metadata: {
      interpreter: 'ordered-clause-prototype',
      semanticIntentResolution: false,
      ...metadata
    },
    subgoals: clauses.map((clause, index) => ({
      subgoalId: `${id}:sg-${index + 1}`,
      order: index,
      instruction: clause,
      status: 'pending',
      successCriteria: [],
      constraints: {},
      metadata: {
        source: 'natural-language-clause',
        inferredOrder: index
      }
    }))
  });
}

function currentSubgoal(plan) {
  const normalized = validateMissionPlan(plan);
  return normalized.subgoals.find(item => item.status === 'active') || null;
}

function nextPendingSubgoal(plan) {
  const normalized = validateMissionPlan(plan);
  if (currentSubgoal(normalized)) return null;
  return normalized.subgoals.find(item => item.status === 'pending') || null;
}

function missionProgress(plan) {
  const normalized = validateMissionPlan(plan);
  const total = normalized.subgoals.length;
  const done = normalized.subgoals.filter(item => item.status === 'done').length;
  const blocked = normalized.subgoals.filter(item => item.status === 'blocked').length;
  const failed = normalized.subgoals.filter(item => item.status === 'failed').length;
  const terminal = done + blocked + failed;
  return {
    total,
    done,
    blocked,
    failed,
    terminal,
    progress: total ? done / total : 0,
    missionDone: done === total,
    missionTerminal: terminal === total,
    currentSubgoalId: normalized.subgoals.find(item => item.status === 'active')?.subgoalId || null
  };
}

function updateSubgoalStatus(plan, subgoalId, nextStatus) {
  const normalized = validateMissionPlan(plan);
  const status = normalizeMissionText(nextStatus).toLowerCase();
  if (!SUBGOAL_STATUSES.has(status)) throw new Error('mission_subgoal_status_invalid');
  const index = normalized.subgoals.findIndex(item => item.subgoalId === subgoalId);
  if (index < 0) throw new Error(`mission_subgoal_not_found:${subgoalId}`);
  const current = normalized.subgoals[index];
  if (TERMINAL_SUBGOAL_STATUSES.has(current.status)) throw new Error(`mission_subgoal_already_terminal:${subgoalId}`);
  if (status === 'active') {
    if (current.status !== 'pending') throw new Error(`mission_subgoal_cannot_activate_from:${current.status}`);
    if (normalized.subgoals.some(item => item.status === 'active')) throw new Error('mission_multiple_active_subgoals');
    const earlierOpen = normalized.subgoals.some(item => item.order < current.order && item.status !== 'done');
    if (earlierOpen) throw new Error('mission_subgoal_order_violation');
  } else if (TERMINAL_SUBGOAL_STATUSES.has(status) && current.status !== 'active') {
    throw new Error(`mission_subgoal_cannot_finish_from:${current.status}`);
  }
  normalized.subgoals[index] = { ...current, status };
  return validateMissionPlan(normalized);
}

function startNextSubgoal(plan) {
  const normalized = validateMissionPlan(plan);
  const next = nextPendingSubgoal(normalized);
  if (!next) return normalized;
  return updateSubgoalStatus(normalized, next.subgoalId, 'active');
}

function finishCurrentSubgoal(plan, status = 'done') {
  const normalized = validateMissionPlan(plan);
  const current = currentSubgoal(normalized);
  if (!current) throw new Error('mission_active_subgoal_required');
  if (!TERMINAL_SUBGOAL_STATUSES.has(status)) throw new Error('mission_finish_status_invalid');
  return updateSubgoalStatus(normalized, current.subgoalId, status);
}

function createMissionController(initialPlan) {
  let plan = validateMissionPlan(initialPlan);
  return {
    getPlan: () => validateMissionPlan(plan),
    progress: () => missionProgress(plan),
    current: () => currentSubgoal(plan),
    startNext() {
      plan = startNextSubgoal(plan);
      return currentSubgoal(plan);
    },
    finishCurrent(status = 'done') {
      plan = finishCurrentSubgoal(plan, status);
      return missionProgress(plan);
    }
  };
}

module.exports = {
  MISSION_PLAN_VERSION,
  SUBGOAL_STATUSES,
  TERMINAL_SUBGOAL_STATUSES,
  normalizeMissionText,
  connectorPattern,
  splitMissionInstruction,
  validateSubgoal,
  validateMissionPlan,
  createMissionPlan,
  currentSubgoal,
  nextPendingSubgoal,
  missionProgress,
  updateSubgoalStatus,
  startNextSubgoal,
  finishCurrentSubgoal,
  createMissionController
};
