'use strict';

const assert = require('assert');
const { orchestrateOneStepReplan } = require('../../manager/agent/one_step_replan.js');

function task(title) {
  return {
    taskId: `task-${title}`,
    type: 'test',
    instruction: `reach ${title}`,
    successCriteria: [
      { type: 'page', field: 'title', operator: 'equals', value: title }
    ]
  };
}

function page(id, title) {
  return {
    observationId: id,
    capturedAt: new Date(0).toISOString(),
    url: 'http://127.0.0.1:8091/',
    title,
    viewport: { width: 1200, height: 800 },
    scroll: { x: 0, y: 0 },
    interactiveElements: [],
    pageSignals: {},
    privacy: { redacted: true }
  };
}

function stepResult({ beforeTitle = 'BEFORE', afterTitle = 'AFTER', executionOk = true, mappedAction = 'moveTo', after = true } = {}) {
  return {
    mappedAction: { type: mappedAction, args: {} },
    decision: { status: 'act', action: { type: mappedAction, args: {} } },
    execution: executionOk ? { ok: true } : { ok: false, error: 'execution_failed' },
    before: page('obs-before', beforeTitle),
    after: after ? page('obs-after', afterTitle) : null,
    beforeBrowserContext: null,
    afterBrowserContext: null
  };
}

function strategyRecorder(decision = { status: 'act', action: { type: 'submit', targetRef: 'e1', args: {} }, reasonCode: 'next_step' }) {
  const calls = [];
  return {
    calls,
    async decide(input) {
      calls.push(input);
      return decision;
    }
  };
}

async function main() {
  const doneStrategy = strategyRecorder();
  const done = await orchestrateOneStepReplan({
    task: task('DONE'),
    stepResult: stepResult({ beforeTitle: 'BEFORE', afterTitle: 'DONE', mappedAction: 'submit' }),
    strategy: doneStrategy,
    startedAtMs: 1000,
    nowMs: 1100
  });
  assert.equal(done.control.status, 'done');
  assert.equal(done.budget.terminal, true);
  assert.equal(done.replan.permitted, false);
  assert.equal(done.replan.strategyCallCount, 0);
  assert.equal(doneStrategy.calls.length, 0);

  const blockedStrategy = strategyRecorder();
  const blocked = await orchestrateOneStepReplan({
    task: task('NEVER'),
    stepResult: stepResult({ beforeTitle: 'BEFORE', afterTitle: 'AFTER' }),
    blocker: { active: true, reasonCode: 'human_verification_required' },
    strategy: blockedStrategy,
    startedAtMs: 1000,
    nowMs: 1100
  });
  assert.equal(blocked.control.status, 'blocked');
  assert.equal(blocked.budget.terminal, true);
  assert.equal(blocked.replan.strategyCallCount, 0);
  assert.equal(blockedStrategy.calls.length, 0);

  const exhaustedStrategy = strategyRecorder();
  const exhausted = await orchestrateOneStepReplan({
    task: task('NEVER'),
    stepResult: stepResult({ beforeTitle: 'BEFORE', afterTitle: 'AFTER' }),
    strategy: exhaustedStrategy,
    budgets: { maxSteps: 1, maxDurationMs: 10000, maxConsecutiveFailures: 2, maxReplans: 6, maxStalledSteps: 3 },
    startedAtMs: 1000,
    nowMs: 1100
  });
  assert.equal(exhausted.budget.status, 'failed');
  assert.equal(exhausted.budget.reasonCode, 'budget_max_steps_reached');
  assert.equal(exhausted.replan.strategyCallCount, 0);
  assert.equal(exhaustedStrategy.calls.length, 0);

  const continueStrategy = strategyRecorder();
  const continued = await orchestrateOneStepReplan({
    task: task('TARGET'),
    stepResult: stepResult({ beforeTitle: 'BEFORE', afterTitle: 'AFTER' }),
    strategy: continueStrategy,
    budgets: { maxSteps: 8, maxDurationMs: 10000, maxConsecutiveFailures: 2, maxReplans: 6, maxStalledSteps: 3 },
    startedAtMs: 1000,
    nowMs: 1100
  });
  assert.equal(continued.control.status, 'continue');
  assert.equal(continued.budget.terminal, false);
  assert.equal(continued.budget.shouldReplan, true);
  assert.equal(continued.replan.permitted, true);
  assert.equal(continued.replan.attempted, true);
  assert.equal(continued.replan.strategyCallCount, 1);
  assert.equal(continueStrategy.calls.length, 1);
  assert.equal(continued.replan.observationSource, 'settled-after');
  assert.equal(continued.replan.observationId, 'obs-after');
  assert.equal(continued.replan.decision.status, 'act');
  assert.equal(continued.invariant.nextActionExecuted, false);

  let observeCalls = 0;
  const browserStrategy = strategyRecorder({ status: 'done', reasonCode: 'strategy_terminal' });
  const browserStep = stepResult({ beforeTitle: 'BEFORE', after: false, mappedAction: 'switchTab' });
  browserStep.beforeBrowserContext = { capturedAt: 1000, tabs: [{ tabId: 1, active: true, title: 'A', url: 'https://a.test/' }] };
  browserStep.afterBrowserContext = { capturedAt: 1100, tabs: [{ tabId: 2, active: true, title: 'B', url: 'https://b.test/' }] };
  const browser = await orchestrateOneStepReplan({
    task: task('TARGET'),
    stepResult: browserStep,
    strategy: browserStrategy,
    observeForReplan: async () => {
      observeCalls += 1;
      return page('obs-fresh', 'B');
    },
    startedAtMs: 1000,
    nowMs: 1100
  });
  assert.equal(observeCalls, 1);
  assert.equal(browser.replan.strategyCallCount, 1);
  assert.equal(browser.replan.observationSource, 'fresh-observe');
  assert.equal(browser.replan.observationId, 'obs-fresh');

  const failingStrategy = {
    calls: 0,
    async decide() {
      this.calls += 1;
      throw new Error('provider_down');
    }
  };
  const failedDecision = await orchestrateOneStepReplan({
    task: task('TARGET'),
    stepResult: stepResult({ beforeTitle: 'BEFORE', afterTitle: 'AFTER' }),
    strategy: failingStrategy,
    startedAtMs: 1000,
    nowMs: 1100
  });
  assert.equal(failingStrategy.calls, 1);
  assert.equal(failedDecision.replan.strategyCallCount, 1);
  assert.equal(failedDecision.replan.errorCode, 'replan_strategy_failed');
  assert.equal(failedDecision.replan.decision, null);
  assert.equal(failedDecision.invariant.boundedStrategyCalls, true);

  console.log('A5.4 explicit bounded one-step replan contract: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
