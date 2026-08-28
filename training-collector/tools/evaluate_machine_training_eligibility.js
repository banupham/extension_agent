'use strict';

const fs = require('fs');
const path = require('path');
const { evaluateGoal } = require('../../control-center/manager/goal/goal_checker.js');
const {
  SCENARIOS,
  MOTOR_SCENARIOS,
  scenarioById,
  successTitleFor,
  successSignalLabelFor
} = require('../../control-center/script/teaching_lab_server.js');

const MACHINE_TRAINING_ELIGIBILITY_VERSION = '0.3.0';
const MACHINE_STATUSES = Object.freeze(['accept', 'quarantine', 'reject']);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function resolveFile(file) { if (!file) return null; return path.isAbsolute(file) ? file : path.resolve(file); }
function byEpisode(items) { return new Map((Array.isArray(items) ? items : []).map(item => [String(item?.episodeId || ''), item]).filter(([id]) => !!id)); }
function normalizeText(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }

function observationElements(observation) {
  const direct = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  const nested = Array.isArray(observation?.page?.interactiveElements) ? observation.page.interactiveElements : [];
  return direct.length ? direct : nested;
}
function observationHasElementLabel(observation, expectedLabel) {
  const expected = String(expectedLabel || '').trim();
  if (!expected) return false;
  return observationElements(observation).some(element => String(element?.label || '').trim() === expected);
}
function observationFingerprint(observation) {
  if (!observation || typeof observation !== 'object') return null;
  const elements = observationElements(observation).map(element => ({
    label: typeof element?.label === 'string' ? element.label.trim().toLowerCase() : null,
    role: typeof element?.role === 'string' ? element.role.trim().toLowerCase() : null,
    tag: typeof element?.tag === 'string' ? element.tag.trim().toLowerCase() : null,
    visible: element?.visible !== false,
    enabled: element?.enabled !== false,
    editable: element?.editable === true,
    checked: typeof element?.checked === 'boolean' ? element.checked : null,
    selectedValue: element?.selectedValue == null ? null : String(element.selectedValue),
    selectedIndex: Number.isInteger(Number(element?.selectedIndex)) ? Number(element.selectedIndex) : null,
    rangeValue: Number.isFinite(Number(element?.rangeValue)) ? Number(element.rangeValue) : null
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const pageSignals = observation?.pageSignals && typeof observation.pageSignals === 'object'
    ? observation.pageSignals
    : (observation?.page?.pageSignals && typeof observation.page.pageSignals === 'object' ? observation.page.pageSignals : {});
  return JSON.stringify({ url: String(observation?.url || observation?.page?.url || ''), title: String(observation?.title || observation?.page?.title || ''), elements, pageSignals });
}
function semanticStateChanged(transition) { return observationFingerprint(transition?.strategyObservationBefore) !== observationFingerprint(transition?.strategyObservationAfter); }

function explicitSuccessCriteriaVerification(review) {
  const criteria = Array.isArray(review?.task?.successCriteria) ? review.task.successCriteria : [];
  if (!criteria.length) return null;
  const transitions = Array.isArray(review?.transitions) ? review.transitions : [];
  if (!transitions.length) return { status: 'contradicted', source: 'explicit-success-criteria', confidence: 1, reasons: ['episode_has_no_transitions'], outcome: null };
  const allActionsSucceeded = transitions.every(item => item?.outcome?.actionSucceeded !== false);
  const result = evaluateGoal({ task: review.task, execution: { ok: allActionsSucceeded }, before: transitions[0]?.strategyObservationBefore || null, after: transitions.at(-1)?.strategyObservationAfter || null, beforeBrowserContext: null, afterBrowserContext: null });
  return { status: result?.taskSucceeded === true ? 'verified' : 'contradicted', source: 'explicit-success-criteria', confidence: 1, reasons: result?.taskSucceeded === true ? ['success_criteria_satisfied'] : ['success_criteria_not_satisfied'], outcome: result };
}

function declaredMachineSignalVerification(review) {
  const expected = review?.task?.metadata?.machineSuccessSignal;
  if (!expected || typeof expected !== 'object') return null;
  const transitions = Array.isArray(review?.transitions) ? review.transitions : [];
  const after = transitions.at(-1)?.strategyObservationAfter || null;
  if (!after) return { status: 'contradicted', source: 'declared-machine-success-signal', confidence: 1, reasons: ['final_observation_missing'] };
  const actualTitle = String(after?.title || after?.page?.title || '');
  const actualUrl = String(after?.url || after?.page?.url || '');
  const signals = after?.pageSignals || after?.page?.pageSignals || {};
  let matched = false;
  if (typeof expected.elementLabel === 'string') matched = observationHasElementLabel(after, expected.elementLabel);
  else if (typeof expected.title === 'string') matched = actualTitle === expected.title;
  else if (typeof expected.titleIncludes === 'string') matched = actualTitle.includes(expected.titleIncludes);
  else if (typeof expected.urlIncludes === 'string') matched = actualUrl.includes(expected.urlIncludes);
  else if (typeof expected.pageSignalKey === 'string') matched = Object.prototype.hasOwnProperty.call(signals, expected.pageSignalKey) && signals[expected.pageSignalKey] === expected.pageSignalValue;
  return { status: matched ? 'verified' : 'contradicted', source: 'declared-machine-success-signal', confidence: 1, reasons: [matched ? 'machine_success_signal_satisfied' : 'machine_success_signal_not_satisfied'] };
}

function teachingScenarioFromUrl(value) {
  const text = String(value || '');
  let match = text.match(/\/teaching\/(TL\d{2})(?:[/?#]|$)/i);
  if (!match) match = text.match(/\/teaching\/motor\/(M\d{2})(?:[/?#]|$)/i);
  if (!match) return null;
  const id = match[1].toUpperCase();
  return scenarioById(id) ? id : null;
}
function teachingTaskMatchesScenario(task, scenarioId) {
  const scenario = scenarioById(scenarioId);
  if (!scenario) return false;
  const instruction = normalizeText(task?.instruction);
  if (!instruction) return false;
  const id = normalizeText(scenarioId);
  const canonical = normalizeText(scenario.task);
  return instruction.includes(id) || instruction === canonical || instruction.includes(canonical);
}
function teachingLabOutcomeVerification(review) {
  const transitions = Array.isArray(review?.transitions) ? review.transitions : [];
  if (!transitions.length) return null;
  const beforeUrl = String(transitions[0]?.strategyObservationBefore?.url || transitions[0]?.strategyObservationBefore?.page?.url || '');
  const after = transitions.at(-1)?.strategyObservationAfter || null;
  const afterUrl = String(after?.url || after?.page?.url || '');
  const scenarioId = teachingScenarioFromUrl(afterUrl) || teachingScenarioFromUrl(beforeUrl);
  if (!scenarioId) return null;
  const scenario = scenarioById(scenarioId);
  if (!teachingTaskMatchesScenario(review?.task, scenarioId)) return { status: 'unverified', source: 'teaching-lab-deterministic-signal', confidence: 0.4, scenarioId, reasons: ['teaching_lab_task_scenario_alignment_unverified'] };
  if (scenario?.type === 'ambiguity') return { status: 'unverified', source: 'teaching-lab-deterministic-signal', confidence: 1, scenarioId, reasons: ['teaching_lab_ambiguity_is_not_positive_action_training'] };
  const expectedSemanticSignal = successSignalLabelFor(scenarioId);
  const semanticSignalMatched = observationHasElementLabel(after, expectedSemanticSignal);
  const expectedTitle = successTitleFor(scenarioId);
  const actualTitle = String(after?.title || after?.page?.title || '');
  const titleMatched = actualTitle === expectedTitle;
  const matched = semanticSignalMatched || titleMatched;
  return { status: matched ? 'verified' : 'contradicted', source: 'teaching-lab-deterministic-signal', confidence: 1, scenarioId, expectedSemanticSignal, semanticSignalMatched, expectedTitle, actualTitle, titleMatched, reasons: [matched ? 'teaching_lab_success_signal_satisfied' : 'teaching_lab_success_signal_not_satisfied'] };
}

function genericOutcomeSupport(review) {
  const transitions = Array.isArray(review?.transitions) ? review.transitions : [];
  const finalStatus = String(review?.finalOutcome?.status || '').trim().toLowerCase();
  if (finalStatus !== 'success') return { status: 'contradicted', source: 'captured-demonstration', confidence: 1, reasons: ['final_outcome_not_success'] };
  if (!transitions.length) return { status: 'unverified', source: 'captured-demonstration', confidence: 0, reasons: ['episode_has_no_transitions'] };
  if (transitions.some(item => item?.outcome?.actionSucceeded === false)) return { status: 'contradicted', source: 'captured-demonstration', confidence: 0.95, reasons: ['captured_action_failure_present'] };
  const changed = transitions.filter(semanticStateChanged).length;
  return { status: changed > 0 ? 'supported' : 'unverified', source: 'captured-semantic-change', confidence: changed > 0 ? 0.7 : 0.4, reasons: [changed > 0 ? 'semantic_state_change_observed' : 'no_independent_semantic_state_change_observed'], semanticStateChangedTransitionCount: changed };
}
function verifyTaskOutcome(review) { return explicitSuccessCriteriaVerification(review) || declaredMachineSignalVerification(review) || teachingLabOutcomeVerification(review) || genericOutcomeSupport(review); }

function candidateSemanticSafety(candidate, candidatePolicy = null) {
  if (!candidate) return { ok: false, reasons: ['no_fully_resolved_strategy_candidate'] };
  const reasons = [];
  if (candidatePolicy?.onlyCapturedSuccessfulIncludedActionsEligible !== true) reasons.push('captured_success_candidate_policy_not_verified');
  const steps = (Array.isArray(candidate?.proposedSteps) ? candidate.proposedSteps : []).filter(step => step?.proposedInclude === true);
  if (!steps.length) reasons.push('no_included_strategy_steps');
  if (steps.some(step => !step?.proposedAction)) reasons.push('semantic_action_missing');
  if (steps.some(step => step?.capturedActionSucceeded === false)) reasons.push('captured_action_not_successful');
  if (steps.some(step => step?.proposedAction?.type === 'focus')) reasons.push('focus_surface_action_not_strategy_semantic');
  if (steps.some(step => step?.ambiguityResolutionStatus === 'needs-human-review')) reasons.push('unresolved_ambiguity_present');
  return { ok: reasons.length === 0, reasons };
}

function classifyEpisode({ queueItem, packItem, resolutionItem, candidate, blockedCandidate, candidatePolicy, review }) {
  const episodeId = String(queueItem?.episodeId || packItem?.episodeId || candidate?.episodeId || '');
  const reasons = [];
  if (queueItem?.queueStatus === 'blocked-before-review' || queueItem?.privacySafe === false || queueItem?.strategyReady !== true) {
    if (queueItem?.privacySafe === false) reasons.push('privacy_or_review_export_not_safe');
    if (queueItem?.strategyReady !== true) reasons.push('strategy_not_ready');
    if (queueItem?.queueStatus === 'blocked-before-review') reasons.push('blocked_before_semantic_review');
    return { episodeId, status: 'reject', reasons: [...new Set(reasons)], outcomeVerification: verifyTaskOutcome(review), semantic: { ok: false, reasons: ['review_gate_failed'] } };
  }
  const outcomeVerification = verifyTaskOutcome(review);
  const semantic = candidateSemanticSafety(candidate, candidatePolicy);
  if (outcomeVerification.status === 'contradicted') return { episodeId, status: 'reject', reasons: [...outcomeVerification.reasons], outcomeVerification, semantic };
  const unresolved = Number(resolutionItem?.unresolvedHumanReviewCount || 0);
  if (blockedCandidate) reasons.push(...(Array.isArray(blockedCandidate.reasons) ? blockedCandidate.reasons : ['candidate_blocked']));
  if (unresolved > 0) reasons.push('unresolved_semantic_ambiguity');
  if (!semantic.ok) reasons.push(...semantic.reasons);
  if (!reasons.length && outcomeVerification.status === 'verified') return { episodeId, status: 'accept', reasons: ['semantic_candidate_resolved', 'captured_success_policy_verified', 'independent_task_outcome_verified'], outcomeVerification, semantic };
  if (outcomeVerification.status !== 'verified') reasons.push('independent_task_outcome_not_verified');
  return { episodeId, status: 'quarantine', reasons: [...new Set(reasons)], outcomeVerification, semantic };
}

function evaluateMachineTrainingEligibility({ manifest, reviewPack, resolution, candidates } = {}) {
  const queue = Array.isArray(manifest?.strategy?.queue) ? manifest.strategy.queue : [];
  const packItems = byEpisode(reviewPack?.items);
  const resolutionItems = byEpisode(resolution?.items);
  const candidateItems = byEpisode(candidates?.candidates);
  const blockedItems = byEpisode(candidates?.blocked);
  const candidatePolicy = candidates?.policy || null;
  const items = [];
  for (const queueItem of queue) {
    const episodeId = String(queueItem?.episodeId || '');
    const packItem = packItems.get(episodeId) || null;
    const sourceFile = resolveFile(packItem?.sourceFile || queueItem?.file);
    let review = null;
    let readError = null;
    try { if (sourceFile && fs.existsSync(sourceFile)) review = readJson(sourceFile); else readError = 'review_source_missing'; } catch (error) { readError = String(error?.message || error); }
    if (!review) { items.push({ episodeId, status: 'reject', reasons: [readError || 'review_source_unreadable'], outcomeVerification: { status: 'unverified', source: 'none', confidence: 0, reasons: [readError || 'review_source_unreadable'] }, semantic: { ok: false, reasons: ['review_source_unreadable'] } }); continue; }
    items.push(classifyEpisode({ queueItem, packItem, resolutionItem: resolutionItems.get(episodeId) || null, candidate: candidateItems.get(episodeId) || null, blockedCandidate: blockedItems.get(episodeId) || null, candidatePolicy, review }));
  }
  const counts = { accept: items.filter(item => item.status === 'accept').length, quarantine: items.filter(item => item.status === 'quarantine').length, reject: items.filter(item => item.status === 'reject').length };
  return {
    machineTrainingEligibilityVersion: MACHINE_TRAINING_ELIGIBILITY_VERSION,
    generatedAt: new Date().toISOString(),
    policy: { failClosed: true, userTaskLevelOutcomeIsNotSemanticLabelApproval: true, independentOutcomeVerificationRequiredForAccept: true, deterministicTeachingLabSignalSupported: true, deterministicMotorTeachingSignalSupported: true, capturedSuccessTrustRequiresUpstreamCandidatePolicy: true, unresolvedSemanticAmbiguityQuarantined: true, privacyOrInvalidReviewRejected: true, supportedButUnverifiedOutcomeQuarantined: true, productionPromotionAllowed: false },
    counts,
    machineAcceptEpisodeIds: items.filter(item => item.status === 'accept').map(item => item.episodeId),
    quarantineEpisodeIds: items.filter(item => item.status === 'quarantine').map(item => item.episodeId),
    rejectEpisodeIds: items.filter(item => item.status === 'reject').map(item => item.episodeId),
    items
  };
}

module.exports = { MACHINE_TRAINING_ELIGIBILITY_VERSION, MACHINE_STATUSES, readJson, resolveFile, byEpisode, normalizeText, observationElements, observationHasElementLabel, observationFingerprint, semanticStateChanged, explicitSuccessCriteriaVerification, declaredMachineSignalVerification, teachingScenarioFromUrl, teachingTaskMatchesScenario, teachingLabOutcomeVerification, genericOutcomeSupport, verifyTaskOutcome, candidateSemanticSafety, classifyEpisode, evaluateMachineTrainingEligibility, SCENARIOS, MOTOR_SCENARIOS };
