'use strict';

const assert = require('assert');
const {
  semanticGoalStateFor,
  semanticCriteriaFor,
  heuristicResolveSubgoalTask,
  createSemanticGoalResolver
} = require('../../manager/mission/semantic_goal_resolver.js');

async function main() {
  const semantic = {
    goalKinds: ['navigate', 'consume_content', 'interact_contextually'],
    destination: 'YouTube',
    topic: 'AI'
  };
  const state = semanticGoalStateFor(semantic);
  assert.equal(state.destinationReached, 'YouTube');
  assert.equal(state.relevantContentObserved, 'AI');
  assert.equal(state.contextualInteractionCompleted, true);

  const resolved = semanticCriteriaFor(semantic);
  assert.deepEqual(resolved.criteria, [
    { type: 'page', field: 'url', operator: 'includes', value: 'youtube' },
    { type: 'element', match: { labelIncludes: 'AI' }, expect: { exists: true, visible: true } },
    { type: 'pageSignal', key: 'contextualInteractionCompleted', operator: 'equals', value: true }
  ]);

  const task = heuristicResolveSubgoalTask({
    subgoal: { subgoalId: 'sg-1', instruction: 'Mở YouTube, xem nội dung AI và tương tác theo ngữ cảnh' },
    semantic
  });
  assert.equal(task.successCriteria.length, 3);
  assert.equal(task.metadata.titlePassCriterionRequired, false);
  assert.equal(task.metadata.semanticGoalState.destinationReached, 'YouTube');
  assert.equal(task.successCriteria.some(item => item.type === 'page' && item.field === 'title'), false);

  const retrieve = semanticCriteriaFor({
    goalKinds: ['retrieve_information'],
    location: 'thành phố Hồ Chí Minh',
    temporalWindow: { amount: 3, unit: 'day', direction: 'future' }
  });
  assert.deepEqual(retrieve.criteria, [
    { type: 'element', match: { labelIncludes: 'thành phố Hồ Chí Minh' }, expect: { exists: true, visible: true } },
    { type: 'element', match: { labelIncludes: '3 ngày' }, expect: { exists: true, visible: true } }
  ]);
  assert.equal(retrieve.goalState.requestedTemporalWindowObserved, '3 ngày');
  assert.equal(retrieve.unresolved.length, 0);

  const fallbackRetrieve = semanticCriteriaFor({ goalKinds: ['retrieve_information'] });
  assert.deepEqual(fallbackRetrieve.criteria, [
    { type: 'pageSignal', key: 'requestedInformationCaptured', operator: 'equals', value: true }
  ]);
  assert(fallbackRetrieve.unresolved.includes('retrieval_semantic_evidence_missing'));

  let calls = 0;
  const resolver = createSemanticGoalResolver({
    provider: {
      name: 'custom-goal-provider',
      version: '9.9.9',
      async resolveSubgoalTask({ subgoal }) {
        calls += 1;
        return {
          taskId: 'custom',
          type: 'custom',
          instruction: subgoal.instruction,
          successCriteria: [{ type: 'pageSignal', key: 'providerVerified', operator: 'equals', value: true }]
        };
      }
    }
  });
  const custom = await resolver.resolveSubgoalTask({ subgoal: { subgoalId: 'x', instruction: 'opaque' }, semantic: {} });
  assert.equal(calls, 1);
  assert.equal(custom.metadata.semanticGoalProvider, 'custom-goal-provider');

  console.log('Semantic goal resolver contract: PASS');
}

if (require.main === module) {
  main().catch(error => {
    console.error('Semantic goal resolver contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { main };
