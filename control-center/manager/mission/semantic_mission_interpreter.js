'use strict';

const { normalizeMissionText, validateMissionPlan } = require('./mission_plan.js');

const SEMANTIC_MISSION_VERSION = '0.1.0';
const GOAL_KINDS = new Set([
  'navigate',
  'search',
  'consume_content',
  'retrieve_information',
  'interact_contextually',
  'explore_interface'
]);

function normalizeLower(value) {
  return normalizeMissionText(value).toLowerCase();
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    pattern.lastIndex = 0;
    if (match) return normalizeMissionText(match[1] || match[0]);
  }
  return null;
}

function extractDestination(instruction) {
  const text = normalizeMissionText(instruction);
  const raw = firstMatch(text, [
    /(?:^|[,.\s])(?:lên|vào|mở|truy\s+cập|đến)\s+([\p{L}\p{N}._-]+)/iu,
    /(?:^|[,.\s])(?:go\s+to|open|visit)\s+([\p{L}\p{N}._-]+)/iu,
    /\bhttps?:\/\/([^\s/]+)/iu
  ]);
  return raw || null;
}

function extractTopic(instruction) {
  const text = normalizeMissionText(instruction);
  const raw = firstMatch(text, [
    /(?:chủ\s+đề|topic)\s+([^,;.]+?)(?=\s+(?:và|rồi|sau\s+đó|then|and)\b|[,;.]|$)/iu,
    /(?:video|videos|nội\s+dung|content)\s+(?:về|about)\s+([^,;.]+?)(?=\s+(?:và|rồi|sau\s+đó|then|and)\b|[,;.]|$)/iu
  ]);
  return raw || null;
}

function extractTemporalWindow(instruction) {
  const text = normalizeMissionText(instruction);
  const match = /\b(\d+)\s*(ngày|day|days|tuần|week|weeks|tháng|month|months)\s*(tới|tiếp|sắp\s+tới|next|ahead)?\b/iu.exec(text);
  if (!match) return null;
  const unitRaw = normalizeLower(match[2]);
  const unit = unitRaw.startsWith('ngày') || unitRaw.startsWith('day')
    ? 'day'
    : unitRaw.startsWith('tuần') || unitRaw.startsWith('week')
      ? 'week'
      : 'month';
  return {
    amount: Number(match[1]),
    unit,
    direction: match[3] ? 'future' : 'unspecified',
    phrase: normalizeMissionText(match[0])
  };
}

function extractLocation(instruction) {
  const text = normalizeMissionText(instruction);
  const match = /(?:\bở\b|\btại\b|\bin\b)\s+([^,;.]+?)(?=\s+(?:trong\s+\d+|for\s+the\s+next|for\s+\d+|\d+\s*(?:ngày|days?|tuần|weeks?|tháng|months?))\b|[,;.]|$)/iu.exec(text);
  return match ? normalizeMissionText(match[1]) : null;
}

function inferGoalKinds(instruction) {
  const text = normalizeLower(instruction);
  const kinds = [];
  if (/(?:\blên\b|\bvào\b|\bmở\b|truy cập|\bđến\b|\bgo to\b|\bopen\b|\bvisit\b|https?:\/\/)/iu.test(text)) kinds.push('navigate');
  if (/(?:\btìm\b|tìm kiếm|search|tra cứu|lookup|look up)/iu.test(text)) kinds.push('search');
  if (/(?:\bxem\b|watch|read|đọc|video|videos|nội dung|content)/iu.test(text)) kinds.push('consume_content');
  if (/(?:kiểm tra|check|tra cứu|lấy thông tin|get information|weather|thời tiết|forecast|dự báo)/iu.test(text)) kinds.push('retrieve_information');
  if (/(?:tương tác|interact|phản hồi|respond|engage)/iu.test(text)) kinds.push('interact_contextually');
  if (/(?:khám phá|explore|thử các tính năng|features|tính năng)/iu.test(text)) kinds.push('explore_interface');
  return unique(kinds.filter(kind => GOAL_KINDS.has(kind)));
}

function inferInteractionPolicy(instruction) {
  const text = normalizeLower(instruction);
  if (!/(?:tương tác|interact|engage|khám phá|explore)/iu.test(text)) return null;
  const contextual = /(?:ngữ cảnh|phù hợp|context|contextual|appropriate)/iu.test(text);
  const exploratory = /(?:khám phá|explore|ngẫu nhiên|random)/iu.test(text);
  return {
    mode: contextual ? 'contextual' : (exploratory ? 'exploratory' : 'unspecified'),
    exploratory,
    contextual,
    externalImpactRequiresExplicitConstraint: true
  };
}

function completionHintsFor(kinds) {
  const out = [];
  for (const kind of kinds || []) {
    if (kind === 'navigate') out.push('destination_reached');
    if (kind === 'search') out.push('search_results_observed');
    if (kind === 'consume_content') out.push('relevant_content_observed');
    if (kind === 'retrieve_information') out.push('requested_information_captured');
    if (kind === 'interact_contextually') out.push('bounded_contextual_interaction_completed');
    if (kind === 'explore_interface') out.push('bounded_feature_exploration_completed');
  }
  return unique(out);
}

function heuristicInterpretSubgoal(subgoal) {
  const instruction = normalizeMissionText(subgoal?.instruction);
  if (!instruction) throw new Error('semantic_mission_subgoal_instruction_required');
  const goalKinds = inferGoalKinds(instruction);
  return {
    semanticVersion: SEMANTIC_MISSION_VERSION,
    subgoalId: String(subgoal?.subgoalId || '').trim() || null,
    instruction,
    goalKinds,
    destination: extractDestination(instruction),
    topic: extractTopic(instruction),
    location: extractLocation(instruction),
    temporalWindow: extractTemporalWindow(instruction),
    interactionPolicy: inferInteractionPolicy(instruction),
    completionHints: completionHintsFor(goalKinds),
    confidence: goalKinds.length ? 0.55 : 0.25,
    interpretationSource: 'heuristic-semantic-prototype',
    requiresProviderUpgrade: goalKinds.length === 0
  };
}

function validateSemanticSubgoal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('semantic_mission_result_required');
  const instruction = normalizeMissionText(value.instruction);
  if (!instruction) throw new Error('semantic_mission_instruction_required');
  const goalKinds = unique(value.goalKinds).filter(kind => GOAL_KINDS.has(kind));
  return {
    semanticVersion: SEMANTIC_MISSION_VERSION,
    subgoalId: value.subgoalId == null ? null : String(value.subgoalId),
    instruction,
    goalKinds,
    destination: value.destination == null ? null : normalizeMissionText(value.destination),
    topic: value.topic == null ? null : normalizeMissionText(value.topic),
    location: value.location == null ? null : normalizeMissionText(value.location),
    temporalWindow: value.temporalWindow && typeof value.temporalWindow === 'object' ? { ...value.temporalWindow } : null,
    interactionPolicy: value.interactionPolicy && typeof value.interactionPolicy === 'object' ? { ...value.interactionPolicy } : null,
    completionHints: unique(value.completionHints),
    confidence: Math.max(0, Math.min(1, Number(value.confidence || 0))),
    interpretationSource: String(value.interpretationSource || 'custom-provider'),
    requiresProviderUpgrade: value.requiresProviderUpgrade === true
  };
}

function createHeuristicSemanticProvider() {
  return {
    name: 'heuristic-semantic-mission',
    version: SEMANTIC_MISSION_VERSION,
    async interpretSubgoal({ subgoal }) {
      return heuristicInterpretSubgoal(subgoal);
    }
  };
}

function createSemanticMissionInterpreter(options = {}) {
  const provider = options.provider || createHeuristicSemanticProvider();
  if (!provider || typeof provider.interpretSubgoal !== 'function') {
    throw new Error('semantic_mission_provider_required');
  }
  return {
    name: provider.name || 'semantic-mission-provider',
    version: provider.version || SEMANTIC_MISSION_VERSION,
    async interpretPlan(plan) {
      const normalized = validateMissionPlan(plan);
      const interpretedSubgoals = [];
      for (const subgoal of normalized.subgoals) {
        const raw = await provider.interpretSubgoal({ mission: normalized, subgoal });
        interpretedSubgoals.push(validateSemanticSubgoal({ ...raw, subgoalId: subgoal.subgoalId, instruction: subgoal.instruction }));
      }
      return {
        semanticMissionVersion: SEMANTIC_MISSION_VERSION,
        missionId: normalized.missionId,
        interpretationSource: provider.name || 'custom-provider',
        subgoals: interpretedSubgoals
      };
    }
  };
}

module.exports = {
  SEMANTIC_MISSION_VERSION,
  GOAL_KINDS,
  normalizeLower,
  unique,
  extractDestination,
  extractTopic,
  extractTemporalWindow,
  extractLocation,
  inferGoalKinds,
  inferInteractionPolicy,
  completionHintsFor,
  heuristicInterpretSubgoal,
  validateSemanticSubgoal,
  createHeuristicSemanticProvider,
  createSemanticMissionInterpreter
};
