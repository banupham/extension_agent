'use strict';

const assert = require('assert');
const { GOAL_CHECKER_VERSION, normalizeCriterion, evaluateGoal } = require('../../manager/goal/goal_checker.js');

function task(successCriteria) {
  return {
    taskId: 'a5-goal-check-test',
    type: 'controlled',
    instruction: 'Validate semantic outcome',
    successCriteria
  };
}

function page(overrides = {}) {
  return {
    observationId: overrides.observationId || 'obs-test',
    url: overrides.url || 'http://127.0.0.1:8091/',
    title: overrides.title || 'READY',
    pageSignals: overrides.pageSignals || {},
    interactiveElements: overrides.interactiveElements || [],
    focusedRef: overrides.focusedRef || null,
    ...overrides
  };
}

function successfulExecution() {
  return { ok: true, actionType: 'test', stepCount: 1, resultCount: 1 };
}

function assertEvidencePrivacy(outcome) {
  const forbidden = new Set(['selector', 'selectors', 'x', 'y', 'rect', 'framePath', 'tabId', 'cdp', 'cdpPlan', 'rawValue']);
  function walk(value) {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!forbidden.has(key), `forbidden evidence key leaked: ${key}`);
      walk(child);
    }
  }
  walk(outcome.evidence);
}

(function run() {
  assert.strictEqual(GOAL_CHECKER_VERSION, '0.1.0');

  const normalizedPage = normalizeCriterion({ type: 'page', field: 'title', operator: 'includes', value: 'PASS' });
  assert.deepStrictEqual(normalizedPage, { type: 'page', field: 'title', operator: 'includes', value: 'PASS' });

  const positive = evaluateGoal({
    task: task([{ type: 'page', field: 'title', operator: 'includes', value: 'SUBMIT PASS' }]),
    execution: successfulExecution(),
    before: page({ title: 'READY' }),
    after: page({ observationId: 'obs-after', title: 'SUBMIT PASS' })
  });
  assert.strictEqual(positive.actionSucceeded, true);
  assert.strictEqual(positive.taskSucceeded, true);
  assert.strictEqual(positive.progress, 1);
  assert.strictEqual(positive.metadata.progressBefore, 0);
  assert.strictEqual(positive.metadata.progressDelta, 1);
  assert.strictEqual(positive.evidence[0].changed, true);

  const negativeControl = evaluateGoal({
    task: task([{ type: 'page', field: 'title', operator: 'includes', value: 'SUBMIT PASS' }]),
    execution: successfulExecution(),
    before: page({ title: 'READY' }),
    after: page({ observationId: 'obs-after', title: 'READY' })
  });
  assert.strictEqual(negativeControl.actionSucceeded, true);
  assert.strictEqual(negativeControl.taskSucceeded, false);
  assert.strictEqual(negativeControl.progress, 0);
  assert.strictEqual(negativeControl.metadata.progressDelta, 0);

  const partial = evaluateGoal({
    task: task([
      { type: 'page', field: 'title', operator: 'includes', value: 'PASS' },
      { type: 'element', match: { label: 'Result Ready' }, expect: { exists: true } }
    ]),
    execution: successfulExecution(),
    before: page({ title: 'READY' }),
    after: page({ title: 'SUBMIT PASS' })
  });
  assert.strictEqual(partial.taskSucceeded, false);
  assert.strictEqual(partial.progress, 0.5);
  assert.strictEqual(partial.metadata.matchedAfter, 1);

  const checked = evaluateGoal({
    task: task([{ type: 'element', match: { label: 'SetChecked Target', tag: 'input' }, expect: { exists: true, checked: true } }]),
    execution: successfulExecution(),
    before: page({ interactiveElements: [{ ref: 'e0', tag: 'input', label: 'SetChecked Target', checked: false, visible: true, enabled: true }] }),
    after: page({ interactiveElements: [{ ref: 'e7', tag: 'input', label: 'SetChecked Target', checked: true, visible: true, enabled: true }] })
  });
  assert.strictEqual(checked.taskSucceeded, true);
  assert.strictEqual(checked.metadata.progressDelta, 1);

  const freshRefFocus = evaluateGoal({
    task: task([{ type: 'element', match: { label: 'Search' }, expect: { focused: true } }]),
    execution: successfulExecution(),
    before: page({ interactiveElements: [{ ref: 'e0', tag: 'input', label: 'Search' }], focusedRef: null }),
    after: page({ interactiveElements: [{ ref: 'e9', tag: 'input', label: 'Search' }], focusedRef: 'e9' })
  });
  assert.strictEqual(freshRefFocus.taskSucceeded, true, 'Goal criteria must survive observation ref replacement by matching semantics');

  const signal = evaluateGoal({
    task: task([{ type: 'pageSignal', key: 'searchResultsVisible', operator: 'equals', value: true }]),
    execution: successfulExecution(),
    before: page({ pageSignals: { searchResultsVisible: false } }),
    after: page({ pageSignals: { searchResultsVisible: true } })
  });
  assert.strictEqual(signal.taskSucceeded, true);

  const switched = evaluateGoal({
    task: task([{ type: 'browserTab', match: { titleIncludes: 'UI TAB BETA' }, expect: { exists: true, active: true } }]),
    execution: successfulExecution(),
    beforeBrowserContext: { tabs: [{ tabId: 1, title: 'UI TAB BETA', url: 'http://127.0.0.1:8091/?tab=beta', active: false }] },
    afterBrowserContext: { tabs: [{ tabId: 1, title: 'UI TAB BETA', url: 'http://127.0.0.1:8091/?tab=beta', active: true }] }
  });
  assert.strictEqual(switched.taskSucceeded, true);
  assert.strictEqual(switched.metadata.progressDelta, 1);
  assertEvidencePrivacy(switched);

  const closed = evaluateGoal({
    task: task([{ type: 'browserTab', match: { title: 'UI TAB DISPOSABLE' }, expect: { exists: false } }]),
    execution: successfulExecution(),
    beforeBrowserContext: { tabs: [{ tabId: 7, title: 'UI TAB DISPOSABLE', url: 'http://127.0.0.1:8091/?tab=disposable', active: false }] },
    afterBrowserContext: { tabs: [] }
  });
  assert.strictEqual(closed.taskSucceeded, true);
  assert.strictEqual(closed.metadata.progressBefore, 0);
  assert.strictEqual(closed.metadata.progressDelta, 1);

  const noCriteria = evaluateGoal({
    task: task([]),
    execution: successfulExecution(),
    before: page(),
    after: page({ title: 'ANYTHING' })
  });
  assert.strictEqual(noCriteria.actionSucceeded, true);
  assert.strictEqual(noCriteria.taskSucceeded, false);
  assert.strictEqual(noCriteria.progress, 0);
  assert.strictEqual(noCriteria.metadata.successCriteriaMissing, true);

  const invalid = evaluateGoal({
    task: task([{ type: 'page', field: 'selector', operator: 'equals', value: '#secret' }]),
    execution: successfulExecution(),
    before: page(),
    after: page()
  });
  assert.strictEqual(invalid.actionSucceeded, true);
  assert.strictEqual(invalid.taskSucceeded, false);
  assert.strictEqual(invalid.errorCode, 'goal_criteria_invalid');
  assert.strictEqual(invalid.metadata.criteriaValid, false);

  const executionFailedButGoalAlreadyTrue = evaluateGoal({
    task: task([{ type: 'page', field: 'title', operator: 'equals', value: 'DONE' }]),
    execution: { ok: false, error: 'target_stale' },
    before: page({ title: 'DONE' }),
    after: page({ title: 'DONE' })
  });
  assert.strictEqual(executionFailedButGoalAlreadyTrue.actionSucceeded, false);
  assert.strictEqual(executionFailedButGoalAlreadyTrue.taskSucceeded, true);
  assert.strictEqual(executionFailedButGoalAlreadyTrue.progress, 1);
  assert.strictEqual(executionFailedButGoalAlreadyTrue.errorCode, 'target_stale');

  assertEvidencePrivacy(positive);
  assertEvidencePrivacy(checked);

  console.log('A5.1 Goal Checker semantic contract: PASS');
})();
