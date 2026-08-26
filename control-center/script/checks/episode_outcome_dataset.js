'use strict';

const assert = require('assert');
const {
  sanitizeUrl,
  buildEpisodeRecord,
  validateDataset,
  exportTrainRecords
} = require('../../manager/training/episode_outcome_dataset.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function task() {
  return {
    taskId: 'episode-dataset-task',
    type: 'controlled-test',
    instruction: 'Reach SUBMIT PASS',
    args: {},
    successCriteria: [
      { type: 'page', field: 'title', operator: 'equals', value: 'SUBMIT PASS' }
    ],
    constraints: {},
    metadata: {}
  };
}

function observation(id, url = 'http://127.0.0.1:8091/?private=secret#fragment') {
  return {
    observationId: id,
    capturedAt: '2026-08-27T00:00:00.000Z',
    url,
    title: 'PAGE_CDP Batch Lab',
    viewport: { width: 1200, height: 800 },
    scroll: { x: 0, y: 0 },
    focusedElement: null,
    interactiveElements: [
      {
        ref: 'e3',
        role: 'button',
        label: 'Submit Target',
        rect: { x: 100, y: 200, width: 120, height: 40 },
        visible: true,
        enabled: true
      }
    ],
    pageSignals: {},
    privacy: { redacted: true }
  };
}

function semanticDecision(type) {
  return {
    status: 'act',
    reasonCode: type === 'submit' ? 'goal_unmet_choose_submit' : 'initial_move',
    action: {
      type,
      targetRef: 'e3',
      args: {}
    }
  };
}

function outcome({ taskSucceeded = false, progress = 0, before = 0, delta = 0, actionSucceeded = true } = {}) {
  return {
    actionSucceeded,
    taskSucceeded,
    progress,
    evidence: [],
    errorCode: actionSucceeded ? null : 'execution_failed',
    metadata: {
      progressBefore: before,
      progressDelta: delta
    }
  };
}

function control(status) {
  if (status === 'done') {
    return { status: 'done', terminal: true, shouldReplan: false, reasonCode: 'goal_satisfied', errorCode: null };
  }
  if (status === 'blocked') {
    return { status: 'blocked', terminal: true, shouldReplan: false, reasonCode: 'human_verification_required', errorCode: null };
  }
  if (status === 'failed') {
    return { status: 'failed', terminal: false, shouldReplan: true, reasonCode: 'action_failed', errorCode: 'execution_failed' };
  }
  return { status: 'continue', terminal: false, shouldReplan: true, reasonCode: 'goal_not_yet_satisfied', errorCode: null };
}

function budget(status, stepIndex) {
  if (status === 'done') {
    return {
      status: 'done', terminal: true, shouldReplan: false, reasonCode: 'goal_satisfied',
      usage: { steps: stepIndex + 1, replansRequested: stepIndex, consecutiveFailures: 0, stalledSteps: 0, elapsedMs: 200 }
    };
  }
  if (status === 'failed') {
    return {
      status: 'failed', terminal: true, shouldReplan: false, reasonCode: 'budget_max_steps_reached',
      usage: { steps: stepIndex + 1, replansRequested: stepIndex + 1, consecutiveFailures: 1, stalledSteps: 1, elapsedMs: 200 }
    };
  }
  if (status === 'blocked') {
    return {
      status: 'blocked', terminal: true, shouldReplan: false, reasonCode: 'human_verification_required',
      usage: { steps: stepIndex + 1, replansRequested: stepIndex, consecutiveFailures: 0, stalledSteps: 0, elapsedMs: 200 }
    };
  }
  return {
    status: 'continue', terminal: false, shouldReplan: true, reasonCode: 'goal_not_yet_satisfied',
    usage: { steps: stepIndex + 1, replansRequested: stepIndex + 1, consecutiveFailures: 0, stalledSteps: 1, elapsedMs: 100 }
  };
}

function step({ index, type, status, beforeProgress, afterProgress, actionSucceeded = true }) {
  const decision = semanticDecision(type);
  const delta = afterProgress - beforeProgress;
  const isDone = status === 'done';
  return {
    stepIndex: index,
    observation: observation(`obs-${index}`),
    decision,
    action: clone(decision.action),
    outcome: outcome({
      actionSucceeded,
      taskSucceeded: isDone,
      progress: afterProgress,
      before: beforeProgress,
      delta
    }),
    control: control(status),
    budget: budget(status, index),
    progress: {
      before: beforeProgress,
      after: afterProgress,
      delta
    }
  };
}

function doneEpisode({ id = 'ep-done', split = 'train', splitGroup = 'group-train', sourceKind = 'approved-controller' } = {}) {
  return {
    episodeId: id,
    source: {
      kind: sourceKind,
      labelVerified: true,
      outcomeVerified: true,
      provenanceId: `prov-${id}`,
      collectedAt: '2026-08-27T00:00:00.000Z'
    },
    task: task(),
    steps: [
      step({ index: 0, type: 'moveTo', status: 'continue', beforeProgress: 0, afterProgress: 0 }),
      step({ index: 1, type: 'submit', status: 'done', beforeProgress: 0, afterProgress: 1 })
    ],
    terminalResult: {
      status: 'done',
      reasonCode: 'goal_satisfied',
      taskSucceeded: true,
      finalProgress: 1,
      verified: true
    },
    split,
    splitGroup,
    privacy: {
      redacted: true,
      credentialsExcluded: true,
      secretsExcluded: true,
      policyVersion: '0.1.0'
    }
  };
}

function failedEpisode({ id = 'ep-failed', split = 'validation', splitGroup = 'group-failed' } = {}) {
  const failedStep = step({
    index: 0,
    type: 'moveTo',
    status: 'failed',
    beforeProgress: 0,
    afterProgress: 0,
    actionSucceeded: false
  });
  failedStep.budget = budget('failed', 0);
  return {
    episodeId: id,
    source: {
      kind: 'approved-controller',
      labelVerified: true,
      outcomeVerified: true,
      provenanceId: `prov-${id}`
    },
    task: task(),
    steps: [failedStep],
    terminalResult: {
      status: 'failed',
      reasonCode: 'budget_max_steps_reached',
      taskSucceeded: false,
      finalProgress: 0,
      verified: true
    },
    split,
    splitGroup,
    privacy: {
      redacted: true,
      credentialsExcluded: true,
      secretsExcluded: true,
      policyVersion: '0.1.0'
    }
  };
}

function mustThrow(fn, expectedText) {
  let error = null;
  try { fn(); } catch (caught) { error = caught; }
  assert.ok(error, `expected error containing ${expectedText}`);
  assert.ok(String(error.message || error).includes(expectedText), String(error.message || error));
}

function main() {
  const safe = sanitizeUrl('https://example.test/search?q=private&token=secret#frag');
  assert.equal(safe.url, 'https://example.test/search');
  assert.deepEqual(safe.urlQueryKeys, ['q', 'token']);

  const eligible = buildEpisodeRecord(doneEpisode());
  assert.equal(eligible.contractVersion, '0.1.0');
  assert.equal(eligible.trainingEligibility.eligible, true);
  assert.deepEqual(eligible.trainingEligibility.reasons, []);
  assert.equal(eligible.steps[0].observation.url, 'http://127.0.0.1:8091/');
  assert.deepEqual(eligible.steps[0].observation.urlQueryKeys, ['private']);
  assert.equal(eligible.steps[0].observation.interactiveElements[0].rect.x, 100);
  assert.equal(eligible.steps[1].decision.action.contractVersion, '0.1.0');

  const fixture = buildEpisodeRecord(doneEpisode({ id: 'ep-fixture', sourceKind: 'test-fixture' }));
  assert.equal(fixture.trainingEligibility.eligible, false);
  assert.ok(fixture.trainingEligibility.reasons.includes('source_kind_not_training_eligible'));

  const controlled = buildEpisodeRecord(doneEpisode({ id: 'ep-controlled', sourceKind: 'controlled-native' }));
  assert.equal(controlled.trainingEligibility.eligible, false);

  const selectorLeak = doneEpisode({ id: 'ep-selector' });
  selectorLeak.steps[0].decision.action.selector = '#submit';
  mustThrow(() => buildEpisodeRecord(selectorLeak), 'forbidden fields');

  const coordinateLeak = doneEpisode({ id: 'ep-coordinate' });
  coordinateLeak.steps[0].decision.action.clickX = 10;
  mustThrow(() => buildEpisodeRecord(coordinateLeak), 'forbidden fields');

  const secretTask = doneEpisode({ id: 'ep-secret-task' });
  secretTask.task.args.password = 'do-not-store';
  mustThrow(() => buildEpisodeRecord(secretTask), 'forbidden fields');

  const progressMismatch = doneEpisode({ id: 'ep-progress-mismatch' });
  progressMismatch.steps[1].progress.delta = 0.5;
  mustThrow(() => buildEpisodeRecord(progressMismatch), 'progress.delta must equal');

  const goalMismatch = doneEpisode({ id: 'ep-goal-mismatch' });
  goalMismatch.steps[1].outcome.taskSucceeded = false;
  mustThrow(() => buildEpisodeRecord(goalMismatch), 'control.status=done requires');

  const failed = buildEpisodeRecord(failedEpisode());
  assert.equal(failed.terminalResult.status, 'failed');
  assert.equal(failed.trainingEligibility.eligible, false);
  assert.ok(failed.trainingEligibility.reasons.includes('split_not_train'));

  const leakage = validateDataset([
    doneEpisode({ id: 'ep-leak-train', split: 'train', splitGroup: 'shared-group' }),
    doneEpisode({ id: 'ep-leak-test', split: 'test', splitGroup: 'shared-group' })
  ]);
  assert.equal(leakage.ok, false);
  assert.equal(leakage.errors.length, 1);
  assert.ok(leakage.errors[0].error.includes('split leakage'));

  const dataset = validateDataset([
    doneEpisode({ id: 'ep-train', split: 'train', splitGroup: 'group-train' }),
    doneEpisode({ id: 'ep-validation', split: 'validation', splitGroup: 'group-validation' }),
    failedEpisode({ id: 'ep-test', split: 'test', splitGroup: 'group-test' })
  ]);
  assert.equal(dataset.ok, true);
  assert.equal(dataset.summary.total, 3);
  assert.equal(dataset.summary.trainingEligible, 1);
  assert.equal(dataset.summary.splitCounts.train, 1);
  assert.equal(dataset.summary.splitCounts.validation, 1);
  assert.equal(dataset.summary.splitCounts.test, 1);
  const trainRecords = exportTrainRecords(dataset);
  assert.equal(trainRecords.length, 1);
  assert.equal(trainRecords[0].episodeId, 'ep-train');

  console.log('Episode/outcome dataset contract: PASS');
}

main();
