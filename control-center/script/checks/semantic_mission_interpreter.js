'use strict';

const assert = require('assert');
const { createMissionPlan } = require('../../manager/mission/mission_plan.js');
const {
  createSemanticMissionInterpreter,
  heuristicInterpretSubgoal
} = require('../../manager/mission/semantic_mission_interpreter.js');

async function main() {
  const plan = createMissionPlan({
    missionId: 'semantic-demo',
    instruction: [
      'Hôm nay cần lên YouTube, xem video theo chủ đề AI và tương tác theo ngữ cảnh',
      'sau đó lên Google kiểm tra thời tiết ở thành phố Hồ Chí Minh trong 3 ngày tới',
      'cuối cùng lên Facebook và khám phá các tính năng phù hợp'
    ].join('; ')
  });

  const interpreter = createSemanticMissionInterpreter();
  const semantic = await interpreter.interpretPlan(plan);
  assert.equal(semantic.subgoals.length, 3);

  const first = semantic.subgoals[0];
  assert.equal(first.destination, 'YouTube');
  assert(first.goalKinds.includes('navigate'));
  assert(first.goalKinds.includes('consume_content'));
  assert(first.goalKinds.includes('interact_contextually'));
  assert.equal(first.topic, 'AI');
  assert.equal(first.interactionPolicy.mode, 'contextual');
  assert.equal(first.interactionPolicy.externalImpactRequiresExplicitConstraint, true);

  const second = semantic.subgoals[1];
  assert.equal(second.destination, 'Google');
  assert(second.goalKinds.includes('retrieve_information'));
  assert.equal(second.location, 'thành phố Hồ Chí Minh');
  assert.equal(second.temporalWindow.amount, 3);
  assert.equal(second.temporalWindow.unit, 'day');
  assert.equal(second.temporalWindow.direction, 'future');

  const third = semantic.subgoals[2];
  assert.equal(third.destination, 'Facebook');
  assert(third.goalKinds.includes('explore_interface'));
  assert.equal(third.interactionPolicy.externalImpactRequiresExplicitConstraint, true);

  const generic = heuristicInterpretSubgoal({
    subgoalId: 'generic',
    instruction: 'Mở Atlas, xem nội dung về robotics và khám phá các tính năng phù hợp'
  });
  assert.equal(generic.destination, 'Atlas');
  assert.equal(generic.topic, 'robotics');
  assert(generic.goalKinds.includes('navigate'));
  assert(generic.goalKinds.includes('consume_content'));
  assert(generic.goalKinds.includes('explore_interface'));

  let customCalls = 0;
  const custom = createSemanticMissionInterpreter({
    provider: {
      name: 'custom-semantic-provider',
      version: '9.9.9',
      async interpretSubgoal({ subgoal }) {
        customCalls += 1;
        return {
          instruction: subgoal.instruction,
          goalKinds: ['retrieve_information'],
          destination: 'ProviderDestination',
          completionHints: ['provider_verified'],
          confidence: 0.9,
          interpretationSource: 'custom-semantic-provider'
        };
      }
    }
  });
  const customResult = await custom.interpretPlan(createMissionPlan({ missionId: 'provider', instruction: 'Do opaque work' }));
  assert.equal(customCalls, 1);
  assert.equal(customResult.subgoals[0].destination, 'ProviderDestination');
  assert.equal(customResult.subgoals[0].confidence, 0.9);

  console.log('Semantic mission interpreter contract: PASS');
}

if (require.main === module) {
  main().catch(error => {
    console.error('Semantic mission interpreter contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { main };
