'use strict';

const assert = require('assert');
const {
  TASKS,
  REQUIRED_PER_TASK,
  taskKey,
  selectExpansion,
  findSemanticTransition
} = require('../tools/process_strategy_smoke_expansion.js');

function review(key, episodeId, stamp) {
  const cfg = TASKS[key];
  return {
    episodeId,
    exportedAt: new Date(stamp).toISOString(),
    task: { instruction: key },
    finalOutcome: { status: 'success' },
    strategyReady: true,
    transitions: [{
      transitionId: `${episodeId}-noise`,
      status: 'complete',
      rawAction: { kind: 'click', targetRef: 'noise' },
      strategyObservationBefore: {
        interactiveElements: [{ ref: 'noise', label: 'Unrelated' }]
      }
    }, {
      transitionId: `${episodeId}-semantic`,
      status: 'complete',
      rawAction: { kind: 'click', targetRef: 'target' },
      strategyObservationBefore: {
        interactiveElements: [{ ref: 'target', label: cfg.targetLabel }]
      }
    }]
  };
}

function main() {
  assert.equal(REQUIRED_PER_TASK, 2);
  assert.equal(taskKey({ task: { instruction: 'click' } }), 'click');
  assert.equal(taskKey({ task: { instruction: 'Play Media' } }), null);

  const items = [];
  let stamp = Date.parse('2026-08-27T00:00:00.000Z');
  for (const key of Object.keys(TASKS)) {
    for (let i = 0; i < 2; i += 1) {
      const r = review(key, `${key}-${i}`, stamp++);
      items.push({ key, file: `${key}-${i}.json`, review: r, stamp: Date.parse(r.exportedAt) });
    }
  }
  const extraDismiss = review('dismiss', 'dismiss-reserve', stamp++);
  items.push({ key: 'dismiss', file: 'dismiss-reserve.json', review: extraDismiss, stamp: Date.parse(extraDismiss.exportedAt) });

  const selection = selectExpansion(items, 2);
  assert.equal(selection.selected.length, 12);
  assert.equal(selection.reserve.length, 1);
  assert.equal(selection.reserve[0].review.episodeId, 'dismiss-reserve');

  for (const key of Object.keys(TASKS)) {
    assert.equal(selection.selected.filter(item => item.key === key).length, 2);
    for (const item of selection.selected.filter(row => row.key === key)) {
      const hit = findSemanticTransition(item.review, TASKS[key]);
      assert.equal(hit.transitionId, `${item.review.episodeId}-semantic`);
    }
  }

  assert.equal(TASKS.click.splitGroup, '8091-submit-target-click-v1');
  assert.equal(TASKS.dismiss.splitGroup, '8091-dismiss-target-v1');
  assert.equal(TASKS.play.splitGroup, '8091-media-play-v1');
  assert.equal(TASKS.pause.splitGroup, '8091-media-pause-v1');
  assert.equal(TASKS.mute.splitGroup, '8091-media-mute-v1');
  assert.equal(TASKS.unmute.splitGroup, '8091-media-unmute-v1');

  console.log('Strategy smoke expansion contract: PASS');
}

main();
