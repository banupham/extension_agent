'use strict';

/**
 * Build run tasks from selected browsers and scenarios.
 *
 * assignmentMode:
 * - all: every browser receives every scenario
 * - pair: browser[i] receives scenario[i % scenarioCount]
 * - random: each browser receives one random selected scenario
 * - manual: assignments[agentId] chooses the exact scenario
 *
 * Random mode randomizes only assignment. Scenario contents remain unchanged.
 */
function buildAssignmentTasks({
  agentIds = [],
  scenarioIds = [],
  assignmentMode = 'all',
  assignments = {},
  tracePlan = false,
  timingProfile = null,
  random = Math.random
} = {}) {
  const agents = [...new Set(agentIds.map(String).filter(Boolean))];
  const scenarios = [...new Set(scenarioIds.map(String).filter(Boolean))];

  if (!agents.length) throw new Error('Select at least one online browser');
  if (!scenarios.length) throw new Error('Select at least one scenario');

  const makeTask = (agentId, scenarioId) => ({
    agentId,
    scenarioId,
    tracePlan: !!tracePlan,
    timingProfile: timingProfile || null
  });

  switch (String(assignmentMode || 'all')) {
    case 'all': {
      const tasks = [];
      for (const agentId of agents) {
        for (const scenarioId of scenarios) tasks.push(makeTask(agentId, scenarioId));
      }
      return tasks;
    }

    case 'pair':
      return agents.map((agentId, index) =>
        makeTask(agentId, scenarios[index % scenarios.length])
      );

    case 'random':
      return agents.map(agentId => {
        const index = Math.max(0, Math.min(
          scenarios.length - 1,
          Math.floor(Number(random()) * scenarios.length)
        ));
        return makeTask(agentId, scenarios[index]);
      });

    case 'manual':
      return agents.map(agentId => {
        const scenarioId = String(assignments[agentId] || '');
        if (!scenarios.includes(scenarioId)) {
          throw new Error(`Missing/invalid manual scenario for browser ${agentId}`);
        }
        return makeTask(agentId, scenarioId);
      });

    default:
      throw new Error(`Unknown assignment mode: ${assignmentMode}`);
  }
}

module.exports = { buildAssignmentTasks };
