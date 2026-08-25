'use strict';

(function initCdpPlanDispatcher(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AgentCdpPlanDispatcher = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
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

  function validatePlan(plan) {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('invalid_cdp_plan');
    if (plan.cdpPlanVersion !== '0.1.0') throw new Error('unsupported_cdp_plan_version');
    if (!Array.isArray(plan.steps) || plan.steps.length === 0 || plan.steps.length > 500) throw new Error('invalid_cdp_plan_steps');
    return {
      cdpPlanVersion: plan.cdpPlanVersion,
      actionType: typeof plan.actionType === 'string' ? plan.actionType : null,
      targetRef: typeof plan.targetRef === 'string' ? plan.targetRef : null,
      steps: plan.steps.map((step, index) => {
        const method = typeof step?.method === 'string' ? step.method : '';
        if (!ALLOWED_METHODS.has(method)) throw new Error(`cdp_method_not_allowed:${method || index}`);
        const params = step?.params && typeof step.params === 'object' && !Array.isArray(step.params) ? step.params : {};
        return {
          delayMs: finiteDelay(step.delayMs),
          postDelayMs: finiteDelay(step.postDelayMs),
          method,
          params
        };
      })
    };
  }

  async function dispatchPlan(plan, sendCommand, sleep) {
    if (typeof sendCommand !== 'function' || typeof sleep !== 'function') throw new Error('dispatcher_dependencies_required');
    const normalized = validatePlan(plan);
    const results = [];
    for (const step of normalized.steps) {
      if (step.delayMs) await sleep(step.delayMs);
      results.push(await sendCommand(step.method, step.params));
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

  return { ALLOWED_METHODS, validatePlan, dispatchPlan };
});
