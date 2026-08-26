'use strict';

const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { runOneAction } = require('../manager/agent/one_action_bridge.js');
const { evaluateGoal } = require('../manager/goal/goal_checker.js');
const { reduceOutcomeToControl } = require('../manager/goal/outcome_controller.js');
const { evaluateEpisodeBudget } = require('../manager/goal/episode_budget.js');
const { buildEpisodeRecord, validateDataset } = require('../manager/training/episode_outcome_dataset.js');
const {
  parseArgs,
  discoverRuntimeAgent,
  resolveCommandTabId,
  chooseTarget
} = require('./agent_one_action.js');

const DEFAULT_BUDGETS = Object.freeze({
  maxSteps: 8,
  maxDurationMs: 120000,
  maxConsecutiveFailures: 2,
  maxReplans: 6,
  maxStalledSteps: 3
});

function goalInput(task, step) {
  return {
    task,
    before: step.before || null,
    after: step.after || null,
    beforeBrowserContext: step.beforeBrowserContext || null,
    afterBrowserContext: step.afterBrowserContext || null,
    execution: step.execution
  };
}

function progressFor(outcome) {
  return {
    before: Number(outcome?.metadata?.progressBefore || 0),
    after: Number(outcome?.progress || 0),
    delta: Number(outcome?.metadata?.progressDelta || 0)
  };
}

function datasetStep(stepIndex, nativeStep, outcome, control, budget) {
  return {
    stepIndex,
    observation: nativeStep.before,
    decision: nativeStep.decision,
    action: nativeStep.decision?.action,
    outcome,
    control,
    budget,
    progress: progressFor(outcome)
  };
}

async function executeControlledStep({ runtime, tabId, type, label }) {
  return runOneAction({
    runtime: {
      observe: () => runtime.observe(tabId),
      listTabs: scope => runtime.listTabs(scope),
      executePlan: payload => runtime.executePlan({ ...payload, tabId }),
      executeBrowserAction: payload => runtime.executeBrowserAction({ ...payload, tabId })
    },
    decide: async observation => {
      const target = chooseTarget(observation, { label });
      if (!target) throw new Error(`episode_dataset_target_not_found:${label}`);
      return {
        status: 'act',
        reasonCode: type === 'submit' ? 'controlled_submit' : 'controlled_move_to',
        action: {
          type,
          targetRef: target.ref,
          args: {}
        }
      };
    }
  });
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const healthBase = args['health-base'] || 'http://127.0.0.1:3000';
  const agentId = args.agent || await discoverRuntimeAgent(healthBase);
  const runtime = createBrokerRuntimeClient({
    url: args.broker || 'ws://127.0.0.1:3000',
    agentId,
    timeoutMs: Number(args.timeout || 10000)
  });

  try {
    const tabId = await resolveCommandTabId(runtime, {
      ...args,
      'url-includes': args['url-includes'] || '127.0.0.1:8091'
    });
    const label = args.label || 'Submit Target';
    const task = {
      taskId: `episode-dataset-native-${Date.now()}`,
      type: 'controlled-episode-outcome-validation',
      instruction: 'Reach SUBMIT PASS with two explicit controlled actions',
      successCriteria: [
        { type: 'page', field: 'title', operator: 'equals', value: 'SUBMIT PASS' }
      ],
      constraints: {},
      metadata: { controlledSurface: 'page-cdp-batch-lab' }
    };
    const startedAtMs = Date.now();
    let history = [];

    const firstStep = await executeControlledStep({ runtime, tabId, type: 'moveTo', label });
    const firstOutcome = evaluateGoal(goalInput(task, firstStep));
    const firstControl = reduceOutcomeToControl({ outcome: firstOutcome });
    const firstBudget = evaluateEpisodeBudget({
      history,
      control: firstControl,
      actionType: firstStep.mappedAction?.type || 'moveTo',
      budgets: DEFAULT_BUDGETS,
      startedAtMs,
      nowMs: Date.now()
    });
    history = firstBudget.history;

    const secondStep = await executeControlledStep({ runtime, tabId, type: 'submit', label });
    const secondOutcome = evaluateGoal(goalInput(task, secondStep));
    const secondControl = reduceOutcomeToControl({ outcome: secondOutcome });
    const secondBudget = evaluateEpisodeBudget({
      history,
      control: secondControl,
      actionType: secondStep.mappedAction?.type || 'submit',
      budgets: DEFAULT_BUDGETS,
      startedAtMs,
      nowMs: Date.now()
    });

    const recordInput = {
      episodeId: `native-episode-${Date.now()}`,
      source: {
        kind: 'controlled-native',
        labelVerified: true,
        outcomeVerified: true,
        provenanceId: `agent:${agentId}:controlled-8091`,
        collectedAt: new Date().toISOString()
      },
      task,
      steps: [
        datasetStep(0, firstStep, firstOutcome, firstControl, firstBudget),
        datasetStep(1, secondStep, secondOutcome, secondControl, secondBudget)
      ],
      terminalResult: {
        status: 'done',
        reasonCode: secondBudget.reasonCode || secondControl.reasonCode,
        taskSucceeded: secondOutcome.taskSucceeded === true,
        finalProgress: Number(secondOutcome.progress || 0),
        verified: true
      },
      split: 'unassigned',
      splitGroup: 'controlled-8091-submit-flow',
      privacy: {
        redacted: true,
        credentialsExcluded: true,
        secretsExcluded: true,
        policyVersion: '0.1.0-controlled-native'
      }
    };

    const record = buildEpisodeRecord(recordInput);
    const dataset = validateDataset([recordInput]);
    const serialized = JSON.stringify(record);
    const pass = (
      firstStep.execution?.ok === true &&
      firstOutcome.actionSucceeded === true &&
      firstOutcome.taskSucceeded === false &&
      firstControl.status === 'continue' &&
      firstControl.terminal === false &&
      firstBudget.terminal === false &&
      secondStep.execution?.ok === true &&
      secondOutcome.actionSucceeded === true &&
      secondOutcome.taskSucceeded === true &&
      secondControl.status === 'done' &&
      secondControl.terminal === true &&
      secondBudget.status === 'done' &&
      secondBudget.terminal === true &&
      record.steps.length === 2 &&
      record.terminalResult.status === 'done' &&
      record.terminalResult.taskSucceeded === true &&
      record.terminalResult.finalProgress === 1 &&
      record.trainingEligibility.eligible === false &&
      record.trainingEligibility.reasons.includes('source_kind_not_training_eligible') &&
      record.trainingEligibility.reasons.includes('split_not_train') &&
      dataset.ok === true &&
      dataset.summary.valid === 1 &&
      dataset.summary.trainingEligible === 0 &&
      !serialized.includes('"selector"') &&
      !serialized.includes('"cdpPlan"') &&
      !serialized.includes('"tabId"')
    );

    console.log(JSON.stringify({
      ok: pass,
      gate: 'episode-outcome-dataset-native',
      result: pass ? 'PASS' : 'FAIL',
      agentId,
      tabId,
      flow: ['moveTo', 'submit'],
      first: {
        executionOk: firstStep.execution?.ok === true,
        actionSucceeded: firstOutcome.actionSucceeded,
        taskSucceeded: firstOutcome.taskSucceeded,
        progress: firstOutcome.progress,
        controlStatus: firstControl.status,
        budgetTerminal: firstBudget.terminal
      },
      second: {
        executionOk: secondStep.execution?.ok === true,
        actionSucceeded: secondOutcome.actionSucceeded,
        taskSucceeded: secondOutcome.taskSucceeded,
        progress: secondOutcome.progress,
        controlStatus: secondControl.status,
        budgetTerminal: secondBudget.terminal
      },
      record: {
        contractVersion: record.contractVersion,
        episodeId: record.episodeId,
        stepCount: record.steps.length,
        terminalResult: record.terminalResult,
        split: record.split,
        splitGroup: record.splitGroup,
        trainingEligibility: record.trainingEligibility,
        privacy: record.privacy,
        sanitizedUrls: record.steps.map(item => ({
          url: item.observation.url,
          urlQueryKeys: item.observation.urlQueryKeys
        }))
      },
      dataset: dataset.summary,
      invariant: {
        deterministicHarnessOnly: true,
        autonomousMultiStepEnabled: false,
        controlledNativeRecordNotTrainingEligible: record.trainingEligibility.eligible === false,
        noSelectorStored: !serialized.includes('"selector"'),
        noCdpPlanStored: !serialized.includes('"cdpPlan"'),
        noTabIdStoredInTrainingRecord: !serialized.includes('"tabId"')
      }
    }, null, 2));

    if (!pass) process.exitCode = 1;
  } finally {
    runtime.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({
      ok: false,
      gate: 'episode-outcome-dataset-native',
      result: 'ERROR',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = { main, goalInput, progressFor, datasetStep, executeControlledStep };
