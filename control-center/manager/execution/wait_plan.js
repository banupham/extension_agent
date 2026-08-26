'use strict';

const WAIT_PLAN_VERSION = '0.1.3';

function buildWaitAndObservePlan({ mappedAction, behavior }) {
  if (mappedAction?.type !== 'waitAndObserve') {
    throw new Error(`wait_plan_unsupported:${mappedAction?.type || '<empty>'}`);
  }
  return {
    cdpPlanVersion: WAIT_PLAN_VERSION,
    actionType: 'waitAndObserve',
    targetRef: null,
    behaviorProfile: behavior?.profile || null,
    observationOnly: true,
    steps: []
  };
}

module.exports = { WAIT_PLAN_VERSION, buildWaitAndObservePlan };
