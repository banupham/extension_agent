'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseJsonRecords,
  readRecords,
  buildDatasetFromRecords,
  writeDatasetPackage
} = require('../tools/build_strategy_episode_dataset.js');

function episode(id, splitGroup, split = 'unassigned') {
  const action = { type: 'submit', targetRef: 'e1', args: {} };
  return {
    episodeId: id,
    source: {
      kind: 'approved-controller',
      labelVerified: true,
      outcomeVerified: true,
      provenanceId: `prov-${id}`
    },
    task: {
      taskId: `task-${id}`,
      type: 'test',
      instruction: 'Reach SUBMIT PASS',
      args: {},
      successCriteria: [],
      constraints: {},
      metadata: {}
    },
    steps: [{
      stepIndex: 0,
      observation: {
        observationId: `obs-${id}`,
        capturedAt: '2026-08-27T00:00:00.000Z',
        url: 'https://example.test/lab?q=private#fragment',
        title: 'Lab',
        viewport: { width: 1000, height: 700 },
        scroll: { x: 0, y: 0 },
        focusedElement: null,
        interactiveElements: [{
          ref: 'e1', role: 'button', label: 'Submit Target',
          rect: { x: 10, y: 20, width: 100, height: 40 }, visible: true, enabled: true
        }],
        pageSignals: {},
        privacy: { redacted: true }
      },
      decision: { status: 'act', reasonCode: 'verified_submit', action },
      action,
      outcome: {
        actionSucceeded: true,
        taskSucceeded: true,
        progress: 1,
        evidence: [],
        errorCode: null,
        metadata: { progressBefore: 0, progressDelta: 1 }
      },
      control: {
        status: 'done', terminal: true, shouldReplan: false,
        reasonCode: 'goal_satisfied', errorCode: null
      },
      budget: {
        status: 'done', terminal: true, shouldReplan: false,
        reasonCode: 'goal_satisfied',
        usage: { steps: 1, replansRequested: 0, consecutiveFailures: 0, stalledSteps: 0, elapsedMs: 50 }
      },
      progress: { before: 0, after: 1, delta: 1 }
    }],
    terminalResult: {
      status: 'done', reasonCode: 'goal_satisfied',
      taskSucceeded: true, finalProgress: 1, verified: true
    },
    split,
    splitGroup,
    privacy: {
      redacted: true,
      credentialsExcluded: true,
      secretsExcluded: true,
      policyVersion: '0.1.0-test'
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
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-dataset-'));
  try {
    const records = [
      episode('ep-a', 'group-a'),
      episode('ep-b', 'group-b'),
      episode('ep-c', 'group-c')
    ];
    const input = path.join(temp, 'episodes.jsonl');
    fs.writeFileSync(input, records.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');

    const parsed = parseJsonRecords(fs.readFileSync(input, 'utf8'), input);
    assert.equal(parsed.length, 3);
    const loaded = readRecords(input);
    assert.equal(loaded.records.length, 3);
    assert.equal(loaded.files.length, 1);

    const result = buildDatasetFromRecords(loaded.records, {
      seed: 'cli-contract-seed',
      createdAt: '2026-08-27T00:00:00.000Z'
    });
    assert.equal(result.state, 'unassigned');
    assert.equal(result.package.manifest.splitCounts.train, 1);
    assert.equal(result.package.manifest.splitCounts.validation, 1);
    assert.equal(result.package.manifest.splitCounts.test, 1);

    const output = path.join(temp, 'out');
    const written = writeDatasetPackage(output, result, { inputFiles: loaded.files });
    assert.equal(fs.existsSync(written.files.train), true);
    assert.equal(fs.existsSync(written.files.validation), true);
    assert.equal(fs.existsSync(written.files.test), true);
    assert.equal(fs.existsSync(written.files.manifest), true);
    assert.equal(fs.readFileSync(written.files.train, 'utf8').trim().split('\n').length, 1);
    assert.equal(fs.readFileSync(written.files.validation, 'utf8').trim().split('\n').length, 1);
    assert.equal(fs.readFileSync(written.files.test, 'utf8').trim().split('\n').length, 1);

    const manifest = JSON.parse(fs.readFileSync(written.files.manifest, 'utf8'));
    assert.equal(manifest.splitCounts.train, 1);
    assert.equal(Object.keys(manifest.splitAssignment.assignments).length, 3);
    assert.equal(JSON.stringify(manifest).includes('private'), false);

    const mixed = [
      episode('mixed-a', 'mixed-a', 'train'),
      episode('mixed-b', 'mixed-b', 'unassigned'),
      episode('mixed-c', 'mixed-c', 'test')
    ];
    mustThrow(() => buildDatasetFromRecords(mixed), 'must not mix assigned and unassigned');

    console.log('Strategy episode dataset CLI contract: PASS');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main();
