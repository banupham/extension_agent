'use strict';

const assert = require('assert');
const { mapAgentAction } = require('../../manager/strategy/agent_action_contract.js');
const { validateExecutionBehavior } = require('../../manager/strategy/execution_behavior_contract.js');
const Planner = require('../../manager/execution/cdp_plan.js');

const rngValues = [0.4, 0.7, 0.2, 0.6];
let ri = 0;
const rng = () => rngValues[(ri++) % rngValues.length];
const target = { rect: { x: 100, y: 200, width: 80, height: 30 } };
const pointerBehavior = validateExecutionBehavior({
  actionType: 'click', targetRef: 'e17', profile: 'empirical-quantile-v01',
  pointer: { dwellBeforeDownMs: 45, holdMs: 92, constraints: { approachDurationMs: 180, straightness: 0.88, meanAbsTurnDeg: 18, correctionCount45Deg: 1, endToCenterNormalized: 0.12 } },
  metadata: { behaviorFamily: 'pointer-click' }
});

const clickPlan = Planner.buildCdpPlan({ mappedAction: mapAgentAction({ type: 'click', targetRef: 'e17' }), behavior: pointerBehavior, target, context: { pointerStart: { x: 10, y: 20 }, rng } });
assert.strictEqual(clickPlan.cdpPlanVersion, '0.1.1');
assert.ok(clickPlan.steps.length > 4);
assert.strictEqual(clickPlan.steps.at(-2).params.type, 'mousePressed');
assert.strictEqual(clickPlan.steps.at(-1).params.type, 'mouseReleased');
assert.strictEqual(clickPlan.steps.at(-1).delayMs, 92);
assert.ok(clickPlan.steps.some(step => step.behaviorPhase === 'micro-correction'));

const doubleBehavior = validateExecutionBehavior({ ...pointerBehavior, actionType: 'doubleClick' });
const doublePlan = Planner.buildCdpPlan({ mappedAction: mapAgentAction({ type: 'doubleClick', targetRef: 'e17' }), behavior: doubleBehavior, target, context: { pointerStart: { x: 20, y: 30 }, rng: () => 0.5 } });
const doubleMouse = doublePlan.steps.filter(step => ['mousePressed', 'mouseReleased'].includes(step.params?.type));
assert.deepStrictEqual(doubleMouse.map(step => [step.params.type, step.params.clickCount]), [
  ['mousePressed', 1], ['mouseReleased', 1], ['mousePressed', 2], ['mouseReleased', 2]
]);

const focusBehavior = validateExecutionBehavior({ actionType: 'focus', targetRef: 'e5', pointer: { dwellBeforeDownMs: 20, holdMs: 70, constraints: { approachDurationMs: 140, straightness: 0.9 } }, metadata: { behaviorFamily: 'focus-acquisition' } });
const focusPlan = Planner.buildCdpPlan({ mappedAction: mapAgentAction({ type: 'focus', targetRef: 'e5' }), behavior: focusBehavior, target, context: { pointerStart: { x: 0, y: 0 }, rng: () => 0.5 } });
assert.strictEqual(focusPlan.actionType, 'focus');
assert.strictEqual(focusPlan.steps.at(-2).params.type, 'mousePressed');
assert.strictEqual(focusPlan.steps.at(-1).params.type, 'mouseReleased');

const hoverBehavior = validateExecutionBehavior({ actionType: 'hover', targetRef: 'e2', pointer: { constraints: { approachDurationMs: 160, straightness: 0.92, meanAbsTurnDeg: 10, dwellMs: 400 } }, metadata: { behaviorFamily: 'pointer-hover' } });
const hoverPlan = Planner.buildCdpPlan({ mappedAction: mapAgentAction({ type: 'hover', targetRef: 'e2' }), behavior: hoverBehavior, target: { rect: { x: 300, y: 100, width: 220, height: 120 } }, context: { pointerStart: { x: 0, y: 0 }, rng: () => 0.5 } });
assert.strictEqual(hoverPlan.steps.at(-1).postDelayMs, 400);

const scrollBehavior = validateExecutionBehavior({ actionType: 'scrollHorizontal', scroll: { axis: 'horizontal', constraints: { durationMs: 240, eventCount: 4, absoluteDelta: 320, correctionRatio: 0.1 } }, metadata: { behaviorFamily: 'scroll-horizontal' } });
const scrollPlan = Planner.buildCdpPlan({
  mappedAction: mapAgentAction({ type: 'scrollHorizontal', args: { direction: -1 } }),
  behavior: scrollBehavior,
  context: { pointerStart: { x: 500, y: 400 }, viewportCenter: { x: 600, y: 350 } }
});
assert.strictEqual(scrollPlan.steps.length, 5);
assert.ok(scrollPlan.steps.slice(0, 4).every(step => step.params.deltaX < 0));
assert.ok(scrollPlan.steps.every(step => step.params.x === 600 && step.params.y === 350));
assert.strictEqual(scrollPlan.steps.at(-1).behaviorPhase, 'scroll-correction');

const fallbackScrollBehavior = validateExecutionBehavior({
  actionType: 'scrollVertical',
  scroll: { axis: 'vertical', constraints: { durationMs: null, eventCount: null, absoluteDelta: null, correctionRatio: null } },
  metadata: { behaviorFamily: 'scroll-vertical' }
});
const fallbackScrollPlan = Planner.buildCdpPlan({
  mappedAction: mapAgentAction({ type: 'scrollVertical', args: { direction: 1 } }),
  behavior: fallbackScrollBehavior,
  context: { pointerStart: { x: 999, y: 111 }, viewportCenter: { x: 640, y: 320 } }
});
assert.strictEqual(fallbackScrollPlan.steps.length, 4);
assert.ok(fallbackScrollPlan.steps.every(step => step.params.x === 640 && step.params.y === 320));
assert.ok(fallbackScrollPlan.steps.every(step => step.params.deltaY > 0 && step.params.deltaX === 0));
assert.ok(Math.abs(fallbackScrollPlan.steps.reduce((sum, step) => sum + step.params.deltaY, 0) - 480) < 1e-6);

const typeBehavior = validateExecutionBehavior({ actionType: 'typeText', keyboard: { initialPauseMs: 50, constraints: { interKeyMedianMs: 80, holdMedianMs: 70 } }, metadata: { behaviorFamily: 'keyboard-text' } });
const typePlan = Planner.buildCdpPlan({ mappedAction: mapAgentAction({ type: 'typeText', args: { text: 'abc' } }), behavior: typeBehavior });
assert.strictEqual(typePlan.steps.length, 3);
assert.strictEqual(typePlan.steps.map(x => x.params.text).join(''), 'abc');
assert.strictEqual(typePlan.steps[0].delayMs, 50);
assert.strictEqual(typePlan.steps[1].delayMs, 80);

assert.ok(!JSON.stringify(clickPlan).includes('selector'));
console.log('CDP execution planner contract: PASS');
