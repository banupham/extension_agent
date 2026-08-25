'use strict';

const assert = require('assert');
const { mapAgentAction } = require('../../manager/strategy/agent_action_contract.js');
const { validateExecutionBehavior } = require('../../manager/strategy/execution_behavior_contract.js');
const Planner = require('../../manager/execution/cdp_plan.js');

const rngValues = [0.4, 0.7, 0.2, 0.6];
let ri = 0;
const rng = () => rngValues[(ri++) % rngValues.length];

const clickAction = mapAgentAction({ type: 'click', targetRef: 'e17' });
const clickBehavior = validateExecutionBehavior({
  actionType: 'click', targetRef: 'e17', profile: 'empirical-quantile-v01',
  pointer: {
    dwellBeforeDownMs: 45,
    holdMs: 92,
    constraints: {
      approachDurationMs: 180,
      straightness: 0.88,
      endToCenterNormalized: 0.12
    }
  },
  metadata: { behaviorFamily: 'pointer-click' }
});
const clickPlan = Planner.buildCdpPlan({
  mappedAction: clickAction,
  behavior: clickBehavior,
  target: { rect: { x: 100, y: 200, width: 80, height: 30 } },
  context: { pointerStart: { x: 10, y: 20 }, rng }
});
assert.strictEqual(clickPlan.cdpPlanVersion, '0.1.0');
assert.ok(clickPlan.steps.length > 4);
assert.strictEqual(clickPlan.steps.at(-2).params.type, 'mousePressed');
assert.strictEqual(clickPlan.steps.at(-1).params.type, 'mouseReleased');
assert.strictEqual(clickPlan.steps.at(-1).delayMs, 92);
assert.ok(clickPlan.steps.every(step => step.method === 'Input.dispatchMouseEvent'));

const hoverAction = mapAgentAction({ type: 'hover', targetRef: 'e2' });
const hoverBehavior = validateExecutionBehavior({
  actionType: 'hover', targetRef: 'e2',
  pointer: { constraints: { approachDurationMs: 160, straightness: 0.92, dwellMs: 400 } },
  metadata: { behaviorFamily: 'pointer-hover' }
});
const hoverPlan = Planner.buildCdpPlan({
  mappedAction: hoverAction,
  behavior: hoverBehavior,
  target: { rect: { x: 300, y: 100, width: 220, height: 120 } },
  context: { pointerStart: { x: 0, y: 0 }, rng: () => 0.5 }
});
assert.ok(hoverPlan.steps.length >= 2);
assert.strictEqual(hoverPlan.steps.at(-1).postDelayMs, 400);

const scrollAction = mapAgentAction({ type: 'scrollHorizontal', args: { direction: -1 } });
const scrollBehavior = validateExecutionBehavior({
  actionType: 'scrollHorizontal',
  scroll: { axis: 'horizontal', constraints: { durationMs: 240, eventCount: 4, absoluteDelta: 320 } },
  metadata: { behaviorFamily: 'scroll-horizontal' }
});
const scrollPlan = Planner.buildCdpPlan({ mappedAction: scrollAction, behavior: scrollBehavior, context: { pointerStart: { x: 500, y: 400 } } });
assert.strictEqual(scrollPlan.steps.length, 4);
assert.ok(scrollPlan.steps.every(step => step.params.deltaX < 0));
assert.ok(scrollPlan.steps.every(step => step.params.deltaY === 0));

const typeAction = mapAgentAction({ type: 'typeText', args: { text: 'abc' } });
const typeBehavior = validateExecutionBehavior({
  actionType: 'typeText',
  keyboard: { initialPauseMs: 50, constraints: { interKeyMedianMs: 80, holdMedianMs: 70 } },
  metadata: { behaviorFamily: 'keyboard-text' }
});
const typePlan = Planner.buildCdpPlan({ mappedAction: typeAction, behavior: typeBehavior });
assert.strictEqual(typePlan.steps.length, 3);
assert.deepStrictEqual(typePlan.steps.map(x => x.params.text).join(''), 'abc');
assert.strictEqual(typePlan.steps[0].delayMs, 50);
assert.strictEqual(typePlan.steps[1].delayMs, 80);

assert.ok(!JSON.stringify(clickPlan).includes('selector'));
console.log('CDP execution planner contract: PASS');
