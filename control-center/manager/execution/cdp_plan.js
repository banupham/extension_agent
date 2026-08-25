'use strict';

const PLAN_VERSION = '0.1.0';

function finite(value, fallback = null) {
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
  const durationMs = clamp(finite(behavior?.pointer?.constraints?.approachDurationMs, 180), 32, 1800);
  const straightness = clamp(finite(behavior?.pointer?.constraints?.straightness, 0.9), 0.35, 1);
  const dx = end.x - start.x, dy = end.y - start.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / distance, ny = dx / distance;
  const bendScale = (1 - straightness) * distance * 0.45;
  const bendSign = finite(rng(), 0.5) < 0.5 ? -1 : 1;
  const c1 = { x: start.x + dx * 0.32 + nx * bendScale * bendSign, y: start.y + dy * 0.32 + ny * bendScale * bendSign };
  const c2 = { x: start.x + dx * 0.72 - nx * bendScale * bendSign * 0.35, y: start.y + dy * 0.72 - ny * bendScale * bendSign * 0.35 };
  const steps = clamp(Math.round(durationMs / 16), 2, 90);
  const out = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    const x = u ** 3 * start.x + 3 * u ** 2 * t * c1.x + 3 * u * t ** 2 * c2.x + t ** 3 * end.x;
    const y = u ** 3 * start.y + 3 * u ** 2 * t * c1.y + 3 * u * t ** 2 * c2.y + t ** 3 * end.y;
    out.push({
      delayMs: i === 1 ? 0 : durationMs / steps,
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mouseMoved', x, y, button: 'none' }
    });
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
  const clickCount = mappedAction.type === 'doubleClick' ? 2 : 1;
  steps.push({ delayMs: dwell, method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: end.x, y: end.y, button: 'left', clickCount } });
  steps.push({ delayMs: hold, method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', clickCount } });
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
  const direction = finite(mappedAction.args?.direction, 1) < 0 ? -1 : 1;
  const point = context.pointerStart || context.viewportCenter || { x: 400, y: 300 };
  const weights = Array.from({ length: eventCount }, (_, i) => Math.sin(Math.PI * (i + 1) / (eventCount + 1)));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map(weight => {
    const delta = direction * absoluteDelta * weight / sum;
    return {
      delayMs: durationMs / eventCount,
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mouseWheel', x: Number(point.x), y: Number(point.y),
        deltaX: horizontal ? delta : 0,
        deltaY: horizontal ? 0 : delta
      }
    };
  });
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
  if (family === 'pointer-click') steps = clickPlan(mappedAction, behavior, target, context);
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
