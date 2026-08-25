'use strict';

const fs = require('fs');
const path = require('path');
const Semantics = require('./build_action_semantics.js');
const Windows = require('./build_action_windows.js');

const FEATURE_VERSION = '0.2.0';

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 4) {
  const n = finite(value);
  if (n == null) return null;
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

function percentile(values, p) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  if (xs.length === 1) return xs[0];
  const pos = (xs.length - 1) * p;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return xs[lo];
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}

function timingSummary(events) {
  const times = events.map(e => finite(e.tsEpochMs)).filter(Number.isFinite);
  const gaps = [];
  for (let i = 1; i < times.length; i += 1) {
    const d = times[i] - times[i - 1];
    if (d >= 0) gaps.push(d);
  }
  return {
    sampleCount: events.length,
    durationMs: times.length >= 2 ? round(times.at(-1) - times[0], 3) : 0,
    gapMeanMs: gaps.length ? round(gaps.reduce((a, b) => a + b, 0) / gaps.length, 3) : null,
    gapMedianMs: round(percentile(gaps, 0.5), 3),
    gapP90Ms: round(percentile(gaps, 0.9), 3),
    gapMaxMs: gaps.length ? round(Math.max(...gaps), 3) : null
  };
}

function pointerPathSummary(events) {
  const pts = events.filter(e => Number.isFinite(finite(e.x)) && Number.isFinite(finite(e.y)));
  if (!pts.length) return { sampleCount: 0, available: false };

  let pathLengthPx = 0;
  const speeds = [];
  const accelerations = [];
  const segmentAngles = [];
  let prevSpeed = null;
  let prevSpeedTs = null;

  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1], b = pts[i];
    const dx = Number(b.x) - Number(a.x), dy = Number(b.y) - Number(a.y);
    const dist = Math.hypot(dx, dy);
    pathLengthPx += dist;
    if (dist > 0) segmentAngles.push(Math.atan2(dy, dx));
    const dt = Number(b.tsEpochMs || 0) - Number(a.tsEpochMs || 0);
    if (dt > 0) {
      const speed = dist / (dt / 1000);
      speeds.push(speed);
      if (prevSpeed != null && prevSpeedTs != null) {
        const adt = Number(b.tsEpochMs || 0) - prevSpeedTs;
        if (adt > 0) accelerations.push((speed - prevSpeed) / (adt / 1000));
      }
      prevSpeed = speed;
      prevSpeedTs = Number(b.tsEpochMs || 0);
    }
  }

  const turnAngles = [];
  let correctionCount = 0;
  for (let i = 1; i < segmentAngles.length; i += 1) {
    let d = segmentAngles[i] - segmentAngles[i - 1];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const abs = Math.abs(d);
    turnAngles.push(abs);
    if (abs >= Math.PI / 4) correctionCount += 1;
  }

  const first = pts[0], last = pts.at(-1);
  const displacementPx = Math.hypot(Number(last.x) - Number(first.x), Number(last.y) - Number(first.y));
  const durationMs = Number(last.tsEpochMs || 0) - Number(first.tsEpochMs || 0);

  return {
    available: true,
    sampleCount: pts.length,
    start: { x: round(first.x, 3), y: round(first.y, 3) },
    end: { x: round(last.x, 3), y: round(last.y, 3) },
    durationMs: durationMs >= 0 ? round(durationMs, 3) : null,
    displacementPx: round(displacementPx, 4),
    pathLengthPx: round(pathLengthPx, 4),
    straightness: pathLengthPx > 0 ? round(displacementPx / pathLengthPx, 5) : null,
    meanSpeedPxS: speeds.length ? round(speeds.reduce((a, b) => a + b, 0) / speeds.length, 4) : null,
    medianSpeedPxS: round(percentile(speeds, 0.5), 4),
    p90SpeedPxS: round(percentile(speeds, 0.9), 4),
    maxSpeedPxS: speeds.length ? round(Math.max(...speeds), 4) : null,
    meanAbsAccelerationPxS2: accelerations.length ? round(accelerations.reduce((a, b) => a + Math.abs(b), 0) / accelerations.length, 4) : null,
    meanAbsTurnDeg: turnAngles.length ? round((turnAngles.reduce((a, b) => a + b, 0) / turnAngles.length) * 180 / Math.PI, 3) : null,
    p90AbsTurnDeg: turnAngles.length ? round(percentile(turnAngles, 0.9) * 180 / Math.PI, 3) : null,
    correctionCount45Deg: correctionCount
  };
}

function targetGeometry(target) {
  const rect = target?.rect && typeof target.rect === 'object' ? target.rect : null;
  const x = finite(rect?.x), y = finite(rect?.y), width = finite(rect?.width), height = finite(rect?.height);
  return {
    targetRefPresent: !!target?.targetRef,
    role: target?.role || null,
    tag: target?.tag || null,
    xPx: x,
    yPx: y,
    widthPx: width,
    heightPx: height,
    areaPx2: width != null && height != null ? round(width * height, 3) : null,
    aspectRatio: width != null && height > 0 ? round(width / height, 5) : null,
    center: x != null && y != null && width != null && height != null ? { x: round(x + width / 2, 3), y: round(y + height / 2, 3) } : null
  };
}

function pointerPressSummary(window) {
  const actionTs = finite(window.action?.tsEpochMs) ?? finite(window.anchorTsEpochMs);
  const all = [...(window.before || []), ...(window.after || [])]
    .filter(e => e.type === 'pointer' && ['down', 'up'].includes(e.phase))
    .sort((a, b) => Number(a.tsEpochMs || 0) - Number(b.tsEpochMs || 0));
  let best = null;
  for (let i = 0; i < all.length; i += 1) {
    if (all[i].phase !== 'down') continue;
    const up = all.slice(i + 1).find(e => e.phase === 'up' && (e.pointerId == null || all[i].pointerId == null || e.pointerId === all[i].pointerId));
    if (!up) continue;
    const hold = Number(up.tsEpochMs || 0) - Number(all[i].tsEpochMs || 0);
    if (hold < 0 || hold > 2000) continue;
    const midpoint = (Number(up.tsEpochMs || 0) + Number(all[i].tsEpochMs || 0)) / 2;
    const distance = actionTs == null ? 0 : Math.abs(midpoint - actionTs);
    if (!best || distance < best.distance) best = { distance, down: all[i], up, hold };
  }
  return best ? {
    available: true,
    holdMs: round(best.hold, 3),
    downToActionMs: actionTs == null ? null : round(actionTs - Number(best.down.tsEpochMs || 0), 3),
    actionToUpMs: actionTs == null ? null : round(Number(best.up.tsEpochMs || 0) - actionTs, 3)
  } : { available: false, holdMs: null, downToActionMs: null, actionToUpMs: null };
}

function targetAcquisitionSummary(path, target) {
  if (!path?.available || !path.end || !target?.center) return { available: false };
  const dx = Number(path.end.x) - Number(target.center.x), dy = Number(path.end.y) - Number(target.center.y);
  const distance = Math.hypot(dx, dy);
  const diagonal = target.widthPx != null && target.heightPx != null ? Math.hypot(target.widthPx, target.heightPx) : null;
  return {
    available: true,
    endToCenterPx: round(distance, 4),
    endToCenterNormalized: diagonal > 0 ? round(distance / diagonal, 5) : null
  };
}

function clickFeatures(window) {
  const pointers = (window.before || []).filter(e => e.type === 'pointer');
  const path = pointerPathSummary(pointers);
  const actionTs = finite(window.action?.tsEpochMs) ?? finite(window.anchorTsEpochMs);
  const lastPointerTs = pointers.length ? finite(pointers.at(-1).tsEpochMs) : null;
  const target = targetGeometry(window.target);
  return {
    family: 'pointer-click',
    approach: path,
    acquisitionPauseMs: actionTs != null && lastPointerTs != null ? round(Math.max(0, actionTs - lastPointerTs), 3) : null,
    acquisition: targetAcquisitionSummary(path, target),
    press: pointerPressSummary(window),
    pointerButton: finite(window.action?.button),
    target
  };
}

function hoverFeatures(window) {
  const target = targetGeometry(window.target);
  const approach = pointerPathSummary((window.before || []).filter(e => e.type === 'pointer'));
  return {
    family: 'pointer-hover',
    approach,
    acquisition: targetAcquisitionSummary(approach, target),
    leave: pointerPathSummary((window.after || []).filter(e => e.type === 'pointer')),
    dwellMs: round(window.action?.dwellMs, 3),
    previewLikeStateChange: !!window.outcome?.previewLikeStateChange,
    mutationRecordCount: finite(window.outcome?.mutationRecordCount) || 0,
    target
  };
}

function dragFeatures(window) {
  const points = Array.isArray(window.action?.points) ? window.action.points.filter(e => e.type === 'pointer') : [];
  return {
    family: 'pointer-drag',
    path: pointerPathSummary(points),
    durationMs: round(window.action?.durationMs, 3),
    displacementPx: round(window.action?.distancePx, 4),
    pointCount: points.length,
    target: targetGeometry(window.target),
    destinationTarget: targetGeometry(window.destinationTarget)
  };
}

function scrollFeatures(window) {
  const events = Array.isArray(window.action?.events) ? window.action.events : [];
  const dx = events.map(e => finite(e.deltaX) || 0);
  const dy = events.map(e => finite(e.deltaY) || 0);
  const primary = window.actionType === 'scrollHorizontal' ? dx : dy;
  let directionChanges = 0;
  let prevSign = 0;
  for (const value of primary) {
    const sign = Math.sign(value);
    if (sign && prevSign && sign !== prevSign) directionChanges += 1;
    if (sign) prevSign = sign;
  }
  return {
    family: window.actionType === 'scrollHorizontal' ? 'scroll-horizontal' : 'scroll-vertical',
    timing: timingSummary(events),
    eventCount: events.length,
    totalDeltaX: round(dx.reduce((a, b) => a + b, 0), 4),
    totalDeltaY: round(dy.reduce((a, b) => a + b, 0), 4),
    absolutePrimaryDelta: round(primary.reduce((a, b) => a + Math.abs(b), 0), 4),
    primaryDeltaMedian: round(percentile(primary.map(Math.abs), 0.5), 4),
    primaryDeltaP90: round(percentile(primary.map(Math.abs), 0.9), 4),
    directionChanges,
    correctionRatio: primary.length ? round(directionChanges / primary.length, 5) : null,
    target: targetGeometry(window.target)
  };
}

function keyboardRhythm(events) {
  const downs = events.filter(e => e.phase === 'down').sort((a, b) => Number(a.tsEpochMs || 0) - Number(b.tsEpochMs || 0));
  const downGaps = [];
  for (let i = 1; i < downs.length; i += 1) {
    const gap = Number(downs[i].tsEpochMs || 0) - Number(downs[i - 1].tsEpochMs || 0);
    if (gap >= 0) downGaps.push(gap);
  }
  const holds = [];
  const pending = [];
  for (const event of [...events].sort((a, b) => Number(a.tsEpochMs || 0) - Number(b.tsEpochMs || 0))) {
    if (event.phase === 'down') pending.push(event);
    else if (event.phase === 'up' && pending.length) {
      let idx = pending.findIndex(d => (d.code && event.code && d.code === event.code) || (!d.code && !event.code && d.operation === event.operation));
      if (idx < 0) idx = 0;
      const down = pending.splice(idx, 1)[0];
      const hold = Number(event.tsEpochMs || 0) - Number(down.tsEpochMs || 0);
      if (hold >= 0 && hold <= 2000) holds.push(hold);
    }
  }
  const pauseThresholdMs = 450;
  return {
    downCount: downs.length,
    interKeyMeanMs: downGaps.length ? round(downGaps.reduce((a, b) => a + b, 0) / downGaps.length, 3) : null,
    interKeyMedianMs: round(percentile(downGaps, 0.5), 3),
    interKeyP90Ms: round(percentile(downGaps, 0.9), 3),
    pauseCount450Ms: downGaps.filter(x => x >= pauseThresholdMs).length,
    holdCount: holds.length,
    holdMeanMs: holds.length ? round(holds.reduce((a, b) => a + b, 0) / holds.length, 3) : null,
    holdMedianMs: round(percentile(holds, 0.5), 3),
    holdP90Ms: round(percentile(holds, 0.9), 3)
  };
}

function keyboardFeatures(window) {
  const events = Array.isArray(window.action?.events) ? window.action.events : [];
  const operations = events.map(e => e.operation || e.keyClass || 'unknown');
  const counts = {};
  for (const op of operations) counts[op] = (counts[op] || 0) + 1;
  const down = events.filter(e => e.phase === 'down');
  return {
    family: window.actionType === 'typeText' ? 'keyboard-text' : 'keyboard-key',
    timing: timingSummary(events),
    rhythm: keyboardRhythm(events),
    keyDownCount: down.length,
    operationCounts: counts,
    repeatCount: events.filter(e => e.repeat).length,
    printableContentStored: false,
    target: targetGeometry(window.target)
  };
}

function formFeatures(window) {
  const physical = (window.before || []).filter(e => e.type === 'pointer' || e.type === 'keyboard');
  return {
    family: 'form-control',
    leadInTiming: timingSummary(physical),
    pointerLeadIn: pointerPathSummary(physical.filter(e => e.type === 'pointer')),
    target: targetGeometry(window.target)
  };
}

function featureForWindow(window) {
  const type = window?.actionType || 'unknown';
  let features;
  if (['click', 'dismiss', 'toggle'].includes(type)) features = clickFeatures(window);
  else if (['hover', 'hoverAndObserve'].includes(type)) features = hoverFeatures(window);
  else if (type === 'drag') features = dragFeatures(window);
  else if (['scrollVertical', 'scrollHorizontal'].includes(type)) features = scrollFeatures(window);
  else if (['typeText', 'pressKey'].includes(type)) features = keyboardFeatures(window);
  else if (['focus', 'selectOption', 'submit'].includes(type)) features = formFeatures(window);
  else return null;

  return {
    behaviorFeatureVersion: FEATURE_VERSION,
    actionWindowVersion: window.actionWindowVersion || null,
    actionId: window.actionId || null,
    actionType: type,
    anchorTsEpochMs: finite(window.anchorTsEpochMs),
    context: window.context || {},
    features,
    quality: {
      targetSemanticPresent: !!(window.target?.targetRef && (window.target?.role || window.target?.label)),
      physicalEvidencePresent: !!(
        features?.approach?.available || features?.path?.available || features?.pointerLeadIn?.available ||
        Number(features?.eventCount || 0) > 0 || Number(features?.timing?.sampleCount || 0) > 0
      )
    }
  };
}

function extractBehaviorFeatures(actionWindows) {
  const source = Array.isArray(actionWindows?.windows) ? actionWindows.windows : [];
  const rows = source.map(featureForWindow).filter(Boolean);
  const counts = rows.reduce((out, row) => {
    out[row.actionType] = (out[row.actionType] || 0) + 1;
    return out;
  }, {});
  return {
    behaviorFeatureVersion: FEATURE_VERSION,
    sourceSessionId: actionWindows?.sourceSessionId || null,
    sourceActionWindowVersion: actionWindows?.actionWindowVersion || null,
    privacy: {
      printableHumanKeyContentStored: false,
      credentialValuesExpected: false
    },
    counts,
    rows
  };
}

function main(argv = process.argv.slice(2)) {
  const input = argv[0];
  if (!input) {
    console.error('Usage: node training-collector/tools/extract_behavior_features.js <session.raw.jsonl[.gz]> [output.json]');
    process.exitCode = 2;
    return;
  }
  const raw = Semantics.readRaw(input);
  const windows = Windows.buildActionWindows(raw);
  const result = extractBehaviorFeatures(windows);
  const output = argv[1] || `${input.replace(/\.raw\.jsonl(?:\.gz)?$/i, '')}.behavior-features.v02.json`;
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    input: path.resolve(input),
    output: path.resolve(output),
    sourceEvents: raw.events.length,
    actionWindows: windows.windows.length,
    featureRows: result.rows.length,
    counts: result.counts
  }, null, 2));
}

if (require.main === module) main();

module.exports = {
  FEATURE_VERSION,
  percentile,
  timingSummary,
  pointerPathSummary,
  targetGeometry,
  pointerPressSummary,
  targetAcquisitionSummary,
  keyboardRhythm,
  featureForWindow,
  extractBehaviorFeatures
};
