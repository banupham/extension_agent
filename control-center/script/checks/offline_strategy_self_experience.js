'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildSuccessfulExperience,
  appendExperience,
  readExperienceMemory,
  createSelfExperienceProvider
} = require('../../manager/strategy/self_experience_memory.js');

function observation(id, title) {
  return {
    observationId: id,
    title,
    url: 'http://127.0.0.1:8091/',
    interactiveElements: [
      { ref: 'e6', label: 'Media Play', visible: true, enabled: true },
      { ref: 'e7', label: 'Media Pause', visible: true, enabled: true }
    ],
    privacy: { redacted: true }
  };
}

const task = {
  taskId: 'selfexp-fixture',
  type: 'controlled-test',
  instruction: 'Play the media, then pause it',
  successCriteria: [{ type: 'page', field: 'title', operator: 'equals', value: 'PAUSE PASS' }]
};

const successfulResult = {
  steps: [
    {
      action: { type: 'play', targetRef: 'e6', args: {} },
      before: observation('before-play', 'READY'),
      after: observation('after-play', 'PLAY PASS')
    },
    {
      action: { type: 'pause', targetRef: 'e7', args: {} },
      before: observation('before-pause', 'PLAY PASS'),
      after: observation('after-pause', 'PAUSE PASS')
    }
  ],
  finalOutcome: { taskSucceeded: true },
  finalControl: { status: 'done' },
  finalBudget: { terminal: true, reasonCode: 'goal_satisfied' }
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-selfexp-'));
  const memoryFile = path.join(dir, 'memory.jsonl');
  const experience = buildSuccessfulExperience({ task, result: successfulResult, learnedAt: '2026-08-27T00:00:00.000Z' });

  assert.deepStrictEqual(experience.sequence.map(step => step.type), ['play', 'pause']);
  assert.deepStrictEqual(experience.sequence.map(step => step.targetLabel), ['Media Play', 'Media Pause']);

  const firstAppend = appendExperience(memoryFile, experience);
  assert.equal(firstAppend.appended, true);
  const secondAppend = appendExperience(memoryFile, experience);
  assert.equal(secondAppend.appended, false);
  assert.equal(secondAppend.duplicate, true);

  const stored = readExperienceMemory(memoryFile);
  assert.equal(stored.length, 1);
  const storedText = fs.readFileSync(memoryFile, 'utf8');
  for (const forbidden of ['targetRef', 'selector', 'cdpPlan', 'tabId', 'clientX', 'rect', 'privateReasoning']) {
    assert.equal(storedText.includes(`\"${forbidden}\"`), false, `memory leaked ${forbidden}`);
  }

  let baseCalls = 0;
  const baseProvider = {
    name: 'fixture-base',
    version: '0.0.0',
    async decide() {
      baseCalls += 1;
      return { status: 'blocked', reasonCode: 'fixture_base_should_not_be_used_for_recall' };
    }
  };
  const provider = createSelfExperienceProvider({ baseProvider, memoryFile, minimumSimilarity: 0.8 });

  const first = await provider.decide({ task, observation: observation('recall-1', 'READY'), history: [] });
  assert.equal(first.status, 'act');
  assert.equal(first.action.type, 'play');
  assert.equal(first.action.targetRef, 'e6');
  assert.equal(first.metadata.prototypeSource, 'selfExperience');

  const second = await provider.decide({
    task,
    observation: observation('recall-2', 'PLAY PASS'),
    history: [{ actionType: 'play', controlStatus: 'continue' }]
  });
  assert.equal(second.status, 'act');
  assert.equal(second.action.type, 'pause');
  assert.equal(second.action.targetRef, 'e7');
  assert.equal(second.metadata.prototypeSource, 'selfExperience');
  assert.deepStrictEqual(second.metadata.learnedSequence, ['play', 'pause']);
  assert.equal(baseCalls, 0);

  const unrelated = await provider.decide({
    task: { ...task, instruction: 'Submit the form' },
    observation: observation('unrelated', 'READY'),
    history: []
  });
  assert.equal(unrelated.status, 'blocked');
  assert.equal(baseCalls, 1);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Offline Strategy self-experience memory contract: PASS');
})().catch(error => {
  console.error(`Offline Strategy self-experience memory contract: FAIL\n${error.stack || error}`);
  process.exitCode = 1;
});
