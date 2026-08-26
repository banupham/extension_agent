'use strict';

(function initCdpPlanDispatcher(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AgentCdpPlanDispatcher = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const SUPPORTED_PLAN_VERSIONS = new Set(['0.1.0', '0.1.1', '0.1.2', '0.1.3']);
  const LATEST_PLAN_VERSION = '0.1.3';
  const ALLOWED_METHODS = new Set([
    'Input.dispatchMouseEvent',
    'Input.dispatchKeyEvent',
    'Input.insertText',
    'Page.navigate',
    'Page.reload',
    'Page.getNavigationHistory',
    'Page.navigateToHistoryEntry'
  ]);

  function finiteDelay(value, max = 10000) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n < 0 || n > max) throw new Error('invalid_plan_delay');
    return n;
  }

  function normalizeHistoryOffset(value) {
    if (value == null) return null;
    const offset = Number(value);
    if (!Number.isInteger(offset) || ![-1, 1].includes(offset)) throw new Error('invalid_history_offset');
    return offset;
  }

  function validatePlan(plan) {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('invalid_cdp_plan');
    if (!SUPPORTED_PLAN_VERSIONS.has(plan.cdpPlanVersion)) throw new Error('unsupported_cdp_plan_version');

    const actionType = typeof plan.actionType === 'string' ? plan.actionType : null;
    if (!Array.isArray(plan.steps) || plan.steps.length > 500) throw new Error('invalid_cdp_plan_steps');
    if (plan.steps.length === 0 && actionType !== 'waitAndObserve') throw new Error('invalid_cdp_plan_steps');

    const targetRef = typeof plan.targetRef === 'string' && plan.targetRef.trim() ? plan.targetRef.trim() : null;
    const destinationRef = typeof plan.destinationRef === 'string' && plan.destinationRef.trim() ? plan.destinationRef.trim() : null;

    if (actionType === 'drag') {
      if (plan.cdpPlanVersion !== '0.1.3') throw new Error('drag_binding_requires_plan_0.1.3');
      if (!targetRef || !destinationRef) throw new Error('drag_target_refs_required');
      if (targetRef === destinationRef) throw new Error('drag_source_destination_must_differ');
    }

    const steps = plan.steps.map((step, index) => {
      const method = typeof step?.method === 'string' ? step.method : '';
      if (!ALLOWED_METHODS.has(method)) throw new Error(`cdp_method_not_allowed:${method || index}`);
      const params = step?.params && typeof step.params === 'object' && !Array.isArray(step.params) ? step.params : {};
      const historyOffset = normalizeHistoryOffset(step?.historyOffset);

      if (historyOffset != null) {
        if (!['0.1.2', '0.1.3'].includes(plan.cdpPlanVersion)) throw new Error('history_binding_requires_plan_0.1.2');
        if (method !== 'Page.navigateToHistoryEntry') throw new Error('history_binding_method_invalid');
        if (Object.prototype.hasOwnProperty.call(params, 'entryId')) throw new Error('history_binding_entry_id_conflict');
        const previousMethod = index > 0 && typeof plan.steps[index - 1]?.method === 'string' ? plan.steps[index - 1].method : '';
        if (previousMethod !== 'Page.getNavigationHistory') throw new Error('history_binding_source_invalid');
      }

      return {
        delayMs: finiteDelay(step.delayMs),
        postDelayMs: finiteDelay(step.postDelayMs),
        method,
        params,
        historyOffset
      };
    });

    return {
      cdpPlanVersion: plan.cdpPlanVersion,
      actionType,
      targetRef,
      destinationRef,
      steps
    };
  }

  function paramsForStep(step, previous) {
    if (step.historyOffset == null) return step.params;
    if (previous?.method !== 'Page.getNavigationHistory') throw new Error('history_binding_source_missing');

    const history = previous.result || {};
    const entries = Array.isArray(history.entries) ? history.entries : [];
    const currentIndex = Number(history.currentIndex);
    if (!Number.isInteger(currentIndex)) throw new Error('history_navigation_state_invalid');

    const targetIndex = currentIndex + step.historyOffset;
    const entry = entries[targetIndex];
    if (entry?.id == null) {
      throw new Error(step.historyOffset < 0 ? 'history_back_unavailable' : 'history_forward_unavailable');
    }

    return { ...step.params, entryId: entry.id };
  }

  async function dispatchPlan(plan, sendCommand, sleep) {
    if (typeof sendCommand !== 'function' || typeof sleep !== 'function') throw new Error('dispatcher_dependencies_required');
    const normalized = validatePlan(plan);
    const results = [];
    let previous = null;

    for (const step of normalized.steps) {
      if (step.delayMs) await sleep(step.delayMs);
      const params = paramsForStep(step, previous);
      const result = await sendCommand(step.method, params);
      results.push(result);
      previous = { method: step.method, result };
      if (step.postDelayMs) await sleep(step.postDelayMs);
    }

    return {
      ok: true,
      cdpPlanVersion: normalized.cdpPlanVersion,
      actionType: normalized.actionType,
      stepCount: normalized.steps.length,
      resultCount: results.length
    };
  }

  return {
    SUPPORTED_PLAN_VERSIONS,
    LATEST_PLAN_VERSION,
    ALLOWED_METHODS,
    validatePlan,
    paramsForStep,
    dispatchPlan
  };
});
