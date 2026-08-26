'use strict';

const { targetPoint, pointerPath } = require('./cdp_plan.js');

const DRAG_PLAN_VERSION = '0.1.3';

function finite(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildDragCdpPlan({ mappedAction, behavior, source, destination, context = {} }) {
  if (mappedAction?.type !== 'drag') throw new Error('drag_plan_requires_drag_action');
  if (!source?.rect) throw new Error('drag_requires_source_target_rect');
  if (!destination?.rect) throw new Error('drag_requires_destination_target_rect');

  const destinationRef = String(mappedAction?.args?.destinationRef || '').trim();
  if (!destinationRef) throw new Error('drag_requires_destination_ref');
  if (destinationRef === mappedAction.targetRef) throw new Error('drag_source_destination_must_differ');

  const rng = context.rng || Math.random;
  const sourcePoint = targetPoint(source, behavior, rng);
  const destinationPoint = targetPoint(destination, behavior, rng);
  const pointerStart = context.pointerStart && Number.isFinite(Number(context.pointerStart.x)) && Number.isFinite(Number(context.pointerStart.y))
    ? { x: Number(context.pointerStart.x), y: Number(context.pointerStart.y) }
    : sourcePoint;

  const constraints = behavior?.pointer?.constraints || {};
  const straightness = clamp(finite(constraints.straightness, 0.88), 0.35, 1);
  const dragDurationMs = clamp(finite(constraints.durationMs, 420), 120, 1800);
  const dwellBeforeDownMs = clamp(finite(behavior?.pointer?.dwellBeforeDownMs, 40), 0, 1000);
  const holdBeforeMoveMs = clamp(finite(behavior?.pointer?.holdMs, 60), 20, 500);
  const releaseDelayMs = clamp(finite(constraints.releaseDelayMs, 40), 10, 500);

  const approachBehavior = {
    pointer: {
      constraints: {
        approachDurationMs: 180,
        straightness,
        meanAbsTurnDeg: 10,
        correctionCount45Deg: 0,
        endToCenterNormalized: 0.1
      }
    }
  };
  const travelBehavior = {
    pointer: {
      constraints: {
        approachDurationMs: dragDurationMs,
        straightness,
        meanAbsTurnDeg: 8,
        correctionCount45Deg: 0,
        endToCenterNormalized: 0.08
      }
    }
  };

  const steps = pointerPath(pointerStart, sourcePoint, approachBehavior, rng).map(step => ({
    ...step,
    behaviorPhase: 'drag-source-acquisition'
  }));

  steps.push({
    delayMs: dwellBeforeDownMs,
    method: 'Input.dispatchMouseEvent',
    params: {
      type: 'mousePressed',
      x: sourcePoint.x,
      y: sourcePoint.y,
      button: 'left',
      buttons: 1,
      clickCount: 1
    },
    behaviorPhase: 'drag-press'
  });

  const travel = pointerPath(sourcePoint, destinationPoint, travelBehavior, rng).map((step, index) => ({
    ...step,
    delayMs: Number(step.delayMs || 0) + (index === 0 ? holdBeforeMoveMs : 0),
    params: {
      ...step.params,
      button: 'left',
      buttons: 1
    },
    behaviorPhase: 'drag-travel'
  }));
  steps.push(...travel);

  steps.push({
    delayMs: releaseDelayMs,
    method: 'Input.dispatchMouseEvent',
    params: {
      type: 'mouseReleased',
      x: destinationPoint.x,
      y: destinationPoint.y,
      button: 'left',
      buttons: 0,
      clickCount: 1
    },
    behaviorPhase: 'drag-release'
  });

  return {
    cdpPlanVersion: DRAG_PLAN_VERSION,
    actionType: 'drag',
    targetRef: mappedAction.targetRef || null,
    destinationRef,
    behaviorProfile: behavior?.profile || null,
    steps
  };
}

module.exports = {
  DRAG_PLAN_VERSION,
  buildDragCdpPlan
};
