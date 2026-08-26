'use strict';

const assert = require('assert');
const {
  MEDIA_PLAN_VERSION,
  observedRangeState,
  rangeTrackPoint,
  buildMediaCdpPlan
} = require('../../manager/execution/media_plan.js');

const rangeTarget = {
  ref: 'e10', tag: 'input', inputType: 'range', label: 'Volume Target',
  rangeValue: 20, rangeMin: 0, rangeMax: 100, rangeStep: 1,
  rect: { x: 100, y: 200, width: 129, height: 16 }
};
const dragBehavior = {
  profile: 'conservative-fallback',
  pointer: { constraints: { durationMs: 320, straightness: 0.9 } }
};
const context = { pointerStart: { x: 50, y: 50 }, rng: () => 0.5 };

const state = observedRangeState(rangeTarget);
assert.deepStrictEqual(state, { value: 20, min: 0, max: 100, step: 1 });
const p20 = rangeTrackPoint(rangeTarget, state, 20);
const p80 = rangeTrackPoint(rangeTarget, state, 80);
assert.ok(p80.x > p20.x);
assert.strictEqual(p20.y, p80.y);

const volume = buildMediaCdpPlan({
  mappedAction: { type: 'setVolume', targetRef: 'e10', args: { value: 80 } },
  behavior: dragBehavior,
  target: rangeTarget,
  context
});
assert.strictEqual(volume.cdpPlanVersion, MEDIA_PLAN_VERSION);
assert.strictEqual(volume.actionType, 'setVolume');
assert.strictEqual(volume.targetRef, 'e10');
assert.ok(volume.steps.some(step => step.params?.type === 'mousePressed'));
assert.ok(volume.steps.some(step => step.params?.type === 'mouseReleased'));
const held = volume.steps.filter(step => step.params?.type === 'mouseMoved' && step.params?.buttons === 1);
assert.ok(held.length >= 2);
assert.ok(held.every(step => step.params.button === 'left'));
const release = volume.steps.find(step => step.params?.type === 'mouseReleased');
assert.ok(release.params.x > 185 && release.params.x < 215);
assert.ok(release.params.y >= 200 && release.params.y <= 216);

const seek = buildMediaCdpPlan({
  mappedAction: { type: 'seek', targetRef: 'e11', args: { value: 80 } },
  behavior: dragBehavior,
  target: { ...rangeTarget, ref: 'e11', label: 'Seek Target', rangeValue: 10, rect: { x: 300, y: 200, width: 129, height: 16 } },
  context
});
assert.strictEqual(seek.actionType, 'seek');
assert.ok(seek.steps.some(step => step.params?.type === 'mousePressed'));
assert.ok(seek.steps.some(step => step.params?.type === 'mouseReleased'));

assert.throws(() => buildMediaCdpPlan({
  mappedAction: { type: 'setVolume', targetRef: 'e10', args: { value: 120 } },
  behavior: dragBehavior,
  target: rangeTarget,
  context
}), /setVolume_value_out_of_bounds/);

const rateTarget = {
  ref: 'e12', tag: 'select', label: 'Playback Rate Target', selectedValue: '1', selectedIndex: 0,
  options: [
    { index: 0, value: '1', label: '1x', disabled: false, selected: true },
    { index: 1, value: '1.5', label: '1.5x', disabled: false, selected: false },
    { index: 2, value: '2', label: '2x', disabled: false, selected: false }
  ],
  rect: { x: 500, y: 200, width: 60, height: 20 }
};
const rate = buildMediaCdpPlan({
  mappedAction: { type: 'changePlaybackRate', targetRef: 'e12', args: { value: 2 } },
  behavior: { profile: 'conservative-fallback' },
  target: rateTarget,
  context
});
assert.strictEqual(rate.actionType, 'changePlaybackRate');
assert.ok(rate.steps.some(step => step.params?.type === 'mousePressed'));
const downs = rate.steps.filter(step => step.method === 'Input.dispatchKeyEvent' && step.params?.type === 'rawKeyDown');
assert.deepStrictEqual(downs.map(step => step.params.key), ['Home', 'ArrowDown', 'ArrowDown', 'Enter']);

const rateNoop = buildMediaCdpPlan({
  mappedAction: { type: 'changePlaybackRate', targetRef: 'e12', args: { value: 2 } },
  behavior: { profile: 'conservative-fallback' },
  target: { ...rateTarget, selectedValue: '2', selectedIndex: 2 },
  context
});
assert.ok(rateNoop.steps.length > 0);
assert.strictEqual(rateNoop.steps.some(step => step.params?.type === 'mousePressed'), false);

console.log('media_control_plan: PASS');
