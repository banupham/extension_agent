'use strict';

const assert = require('assert');
const {
  createMissionPlan,
  createMissionController,
  missionProgress,
  splitMissionInstruction
} = require('../../manager/mission/mission_plan.js');

function main() {
  const instruction = [
    'Hôm nay cần lên YouTube, xem các video theo chủ đề AI và tương tác theo ngữ cảnh',
    'sau đó lên Google kiểm tra thời tiết ở thành phố Hồ Chí Minh trong 3 ngày tới',
    'cuối cùng lên Facebook và khám phá các tính năng phù hợp'
  ].join('; ');

  const clauses = splitMissionInstruction(instruction);
  assert.equal(clauses.length, 3);
  assert(clauses[0].includes('YouTube'));
  assert(clauses[1].includes('Google'));
  assert(clauses[2].includes('Facebook'));

  const plan = createMissionPlan({ missionId: 'mission-demo', instruction });
  assert.equal(plan.subgoals.length, 3);
  assert.deepEqual(plan.subgoals.map(item => item.order), [0, 1, 2]);
  assert(plan.subgoals.every(item => item.status === 'pending'));
  assert.equal(plan.metadata.semanticIntentResolution, false, 'prototype must not pretend full semantic NLU');

  const controller = createMissionController(plan);
  assert.equal(controller.progress().progress, 0);
  assert.equal(controller.startNext().subgoalId, 'mission-demo:sg-1');
  assert.equal(controller.startNext().subgoalId, 'mission-demo:sg-1', 'starting while active should be idempotent');
  let progress = controller.finishCurrent('done');
  assert.equal(progress.done, 1);
  assert.equal(progress.progress, 1 / 3);

  assert.equal(controller.startNext().subgoalId, 'mission-demo:sg-2');
  progress = controller.finishCurrent('done');
  assert.equal(progress.done, 2);

  assert.equal(controller.startNext().subgoalId, 'mission-demo:sg-3');
  progress = controller.finishCurrent('done');
  assert.equal(progress.done, 3);
  assert.equal(progress.missionDone, true);
  assert.equal(progress.missionTerminal, true);
  assert.equal(missionProgress(controller.getPlan()).progress, 1);

  const arbitrary = splitMissionInstruction('Mở hệ thống A rồi kiểm tra mục B, tiếp theo xử lý mục C, cuối cùng xác nhận kết quả D');
  assert.deepEqual(arbitrary, ['Mở hệ thống A', 'kiểm tra mục B', 'xử lý mục C', 'xác nhận kết quả D']);

  console.log('Hierarchical mission plan contract: PASS');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('Hierarchical mission plan contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { main };
