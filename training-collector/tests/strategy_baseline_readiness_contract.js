'use strict';

const assert = require('assert');
const { evaluateBaselineReadiness } = require('../tools/check_strategy_baseline_readiness.js');

function episode(id, splitGroup, actionType) {
  return {
    episodeId: id,
    splitGroup,
    steps: [{ stepIndex: 0, action: { type: actionType, targetRef: 'e1', args: {} } }]
  };
}

function main() {
  const ready = evaluateBaselineReadiness({
    train: [episode('t1', 'g1', 'click'), episode('t2', 'g2', 'play')],
    validation: [episode('v1', 'g3', 'click')],
    test: [episode('x1', 'g4', 'play')]
  });
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.unseenHeldOutActionTypes.validation, []);
  assert.deepEqual(ready.unseenHeldOutActionTypes.test, []);

  const blocked = evaluateBaselineReadiness({
    train: [episode('t1', 'g1', 'click')],
    validation: [episode('v1', 'g2', 'click')],
    test: [episode('x1', 'g3', 'dismiss')]
  });
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.unseenHeldOutActionTypes.test, ['dismiss']);
  assert.ok(blocked.errors.some(x => x.includes('test_action_types_unseen_in_train:dismiss')));

  console.log('Strategy baseline readiness contract: PASS');
}

main();
