'use strict';

const { pointerPath, clickPlan, hoverPlan } = require('./cdp_plan.js');
const { resolveOption, keyStroke } = require('./form_plan.js');

const MEDIA_PLAN_VERSION = '0.1.2';

function finite(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function observedRangeState(target) {
  if (!target?.rect) throw new Error('media_range_requires_target_rect');
  if (target.tag !== 'input' || String(target.inputType || '').toLowerCase() !== 'range') {
    throw new Error('media_range_requires_range_input');
  }
  const value = finite(target.rangeValue);
  const min = finite(target.rangeMin);
  const max = finite(target.rangeMax);
  if (value == null || min == null || max == null || max <= min) {
    throw new Error('media_range_requires_observed_state');
  }
  if (value < min || value > max) throw new Error('media_range_observed_value_out_of_bounds');
  return { value, min, max, step: target.rangeStep ?? null };
}

function requestedRangeValue(mappedAction, state) {
  const requested = finite(mappedAction?.args?.value);
  if (requested == null) throw new Error(`${mappedAction?.type || 'media_range'}_requires_numeric_value`);
  if (requested < state.min || requested > state.max) {
    throw new Error(`${mappedAction?.type || 'media_range'}_value_out_of_bounds`);
  }
  return requested;
}

function rangeTrackPoint(target, state, value) {
  const rect = target.rect;
  const x = Number(rect.x), y = Number(rect.y), width = Number(rect.width), height = Number(rect.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 2 || height <= 0) {
    throw new Error('media_range_target_rect_invalid');
  }
  const inset = Math.min(Math.max(2, height / 2), width / 4);
  const startX = x + inset;
  const endX = x + width - inset;
  const ratio = clamp((value - state.min) / (state.max - state.min), 0, 1);
  return {
    x: startX + (endX - startX) * ratio,
    y: y + height / 2
  };
}

function buildRangePlan({ mappedAction, behavior, target, context = {} }) {
  if (!['setVolume', 'seek'].includes(mappedAction?.type)) {
    throw new Error(`media_range_plan_unsupported:${mappedAction?.type || '<empty>'}`);
  }
  const state = observedRangeState(target);
  const requested = requestedRangeValue(mappedAction, state);
  const rng = context.rng || Math.random;
  const currentPoint = rangeTrackPoint(target, state, state.value);
  const desiredPoint = rangeTrackPoint(target, state, requested);
  const pointerStart = context.pointerStart && Number.isFinite(Number(context.pointerStart.x)) && Number.isFinite(Number(context.pointerStart.y))
    ? { x: Number(context.pointerStart.x), y: Number(context.pointerStart.y) }
    : currentPoint;
  const constraints = behavior?.pointer?.constraints || {};
  const straightness = clamp(finite(constraints.straightness, 0.9), 0.35, 1);
  const durationMs = clamp(finite(constraints.durationMs, 320), 100, 1600);
  const approachBehavior = {
    pointer: { constraints: { approachDurationMs: 160, straightness, meanAbsTurnDeg: 8, correctionCount45Deg: 0 } }
  };

  const steps = pointerPath(pointerStart, currentPoint, approachBehavior, rng).map(step => ({
    ...step,
    behaviorPhase: 'media-range-acquisition'
  }));

  if (Math.abs(requested - state.value) <= 1e-9) {
    return {
      cdpPlanVersion: MEDIA_PLAN_VERSION,
      actionType: mappedAction.type,
      targetRef: mappedAction.targetRef || null,
      behaviorProfile: behavior?.profile || null,
      steps
    };
  }

  const travelBehavior = {
    pointer: { constraints: { approachDurationMs: durationMs, straightness, meanAbsTurnDeg: 6, correctionCount45Deg: 0 } }
  };
  steps.push({
    delayMs: 35,
    method: 'Input.dispatchMouseEvent',
    params: { type: 'mousePressed', x: currentPoint.x, y: currentPoint.y, button: 'left', buttons: 1, clickCount: 1 },
    behaviorPhase: 'media-range-press'
  });
  steps.push(...pointerPath(currentPoint, desiredPoint, travelBehavior, rng).map((step, index) => ({
    ...step,
    delayMs: Number(step.delayMs || 0) + (index === 0 ? 50 : 0),
    params: { ...step.params, button: 'left', buttons: 1 },
    behaviorPhase: 'media-range-travel'
  })));
  steps.push({
    delayMs: 35,
    method: 'Input.dispatchMouseEvent',
    params: { type: 'mouseReleased', x: desiredPoint.x, y: desiredPoint.y, button: 'left', buttons: 0, clickCount: 1 },
    behaviorPhase: 'media-range-release'
  });

  return {
    cdpPlanVersion: MEDIA_PLAN_VERSION,
    actionType: mappedAction.type,
    targetRef: mappedAction.targetRef || null,
    behaviorProfile: behavior?.profile || null,
    steps
  };
}

function buildPlaybackRatePlan({ mappedAction, behavior, target, context = {} }) {
  if (mappedAction?.type !== 'changePlaybackRate') throw new Error('playback_rate_plan_requires_action');
  if (!target?.rect) throw new Error('playback_rate_requires_target_rect');
  const option = resolveOption(target, mappedAction.args?.value);
  if (String(target.selectedValue ?? '') === String(option.value)) {
    return {
      cdpPlanVersion: MEDIA_PLAN_VERSION,
      actionType: 'changePlaybackRate',
      targetRef: mappedAction.targetRef || null,
      behaviorProfile: behavior?.profile || null,
      steps: hoverPlan(mappedAction, behavior, target, context)
    };
  }

  const hold = clamp(finite(behavior?.keyboard?.constraints?.holdMedianMs, 55), 20, 250);
  const steps = clickPlan(mappedAction, behavior, target, context);
  steps.push(...keyStroke('Home', hold, 35));
  for (let i = 0; i < option.index; i += 1) steps.push(...keyStroke('ArrowDown', hold, 25));
  steps.push(...keyStroke('Enter', hold, 35));

  return {
    cdpPlanVersion: MEDIA_PLAN_VERSION,
    actionType: 'changePlaybackRate',
    targetRef: mappedAction.targetRef || null,
    behaviorProfile: behavior?.profile || null,
    steps
  };
}

function buildMediaCdpPlan(options) {
  const type = options?.mappedAction?.type;
  if (type === 'setVolume' || type === 'seek') return buildRangePlan(options);
  if (type === 'changePlaybackRate') return buildPlaybackRatePlan(options);
  throw new Error(`media_plan_unsupported:${type || '<empty>'}`);
}

module.exports = {
  MEDIA_PLAN_VERSION,
  observedRangeState,
  requestedRangeValue,
  rangeTrackPoint,
  buildRangePlan,
  buildPlaybackRatePlan,
  buildMediaCdpPlan
};
