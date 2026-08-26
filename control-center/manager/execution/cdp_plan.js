'use strict';

const PLAN_VERSION = '0.1.1';

function finite(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function targetPoint(target, behavior, rng = Math.random) {
  const rect = target?.rect || target || {};
  const x = finite(rect.x, 0), y = finite(rect.y, 0), width = Math.max(1, finite(rect.width, 1)), height = Math.max(1, finite(rect.height, 1));
  const cx = x + width / 2, cy = y + height / 2;
  const diag = Math.hypot(width, height);
  const normalized = clamp(finite(behavior?.pointer?.constraints?.endToCenterNormalized, 0.12), 0, 0.45);
  const radius = normalized * diag * clamp(finite(rng(), 0.5), 0.15, 0.9);
  const angle = clamp(finite(rng(), 0.5), 0, 0.999999) * Math.PI * 2;
  return {
    x: clamp(cx + Math.cos(angle) * radius, x + 1, x + width - 1),
    y: clamp(cy + Math.sin(angle) * radius, y + 1, y + height - 1)
  };
}

function pointerPath(start, end, behavior, rng = Math.random) {
  const constraints = behavior?.pointer?.constraints || {};
  const durationMs = clamp(finite(constraints.approachDurationMs, 180), 32, 1800);
  const straightness = clamp(finite(constraints.straightness, 0.9), 0.35, 1);
  const meanAbsTurnDeg = clamp(finite(constraints.meanAbsTurnDeg, 10), 0, 90);
  const correctionCount = clamp(Math.round(finite(constraints.correctionCount45Deg, 0)), 0, 2);
  const dx = end.x - start.x, dy = end.y - start.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / distance, uy = dy / distance;
  const nx = -uy, ny = ux;
  const turnFactor = meanAbsTurnDeg / 90;
  const bendScale = (1 - straightness) * distance * (0.35 + turnFactor * 0.25);
  const bendSign = finite(rng(), 0.5) < 0.5 ? -1 : 1;
  const c1 = { x: start.x + dx * 0.32 + nx * bendScale * bendSign, y: start.y + dy * 0.32 + ny * bendScale * bendSign };
  const c2 = { x: start.x + dx * 0.72 - nx * bendScale * bendSign * 0.35, y: start.y + dy * 0.72 - ny * bendScale * bendSign * 0.35 };

  const correctionBudgetMs = correctionCount ? Math.min(durationMs * 0.24, correctionCount * 36) : 0;
  const curveDurationMs = Math.max(24, durationMs - correctionBudgetMs);
  const steps = clamp(Math.round(curveDurationMs / 16), 2, 90);
  const out = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    const x = u ** 3 * start.x + 3 * u ** 2 * t * c1.x + 3 * u * t ** 2 * c2.x + t ** 3 * end.x;
    const y = u ** 3 * start.y + 3 * u ** 2 * t * c1.y + 3 * u * t ** 2 * c2.y + t ** 3 * end.y;
    out.push({
      delayMs: i === 1 ? 0 : curveDurationMs / steps,
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mouseMoved', x, y, button: 'none' }
    });
  }

  if (correctionCount > 0) {
    const baseAmplitude = clamp(distance * 0.018 + meanAbsTurnDeg * 0.035, 2, 12);
    for (let i = 0; i < correctionCount; i += 1) {
      const sign = (i % 2 === 0 ? 1 : -1) * bendSign;
      const amplitude = baseAmplitude * (1 - i * 0.25);
      const backoff = Math.min(5, distance * 0.012) * (i + 1);
      out.push({
        delayMs: correctionBudgetMs / Math.max(1, correctionCount * 2),
        method: 'Input.dispatchMouseEvent',
        params: {
          type: 'mouseMoved',
          x: end.x - ux * backoff + nx * amplitude * sign,
          y: end.y - uy * backoff + ny * amplitude * sign,
          button: 'none'
        },
        behaviorPhase: 'micro-correction'
      });
      out.push({
        delayMs: correctionBudgetMs / Math.max(1, correctionCount * 2),
        method: 'Input.dispatchMouseEvent',
        params: { type: 'mouseMoved', x: end.x, y: end.y, button: 'none' },
        behaviorPhase: 'target-settle'
      });
    }
  }
  return out;
}

function clickPlan(mappedAction, behavior, target, context = {}) {
  const rng = context.rng || Math.random;
  const end = targetPoint(target, behavior, rng);
  const start = context.pointerStart && Number.isFinite(Number(context.pointerStart.x)) && Number.isFinite(Number(context.pointerStart.y))
    ? { x: Number(context.pointerStart.x), y: Number(context.pointerStart.y) }
    : end;
  const steps = pointerPath(start, end, behavior, rng);
  const dwell = clamp(finite(behavior?.pointer?.dwellBeforeDownMs, 0), 0, 1500);
  const hold = clamp(finite(behavior?.pointer?.holdMs, 60), 10, 1200);

  if (mappedAction.type === 'doubleClick') {
    const interClickMs = clamp(finite(behavior?.pointer?.constraints?.interClickMs, 90), 40, 300);
    steps.push({ delayMs: dwell, method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: end.x, y: end.y, button: 'left', clickCount: 1 } });
    steps.push({ delayMs: hold, method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', clickCount: 1 } });
    steps.push({ delayMs: interClickMs, method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: end.x, y: end.y, button: 'left', clickCount: 2 } });
    steps.push({ delayMs: hold, method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', clickCount: 2 } });
    return steps;
  }

  steps.push({ delayMs: dwell, method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: end.x, y: end.y, button: 'left', clickCount: 1 } });
  steps.push({ delayMs: hold, method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', clickCount: 1 } });
  return steps;
}

function hoverPlan(mappedAction, behavior, target, context = {}) {
  const rng = context.rng || Math.random;
  const end = targetPoint(target, behavior, rng);
  const start = context.pointerStart && Number.isFinite(Number(context.pointerStart.x)) && Number.isFinite(Number(context.pointerStart.y))
    ? { x: Number(context.pointerStart.x), y: Number(context.pointerStart.y) }
    : end;
  const steps = pointerPath(start, end, behavior, rng);
  const dwell = clamp(finite(behavior?.pointer?.constraints?.dwellMs, 0), 0, 5000);
  if (steps.length && dwell) steps[steps.length - 1].postDelayMs = dwell;
  return steps;
}

function scrollPlan(mappedAction, behavior, context = {}) {
  const horizontal = mappedAction.type === 'scrollHorizontal';
  const constraints = behavior?.scroll?.constraints || {};
  const durationMs = clamp(finite(constraints.durationMs, 220), 16, 3000);
  const eventCount = clamp(Math.round(finite(constraints.eventCount, 4)), 1, 60);
  const absoluteDelta = Math.max(1, finite(constraints.absoluteDelta, 480));
  const correctionRatio = clamp(finite(constraints.correctionRatio, 0), 0, 0.35);
  const direction = finite(mappedAction.args?.direction, 1) < 0 ? -1 : 1;
  // Generic page scroll must not inherit a stale pointer position from a prior page/action.
  // Anchor wheel events at the current viewport center; targeted/nested scrolling is a separate action.
  const point = context.viewportCenter || context.pointerStart || { x: 400, y: 300 };
  const weights = Array.from({ length: eventCount }, (_, i) => Math.sin(Math.PI * (i + 1) / (eventCount + 1)));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const correctionEvents = correctionRatio > 0.04 && eventCount >= 3 ? 1 : 0;
  const mainDelta = absoluteDelta / (1 + correctionRatio * 2);
  const steps = weights.map(weight => {
    const delta = direction * mainDelta * weight / sum;
    return {
      delayMs: durationMs / (eventCount + correctionEvents),
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mouseWheel', x: Number(point.x), y: Number(point.y),
        deltaX: horizontal ? delta : 0,
        deltaY: horizontal ? 0 : delta
      }
    };
  });
  if (correctionEvents) {
    const delta = -direction * mainDelta * correctionRatio;
    steps.push({
      delayMs: durationMs / (eventCount + correctionEvents),
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mouseWheel', x: Number(point.x), y: Number(point.y),
        deltaX: horizontal ? delta : 0,
        deltaY: horizontal ? 0 : delta
      },
      behaviorPhase: 'scroll-correction'
    });
  }
  return steps;
}

function keyboardPlan(mappedAction, behavior) {
  const text = String(mappedAction.args?.text ?? '');
  const key = String(mappedAction.args?.key ?? '');
  const constraints = behavior?.keyboard?.constraints || {};
  const gap = clamp(finite(constraints.interKeyMedianMs, 80), 10, 600);
  const hold = clamp(finite(constraints.holdMedianMs, 70), 10, 500);
  if (mappedAction.type === 'typeText' || mappedAction.type === 'replaceText') {
    return [...text].map((char, i) => ({
      delayMs: i === 0 ? clamp(finite(behavior?.keyboard?.initialPauseMs, 0), 0, 1500) : gap,
      method: 'Input.insertText',
      params: { text: char }
    }));
  }
  if (mappedAction.type === 'pressKey' || mappedAction.type === 'keyCombo') {
    if (!key) return [];
    return [
      { delayMs: 0, method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key } },
      { delayMs: hold, method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key } }
    ];
  }
  return [];
}

function buildCdpPlan({ mappedAction, behavior, target = null, context = {} }) {
  if (!mappedAction?.type) throw new Error('mappedAction required');
  let steps = [];
  const family = mappedAction.behaviorFamily || behavior?.metadata?.behaviorFamily || 'generic';
  if (family === 'pointer-click' || family === 'focus-acquisition') steps = clickPlan(mappedAction, behavior, target, context);
  else if (family === 'pointer-hover') steps = hoverPlan(mappedAction, behavior, target, context);
  else if (family === 'scroll-vertical' || family === 'scroll-horizontal') steps = scrollPlan(mappedAction, behavior, context);
  else if (family === 'keyboard-text' || family === 'keyboard-key') steps = keyboardPlan(mappedAction, behavior);
  else if (mappedAction.type === 'navigate') steps = [{ delayMs: 0, method: 'Page.navigate', params: { url: String(mappedAction.args?.url || '') } }];
  else if (mappedAction.type === 'reload') steps = [{ delayMs: 0, method: 'Page.reload', params: { ignoreCache: false } }];
  else throw new Error(`cdp_plan_unsupported:${mappedAction.type}`);

  return {
    cdpPlanVersion: PLAN_VERSION,
    actionType: mappedAction.type,
    targetRef: mappedAction.targetRef || null,
    behaviorProfile: behavior?.profile || null,
    steps
  };
}

module.exports = {
  PLAN_VERSION,
  targetPoint,
  pointerPath,
  clickPlan,
  hoverPlan,
  scrollPlan,
  keyboardPlan,
  buildCdpPlan
};
