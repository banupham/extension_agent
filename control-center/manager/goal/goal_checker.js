'use strict';

const { validateOutcome } = require('../strategy/contracts.js');

const GOAL_CHECKER_VERSION = '0.1.0';
const SUCCESS_AGGREGATION = 'all';
const PAGE_FIELDS = new Set(['url', 'title']);
const PAGE_OPERATORS = new Set(['equals', 'includes']);
const ELEMENT_MATCH_KEYS = new Set(['label', 'labelIncludes', 'role', 'tag']);
const ELEMENT_EXPECT_KEYS = new Set(['exists', 'visible', 'enabled', 'editable', 'checked', 'selectedValue', 'selectedIndex', 'focused']);
const TAB_MATCH_KEYS = new Set(['title', 'titleIncludes', 'url', 'urlIncludes']);
const TAB_EXPECT_KEYS = new Set(['exists', 'active']);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function nonEmptyString(value, code) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value.trim();
}

function assertOnlyKeys(object, allowed, code) {
  if (!isPlainObject(object)) throw new Error(code);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new Error(code);
  }
}

function normalizeCriterion(input) {
  if (!isPlainObject(input)) throw new Error('goal_criterion_object_required');
  const type = nonEmptyString(input.type, 'goal_criterion_type_required');

  if (type === 'page') {
    const field = nonEmptyString(input.field, 'goal_page_field_required');
    const operator = nonEmptyString(input.operator, 'goal_page_operator_required');
    if (!PAGE_FIELDS.has(field)) throw new Error('goal_page_field_unsupported');
    if (!PAGE_OPERATORS.has(operator)) throw new Error('goal_page_operator_unsupported');
    if (typeof input.value !== 'string') throw new Error('goal_page_value_string_required');
    return { type, field, operator, value: input.value };
  }

  if (type === 'pageSignal') {
    const key = nonEmptyString(input.key, 'goal_page_signal_key_required');
    const operator = nonEmptyString(input.operator || 'equals', 'goal_page_signal_operator_required');
    if (operator !== 'equals') throw new Error('goal_page_signal_operator_unsupported');
    if (!['string', 'number', 'boolean'].includes(typeof input.value) && input.value !== null) {
      throw new Error('goal_page_signal_value_primitive_required');
    }
    return { type, key, operator, value: input.value };
  }

  if (type === 'element') {
    assertOnlyKeys(input.match, ELEMENT_MATCH_KEYS, 'goal_element_match_invalid');
    const matchKeys = Object.keys(input.match);
    if (!matchKeys.length) throw new Error('goal_element_match_required');
    const match = {};
    for (const key of matchKeys) match[key] = nonEmptyString(input.match[key], 'goal_element_match_value_required');

    const expectInput = input.expect == null ? {} : input.expect;
    assertOnlyKeys(expectInput, ELEMENT_EXPECT_KEYS, 'goal_element_expect_invalid');
    const expect = { ...expectInput };
    if (!Object.keys(expect).length) expect.exists = true;
    if ('exists' in expect && typeof expect.exists !== 'boolean') throw new Error('goal_element_exists_boolean_required');
    for (const key of ['visible', 'enabled', 'editable', 'checked', 'focused']) {
      if (key in expect && typeof expect[key] !== 'boolean') throw new Error(`goal_element_${key}_boolean_required`);
    }
    if ('selectedIndex' in expect && !Number.isInteger(Number(expect.selectedIndex))) {
      throw new Error('goal_element_selected_index_integer_required');
    }
    if ('selectedValue' in expect && expect.selectedValue != null && typeof expect.selectedValue !== 'string') {
      throw new Error('goal_element_selected_value_string_required');
    }
    return { type, match, expect };
  }

  if (type === 'browserTab') {
    assertOnlyKeys(input.match, TAB_MATCH_KEYS, 'goal_browser_tab_match_invalid');
    const matchKeys = Object.keys(input.match);
    if (!matchKeys.length) throw new Error('goal_browser_tab_match_required');
    const match = {};
    for (const key of matchKeys) match[key] = nonEmptyString(input.match[key], 'goal_browser_tab_match_value_required');

    const expectInput = input.expect == null ? {} : input.expect;
    assertOnlyKeys(expectInput, TAB_EXPECT_KEYS, 'goal_browser_tab_expect_invalid');
    const expect = { ...expectInput };
    if (!Object.keys(expect).length) expect.exists = true;
    for (const key of ['exists', 'active']) {
      if (key in expect && typeof expect[key] !== 'boolean') throw new Error(`goal_browser_tab_${key}_boolean_required`);
    }
    return { type, match, expect };
  }

  throw new Error('goal_criterion_type_unsupported');
}

function compareString(actual, operator, expected) {
  const value = String(actual ?? '');
  if (operator === 'equals') return value === expected;
  if (operator === 'includes') return value.includes(expected);
  return false;
}

function primitiveEquals(actual, expected) {
  if (expected === null) return actual == null;
  if (typeof expected === 'number') return Number(actual) === expected;
  if (typeof expected === 'boolean') return actual === expected;
  return String(actual ?? '') === expected;
}

function elementMatches(element, match) {
  if (!element || typeof element !== 'object') return false;
  if (match.label != null && normalizeText(element.label) !== normalizeText(match.label)) return false;
  if (match.labelIncludes != null && !normalizeText(element.label).includes(normalizeText(match.labelIncludes))) return false;
  if (match.role != null && normalizeText(element.role) !== normalizeText(match.role)) return false;
  if (match.tag != null && normalizeText(element.tag) !== normalizeText(match.tag)) return false;
  return true;
}

function focusedRefFor(observation) {
  if (typeof observation?.focusedRef === 'string' && observation.focusedRef) return observation.focusedRef;
  const focused = observation?.focusedElement;
  if (typeof focused?.ref === 'string' && focused.ref) return focused.ref;
  if (typeof focused?.id === 'string' && focused.id) return focused.id;
  return null;
}

function elementStateMatches(element, expect, observation) {
  const focusedRef = focusedRefFor(observation);
  for (const [key, expected] of Object.entries(expect)) {
    if (key === 'exists') continue;
    if (key === 'focused') {
      const actual = !!element?.ref && element.ref === focusedRef;
      if (actual !== expected) return false;
      continue;
    }
    if (key === 'selectedIndex') {
      if (Number(element?.selectedIndex) !== Number(expected)) return false;
      continue;
    }
    if (key === 'selectedValue') {
      if (String(element?.selectedValue ?? '') !== String(expected ?? '')) return false;
      continue;
    }
    if (element?.[key] !== expected) return false;
  }
  return true;
}

function tabMatches(tab, match) {
  if (!tab || typeof tab !== 'object') return false;
  if (match.title != null && String(tab.title || '') !== match.title) return false;
  if (match.titleIncludes != null && !String(tab.title || '').includes(match.titleIncludes)) return false;
  if (match.url != null && String(tab.url || '') !== match.url) return false;
  if (match.urlIncludes != null && !String(tab.url || '').includes(match.urlIncludes)) return false;
  return true;
}

function evaluateCriterion(criterion, state) {
  const page = state?.page || null;
  const browserContext = state?.browserContext || null;

  if (criterion.type === 'page') {
    const matched = !!page && compareString(page[criterion.field], criterion.operator, criterion.value);
    return { matched, source: 'page', code: matched ? `page_${criterion.field}_${criterion.operator}_matched` : `page_${criterion.field}_${criterion.operator}_unmatched` };
  }

  if (criterion.type === 'pageSignal') {
    const signals = isPlainObject(page?.pageSignals) ? page.pageSignals : {};
    const hasKey = Object.prototype.hasOwnProperty.call(signals, criterion.key);
    const matched = hasKey && primitiveEquals(signals[criterion.key], criterion.value);
    return { matched, source: 'page', code: matched ? 'page_signal_equals_matched' : 'page_signal_equals_unmatched' };
  }

  if (criterion.type === 'element') {
    const elements = Array.isArray(page?.interactiveElements) ? page.interactiveElements : [];
    const candidates = elements.filter(element => elementMatches(element, criterion.match));
    const expectedExists = 'exists' in criterion.expect ? criterion.expect.exists : true;
    let matched;
    if (!expectedExists) matched = candidates.length === 0;
    else matched = candidates.some(element => elementStateMatches(element, criterion.expect, page));
    return { matched, source: 'page', code: matched ? 'element_expectation_matched' : 'element_expectation_unmatched' };
  }

  if (criterion.type === 'browserTab') {
    const tabs = Array.isArray(browserContext?.tabs) ? browserContext.tabs : [];
    const candidates = tabs.filter(tab => tabMatches(tab, criterion.match));
    const expectedExists = 'exists' in criterion.expect ? criterion.expect.exists : true;
    let matched;
    if (!expectedExists) matched = candidates.length === 0;
    else if (criterion.expect.active === true) matched = candidates.some(tab => tab.active === true);
    else if (criterion.expect.active === false) matched = candidates.some(tab => tab.active !== true);
    else matched = candidates.length > 0;
    return { matched, source: 'browser-context', code: matched ? 'browser_tab_expectation_matched' : 'browser_tab_expectation_unmatched' };
  }

  return { matched: false, source: 'unknown', code: 'goal_criterion_type_unsupported' };
}

function compactValidationFailure(actionSucceeded, executionError, validationError) {
  return validateOutcome({
    actionSucceeded,
    taskSucceeded: false,
    progress: 0,
    evidence: [{
      criterionIndex: -1,
      criterionType: 'invalid',
      source: 'contract',
      beforeMatched: false,
      afterMatched: false,
      changed: false,
      code: 'goal_criteria_invalid'
    }],
    errorCode: actionSucceeded ? 'goal_criteria_invalid' : executionError,
    metadata: {
      goalCheckerVersion: GOAL_CHECKER_VERSION,
      successAggregation: SUCCESS_AGGREGATION,
      criteriaValid: false,
      validationError,
      criterionCount: 0,
      matchedBefore: 0,
      matchedAfter: 0,
      progressBefore: 0,
      progressDelta: 0
    }
  });
}

function evaluateGoal(input = {}) {
  const execution = input.execution || null;
  const actionSucceeded = execution?.ok === true;
  const executionError = actionSucceeded
    ? null
    : String(execution?.error || execution?.result?.error || 'action_execution_failed');
  const criteriaInput = Array.isArray(input?.task?.successCriteria) ? input.task.successCriteria : [];

  let criteria;
  try {
    criteria = criteriaInput.map(normalizeCriterion);
  } catch (error) {
    return compactValidationFailure(actionSucceeded, executionError, String(error?.message || 'goal_criteria_invalid'));
  }

  if (!criteria.length) {
    return validateOutcome({
      actionSucceeded,
      taskSucceeded: false,
      progress: 0,
      evidence: [],
      errorCode: executionError,
      metadata: {
        goalCheckerVersion: GOAL_CHECKER_VERSION,
        successAggregation: SUCCESS_AGGREGATION,
        criteriaValid: true,
        criterionCount: 0,
        matchedBefore: 0,
        matchedAfter: 0,
        progressBefore: 0,
        progressDelta: 0,
        successCriteriaMissing: true
      }
    });
  }

  const beforeState = {
    page: input.before || null,
    browserContext: input.beforeBrowserContext || null
  };
  const afterState = {
    page: input.after || null,
    browserContext: input.afterBrowserContext || null
  };

  let matchedBefore = 0;
  let matchedAfter = 0;
  const evidence = criteria.map((criterion, criterionIndex) => {
    const before = evaluateCriterion(criterion, beforeState);
    const after = evaluateCriterion(criterion, afterState);
    if (before.matched) matchedBefore += 1;
    if (after.matched) matchedAfter += 1;
    return {
      criterionIndex,
      criterionType: criterion.type,
      source: after.source,
      beforeMatched: before.matched,
      afterMatched: after.matched,
      changed: before.matched !== after.matched,
      code: after.code
    };
  });

  const progressBefore = clamp01(matchedBefore / criteria.length);
  const progressAfter = clamp01(matchedAfter / criteria.length);
  const taskSucceeded = matchedAfter === criteria.length;

  return validateOutcome({
    actionSucceeded,
    taskSucceeded,
    progress: progressAfter,
    evidence,
    errorCode: executionError,
    metadata: {
      goalCheckerVersion: GOAL_CHECKER_VERSION,
      successAggregation: SUCCESS_AGGREGATION,
      criteriaValid: true,
      criterionCount: criteria.length,
      matchedBefore,
      matchedAfter,
      progressBefore,
      progressDelta: Number((progressAfter - progressBefore).toFixed(6))
    }
  });
}

module.exports = {
  GOAL_CHECKER_VERSION,
  SUCCESS_AGGREGATION,
  normalizeCriterion,
  evaluateCriterion,
  evaluateGoal,
  elementMatches,
  tabMatches
};
