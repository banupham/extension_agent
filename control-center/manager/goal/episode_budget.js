'use strict';

const EPISODE_BUDGET_VERSION = '0.1.0';

const DEFAULT_BUDGETS = Object.freeze({
  maxSteps: 8,
  maxDurationMs: 120000,
  maxConsecutiveFailures: 2,
  maxReplans: 6,
  maxStalledSteps: 3
});

const STEP_CONTROL_STATUSES = new Set(['done', 'continue', 'failed', 'blocked']);

function finitePositiveInt(value, fallback, code) {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(code);
  return n;
}

function finitePositiveNumber(value, fallback, code) {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(code);
  return n;
}

function normalizeBudgets(input = {}) {
  return {
    maxSteps: finitePositiveInt(input.maxSteps, DEFAULT_BUDGETS.maxSteps, 'budget_max_steps_positive_integer_required'),
    maxDurationMs: finitePositiveNumber(input.maxDurationMs, DEFAULT_BUDGETS.maxDurationMs, 'budget_max_duration_positive_required'),
    maxConsecutiveFailures: finitePositiveInt(
      input.maxConsecutiveFailures,
      DEFAULT_BUDGETS.maxConsecutiveFailures,
      'budget_max_consecutive_failures_positive_integer_required'
    ),
    maxReplans: finitePositiveInt(input.maxReplans, DEFAULT_BUDGETS.maxReplans, 'budget_max_replans_positive_integer_required'),
    maxStalledSteps: finitePositiveInt(
      input.maxStalledSteps,
      DEFAULT_BUDGETS.maxStalledSteps,
      'budget_max_stalled_steps_positive_integer_required'
    )
  };
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeControl(control) {
  if (!control || typeof control !== 'object') throw new Error('episode_budget_control_required');
  const status = String(control.status || '').trim();
  if (!STEP_CONTROL_STATUSES.has(status)) throw new Error('episode_budget_control_status_invalid');
  return {
    status,
    terminal: control.terminal === true,
    shouldReplan: control.shouldReplan === true,
    reasonCode: String(control.reasonCode || 'unspecified'),
    actionSucceeded: control.actionSucceeded === true,
    taskSucceeded: control.taskSucceeded === true,
    progress: Math.max(0, Math.min(1, numberOrZero(control.progress))),
    progressDelta: Math.max(-1, Math.min(1, numberOrZero(control.progressDelta))),
    errorCode: control.errorCode == null ? null : String(control.errorCode)
  };
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) throw new Error('episode_budget_history_array_required');
  return history.map((entry, index) => ({
    stepIndex: Number.isInteger(Number(entry?.stepIndex)) ? Number(entry.stepIndex) : index + 1,
    recordedAtMs: Number.isFinite(Number(entry?.recordedAtMs)) ? Number(entry.recordedAtMs) : null,
    actionType: entry?.actionType == null ? null : String(entry.actionType),
    controlStatus: STEP_CONTROL_STATUSES.has(String(entry?.controlStatus || '')) ? String(entry.controlStatus) : 'continue',
    actionSucceeded: entry?.actionSucceeded === true,
    taskSucceeded: entry?.taskSucceeded === true,
    progress: Math.max(0, Math.min(1, numberOrZero(entry?.progress))),
    progressDelta: Math.max(-1, Math.min(1, numberOrZero(entry?.progressDelta))),
    reasonCode: String(entry?.reasonCode || 'unspecified'),
    errorCode: entry?.errorCode == null ? null : String(entry.errorCode),
    shouldReplan: entry?.shouldReplan === true
  }));
}

function compactStep({ history, control, actionType = null, nowMs }) {
  return {
    stepIndex: history.length + 1,
    recordedAtMs: nowMs,
    actionType: actionType == null ? null : String(actionType),
    controlStatus: control.status,
    actionSucceeded: control.actionSucceeded,
    taskSucceeded: control.taskSucceeded,
    progress: control.progress,
    progressDelta: control.progressDelta,
    reasonCode: control.reasonCode,
    errorCode: control.errorCode,
    shouldReplan: control.shouldReplan
  };
}

function countTrailing(history, predicate) {
  let count = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (!predicate(history[i])) break;
    count += 1;
  }
  return count;
}

function usageFor(history, startedAtMs, nowMs) {
  const consecutiveFailures = countTrailing(history, step => step.controlStatus === 'failed');
  const stalledSteps = countTrailing(history, step => (
    step.controlStatus === 'continue' &&
    step.actionSucceeded === true &&
    step.progressDelta <= 0
  ));
  const replansRequested = history.filter(step => step.shouldReplan === true).length;
  return {
    steps: history.length,
    replansRequested,
    consecutiveFailures,
    stalledSteps,
    elapsedMs: Math.max(0, nowMs - startedAtMs)
  };
}

function firstBudgetExhaustion(usage, budgets) {
  if (usage.elapsedMs >= budgets.maxDurationMs) return 'budget_max_duration_reached';
  if (usage.steps >= budgets.maxSteps) return 'budget_max_steps_reached';
  if (usage.consecutiveFailures >= budgets.maxConsecutiveFailures) return 'budget_consecutive_failures_reached';
  if (usage.stalledSteps >= budgets.maxStalledSteps) return 'budget_stalled_progress_reached';
  if (usage.replansRequested > budgets.maxReplans) return 'budget_max_replans_reached';
  return null;
}

function evaluateEpisodeBudget(input = {}) {
  const budgets = normalizeBudgets(input.budgets || {});
  const historyBefore = normalizeHistory(input.history || []);
  const control = normalizeControl(input.control);
  const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now();
  const startedAtMs = Number.isFinite(Number(input.startedAtMs)) ? Number(input.startedAtMs) : nowMs;
  if (startedAtMs > nowMs) throw new Error('episode_budget_started_at_after_now');

  const step = compactStep({
    history: historyBefore,
    control,
    actionType: input.actionType,
    nowMs
  });
  const history = [...historyBefore, step];
  const usage = usageFor(history, startedAtMs, nowMs);

  if (control.status === 'done' || control.taskSucceeded) {
    return {
      episodeBudgetVersion: EPISODE_BUDGET_VERSION,
      status: 'done',
      terminal: true,
      shouldReplan: false,
      reasonCode: 'goal_satisfied',
      exhausted: false,
      exhaustedBudget: null,
      budgets,
      usage,
      step,
      history
    };
  }

  if (control.status === 'blocked') {
    return {
      episodeBudgetVersion: EPISODE_BUDGET_VERSION,
      status: 'blocked',
      terminal: true,
      shouldReplan: false,
      reasonCode: control.reasonCode,
      exhausted: false,
      exhaustedBudget: null,
      budgets,
      usage,
      step,
      history
    };
  }

  const exhaustedBudget = firstBudgetExhaustion(usage, budgets);
  if (exhaustedBudget) {
    return {
      episodeBudgetVersion: EPISODE_BUDGET_VERSION,
      status: 'failed',
      terminal: true,
      shouldReplan: false,
      reasonCode: exhaustedBudget,
      exhausted: true,
      exhaustedBudget,
      budgets,
      usage,
      step,
      history
    };
  }

  return {
    episodeBudgetVersion: EPISODE_BUDGET_VERSION,
    status: 'continue',
    terminal: false,
    shouldReplan: control.shouldReplan === true,
    reasonCode: control.status === 'failed' ? 'replan_after_step_failure' : control.reasonCode,
    exhausted: false,
    exhaustedBudget: null,
    budgets,
    usage,
    step,
    history
  };
}

module.exports = {
  EPISODE_BUDGET_VERSION,
  DEFAULT_BUDGETS,
  STEP_CONTROL_STATUSES,
  normalizeBudgets,
  normalizeHistory,
  compactStep,
  usageFor,
  firstBudgetExhaustion,
  evaluateEpisodeBudget
};
