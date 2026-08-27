'use strict';

const { createBrokerRuntimeClient } = require('../manager/agent/broker_runtime_client.js');
const { createMissionPlan } = require('../manager/mission/mission_plan.js');
const { executeMissionWithStrategy } = require('../manager/mission/mission_strategy_executor.js');
const { parseArgs, discoverRuntimeAgent, resolveCommandTabId } = require('./agent_one_action.js');

const DEFAULT_MISSION = 'Mở Atlas và xem nội dung về robotics; sau đó mở Orion và kiểm tra thời tiết ở Hồ Chí Minh trong 3 ngày tới';
const EXPECTED_ACTION_LABELS = ['Mission Atlas', 'Mission Orion'];

function findVisible(observation, label) {
  return (Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [])
    .find(element => String(element?.label || '').trim() === label && element.visible !== false && element.enabled !== false) || null;
}

function strategyForSemantic(semantic) {
  const destination = String(semantic?.destination || '').trim().toLowerCase();
  const label = destination.includes('atlas') ? 'Mission Atlas' : destination.includes('orion') ? 'Mission Orion' : null;
  return {
    async decide({ observation, history }) {
      if (history.length) {
        return { status: 'blocked', confidence: 0, reasonCode: 'semantic_mission_unexpected_replan', recovery: {}, metadata: { prototypeSource: 'semanticMission' } };
      }
      if (!label) {
        return { status: 'blocked', confidence: 0, reasonCode: 'semantic_mission_destination_unknown', recovery: {}, metadata: { prototypeSource: 'semanticMission' } };
      }
      const target = findVisible(observation, label);
      if (!target) {
        return { status: 'blocked', confidence: 0, reasonCode: 'semantic_mission_target_missing', recovery: {}, metadata: { prototypeSource: 'semanticMission' } };
      }
      return {
        status: 'act',
        action: { type: 'click', targetRef: target.ref, args: {} },
        confidence: 0.8,
        reasonCode: 'semantic_mission_execute_subgoal',
        expectedOutcome: {},
        recovery: {},
        metadata: { prototypeSource: 'semanticMission', semanticDestination: semantic.destination }
      };
    }
  };
}

function episodeBudgets() {
  return {
    maxSteps: 2,
    maxDurationMs: 120000,
    maxConsecutiveFailures: 1,
    maxReplans: 1,
    maxStalledSteps: 1
  };
}

async function runGate(options = {}) {
  if (!options.runtime) throw new Error('runtime_required');
  const plan = createMissionPlan({
    missionId: `native-semantic-mission-${Date.now()}`,
    instruction: options.mission || DEFAULT_MISSION
  });

  const result = await executeMissionWithStrategy({
    plan,
    runtime: options.runtime,
    createStrategy: async ({ semantic }) => strategyForSemantic(semantic),
    episodeBudgets: episodeBudgets(),
    postActionSettle: { pollMs: 80, minWindowMs: 240, maxWindowMs: 900, stableSamples: 2 }
  });

  const subgoals = result.subgoalResults || [];
  const actions = subgoals.flatMap(item => (item?.result?.steps || []).map(step => ({
    type: step?.action?.type || null,
    label: step?.before?.interactiveElements?.find(element => element?.ref === step?.action?.targetRef)?.label || null
  })));
  const actionLabels = actions.map(item => item.label);
  const allCriteria = subgoals.flatMap(item => item?.result?.task?.successCriteria || []);
  const titles = subgoals.flatMap(item => (item?.result?.steps || []).flatMap(step => [step?.before?.title, step?.after?.title])).filter(Boolean);
  const errors = [];

  if (result.ok !== true || result.reasonCode !== 'mission_satisfied') errors.push(`mission:${result.reasonCode || '<missing>'}`);
  if (subgoals.length !== 2 || !subgoals.every(item => item.status === 'done')) errors.push('subgoals_not_done');
  if (JSON.stringify(actionLabels) !== JSON.stringify(EXPECTED_ACTION_LABELS)) errors.push(`actions:${actionLabels.join(',')}`);
  if (allCriteria.some(item => item?.type === 'page' && item?.field === 'title')) errors.push('title_criterion_used');
  if (titles.some(title => title !== 'Semantic Mission Lab')) errors.push('title_changed');
  if (subgoals[0]?.result?.task?.successCriteria?.some(item => item?.type === 'element' && String(item?.match?.labelIncludes || '').toLowerCase().includes('robotics')) !== true) errors.push('robotics_semantic_evidence_missing');
  if (subgoals[1]?.result?.task?.successCriteria?.some(item => item?.type === 'element' && String(item?.match?.labelIncludes || '').toLowerCase().includes('hồ chí minh')) !== true) errors.push('location_semantic_evidence_missing');
  if (subgoals[1]?.result?.task?.successCriteria?.some(item => item?.type === 'element' && String(item?.match?.labelIncludes || '').includes('3 ngày')) !== true) errors.push('temporal_semantic_evidence_missing');
  if (result?.invariant?.orderedExecution !== true) errors.push('mission_order_invariant_failed');
  if (result?.invariant?.allCompletedSubgoalsUsedGoalCheckedEpisodes !== true) errors.push('goal_checked_episode_invariant_failed');
  if (result?.invariant?.noPassTitleCriterionRequired !== true) errors.push('no_pass_title_invariant_failed');
  if (subgoals.some(item => item?.result?.invariant?.selectorUsedByStrategy !== false)) errors.push('selector_boundary_failed');

  return {
    ok: errors.length === 0,
    result: errors.length === 0 ? 'PASS' : 'FAIL',
    gate: 'offline-strategy-semantic-mission',
    mission: plan.instruction,
    semanticMission: result.semanticMission,
    actionLabels,
    expectedActionLabels: EXPECTED_ACTION_LABELS,
    subgoals: subgoals.map(item => ({
      subgoalId: item.subgoalId,
      status: item.status,
      semantic: item?.result?.missionSubgoal?.semantic || null,
      successCriteria: item?.result?.task?.successCriteria || [],
      finalOutcome: item?.result?.finalOutcome || null,
      finalBudget: item?.result?.finalBudget ? {
        status: item.result.finalBudget.status,
        terminal: item.result.finalBudget.terminal,
        reasonCode: item.result.finalBudget.reasonCode,
        usage: item.result.finalBudget.usage
      } : null
    })),
    invariant: result.invariant,
    errors
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const agentId = args.agent || await discoverRuntimeAgent(args['health-base'] || 'http://127.0.0.1:3000');
  const client = createBrokerRuntimeClient({
    url: args.broker || 'ws://127.0.0.1:3000',
    agentId,
    timeoutMs: Number(args.timeout || 10000)
  });
  try {
    const tabId = await resolveCommandTabId(client, {
      ...args,
      'url-includes': args['url-includes'] || '127.0.0.1:8091/mission'
    });
    const runtime = {
      observe: () => client.observe(tabId),
      listTabs: scope => client.listTabs(scope),
      executePlan: payload => client.executePlan({ ...payload, tabId }),
      executeBrowserAction: payload => client.executeBrowserAction({ ...payload, tabId })
    };
    const result = await runGate({ runtime, mission: args.task || DEFAULT_MISSION });
    console.log(JSON.stringify({ agentId, tabId, ...result }, null, 2));
    if (!result.ok) process.exitCode = 2;
  } finally {
    client.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', gate: 'offline-strategy-semantic-mission', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_MISSION,
  EXPECTED_ACTION_LABELS,
  findVisible,
  strategyForSemantic,
  episodeBudgets,
  runGate,
  main
};
