'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  GATE_VERSION,
  INITIAL_TITLE,
  PASS_TITLE,
  TARGET_LABEL,
  EXPECTED_ACTION_TYPES,
  EXPECTED_TARGET_LABELS,
  labHtml,
  createLabServer,
  listen,
  closeServer,
  makeTask,
  evaluateResult,
  withCleanupStatus,
  activeAnchorTab,
  waitForLab
} = require('../../control-center/script/offline_strategy_fresh_native_text_gate.js');

const SECRET = 'NATIVE-PRIVATE-CANARY-9182';

function observation(title = INITIAL_TITLE) {
  return {
    observationId: `obs-${title}`,
    title,
    url: 'http://127.0.0.1:9999/',
    interactiveElements: [
      { ref: 'e0', tag: 'input', role: null, label: 'Cargo Reference', editable: true },
      { ref: 'e1', tag: 'input', role: null, label: 'Crew Note', editable: true },
      { ref: 'e2', tag: 'input', role: null, label: TARGET_LABEL, editable: true },
      { ref: 'e3', tag: 'textarea', role: null, label: 'Destination Memo', editable: true },
      { ref: 'e4', tag: 'button', role: null, label: 'Route Cargo', editable: false }
    ]
  };
}

function step(index, type, afterTitle) {
  return {
    stepIndex: index,
    action: { type, targetRef: 'e2', args: {} },
    decision: {
      status: 'act',
      confidence: 0.55,
      reasonCode: 'offline_baseline_prototype_match',
      metadata: {
        prototypeSource: 'historyPrototypes',
        historyMatched: true,
        actionSelectionTargetIndependent: true
      }
    },
    transientPayload: type === 'typeText'
      ? { applied: true, redacted: true, keys: ['text'] }
      : { applied: false, redacted: true, keys: [] },
    before: observation(index === 0 ? INITIAL_TITLE : 'TYPED'),
    after: observation(afterTitle)
  };
}

function passingResult() {
  return {
    steps: [step(0, 'typeText', 'TYPED'), step(1, 'submit', PASS_TITLE)],
    finalOutcome: { taskSucceeded: true },
    finalBudget: { reasonCode: 'goal_satisfied' },
    invariant: {
      literalTrajectoryReplay: false,
      selectorUsedByStrategy: false,
      transientPayloadRedacted: true
    }
  };
}

function strategyMeta() {
  return {
    provider: { name: 'offline-semantic-prototype-baseline', version: '0.3.3' },
    model: { loaded: true, source: 'file', modelVersion: '0.3.3' }
  };
}

async function main() {
  assert.equal(GATE_VERSION, '0.1.0');
  assert.deepStrictEqual([...EXPECTED_ACTION_TYPES], ['typeText', 'submit']);
  assert.deepStrictEqual([...EXPECTED_TARGET_LABELS], [TARGET_LABEL, TARGET_LABEL]);

  const html = labHtml();
  assert.ok(html.includes(`aria-label="${TARGET_LABEL}"`));
  assert.ok(html.includes('aria-label="Cargo Reference"'));
  assert.ok(html.includes('aria-label="Crew Note"'));
  assert.ok(html.includes('aria-label="Destination Memo"'));
  assert.ok(html.includes('aria-label="Route Cargo"'));
  assert.ok(html.includes(PASS_TITLE));
  assert.equal(html.includes(SECRET), false);

  const task = makeTask();
  assert.ok(task.instruction.includes(TARGET_LABEL));
  assert.ok(task.instruction.toLowerCase().includes('press enter'));
  assert.deepStrictEqual(task.args, {});
  assert.equal(JSON.stringify(task).includes(SECRET), false);

  const source = fs.readFileSync(path.join(__dirname, '../../control-center/script/offline_strategy_fresh_native_text_gate.js'), 'utf8');
  assert.equal(source.includes('fit_strategy_offline_baseline'), false, 'fresh native gate must not import fitter');
  assert.equal(source.includes('selector:'), false, 'fresh native Strategy gate must not hardcode selector targeting');

  const summary = evaluateResult(passingResult(), strategyMeta(), 'same-hash', 'same-hash', SECRET);
  assert.equal(summary.ok, true);
  assert.equal(summary.result, 'PASS');
  assert.deepStrictEqual(summary.actualActionTypes, ['typeText', 'submit']);
  assert.deepStrictEqual(summary.actualTargetLabels, [TARGET_LABEL, TARGET_LABEL]);
  assert.equal(summary.invariant.frozenModelOnly, true);
  assert.equal(summary.invariant.modelLoadedFromFile, true);
  assert.equal(summary.invariant.modelFileMutated, false);
  assert.equal(summary.invariant.publicResultContainsTransientText, false);
  assert.equal(JSON.stringify(summary).includes(SECRET), false);

  const cleaned = withCleanupStatus(summary, true);
  assert.equal(cleaned.ok, true);
  assert.equal(cleaned.createdTabClosed, true);
  const leakedCleanup = withCleanupStatus(summary, false);
  assert.equal(leakedCleanup.ok, false);
  assert.ok(leakedCleanup.errors.includes('created_tab_cleanup_failed'));

  const leaked = passingResult();
  leaked.steps[0].execution = { echoedText: SECRET };
  const leakSummary = evaluateResult(leaked, strategyMeta(), 'same-hash', 'same-hash', SECRET);
  assert.equal(leakSummary.ok, false);
  assert.ok(leakSummary.errors.includes('transient_text_leaked_to_public_result'));

  const mutatedSummary = evaluateResult(passingResult(), strategyMeta(), 'before', 'after', SECRET);
  assert.equal(mutatedSummary.ok, false);
  assert.ok(mutatedSummary.errors.includes('model_file_mutated'));

  assert.equal(await activeAnchorTab({ listTabs: async () => [{ tabId: 7, active: true }] }), 7);
  await assert.rejects(
    () => activeAnchorTab({ listTabs: async () => [] }),
    /fresh_native_anchor_tab_required/
  );

  const fakeClient = {
    async observe() {
      return { observationId: 'ready', url: 'http://127.0.0.1:9999/', title: INITIAL_TITLE };
    }
  };
  const ready = await waitForLab(fakeClient, 9, 'http://127.0.0.1:9999/', 100);
  assert.equal(ready.title, INITIAL_TITLE);

  const server = createLabServer();
  try {
    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/`, { cache: 'no-store' });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(body.includes(TARGET_LABEL));
    assert.ok(body.includes(PASS_TITLE));
  } finally {
    await closeServer(server);
  }

  console.log('Strategy fresh native text gate contract: PASS');
}

if (require.main === module) {
  main().catch(error => {
    console.error('Strategy fresh native text gate contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { SECRET, observation, step, passingResult, strategyMeta, main };
