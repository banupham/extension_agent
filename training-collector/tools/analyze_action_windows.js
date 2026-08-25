'use strict';

const path = require('path');
const Semantics = require('./build_action_semantics.js');
const Windows = require('./build_action_windows.js');

function ratio(n, d) { return d > 0 ? Math.round((n / d) * 10000) / 10000 : 0; }

function hasSemanticTarget(window) {
  return !!(window?.target?.targetRef && (window?.target?.label || window?.target?.role));
}

function strategyEligibility(window) {
  const type = window?.actionType || 'unknown';
  if (['scrollVertical', 'scrollHorizontal', 'pressKey'].includes(type)) {
    return { eligible: true, reason: 'action_semantics_self_contained' };
  }
  if (type === 'typeText') {
    const target = window?.target || {};
    const tag = String(target.tag || '').toLowerCase();
    const role = String(target.role || '').toLowerCase();
    const editableLike = ['input', 'textarea', 'select'].includes(tag) || ['textbox', 'searchbox', 'combobox'].includes(role);
    return editableLike && target.targetRef
      ? { eligible: true, reason: 'editable_target' }
      : { eligible: false, reason: 'missing_editable_target_semantics' };
  }
  if (['click', 'dismiss', 'toggle', 'focus', 'selectOption', 'submit', 'drag', 'hover', 'hoverAndObserve'].includes(type)) {
    return hasSemanticTarget(window)
      ? { eligible: true, reason: 'semantic_target_present' }
      : { eligible: false, reason: 'missing_semantic_target_label_or_role' };
  }
  return { eligible: false, reason: 'unsupported_strategy_family' };
}

function behaviorEvidence(window) {
  const type = window?.actionType || 'unknown';
  const before = Array.isArray(window?.before) ? window.before : [];
  const actionEvents = Array.isArray(window?.action?.events) ? window.action.events : [];
  if (['click', 'dismiss', 'toggle'].includes(type)) {
    const pointers = before.filter(event => event.type === 'pointer' && Number.isFinite(event.x) && Number.isFinite(event.y));
    return pointers.length
      ? { level: 'full', reason: 'pointer_lead_in_present', sampleCount: pointers.length }
      : { level: 'partial', reason: 'semantic_click_without_pointer_lead_in', sampleCount: 0 };
  }
  if (['hover', 'hoverAndObserve'].includes(type)) {
    const dwell = Number(window?.action?.dwellMs);
    const pointers = before.filter(event => event.type === 'pointer' && Number.isFinite(event.x) && Number.isFinite(event.y));
    if (pointers.length && Number.isFinite(dwell)) return { level: 'full', reason: 'approach_and_dwell_present', sampleCount: pointers.length };
    if (Number.isFinite(dwell)) return { level: 'partial', reason: 'dwell_present_approach_not_embedded', sampleCount: 0 };
    return { level: 'none', reason: 'missing_hover_timing', sampleCount: 0 };
  }
  if (['scrollVertical', 'scrollHorizontal'].includes(type)) {
    return actionEvents.length
      ? { level: 'full', reason: 'wheel_burst_present', sampleCount: actionEvents.length }
      : { level: 'none', reason: 'missing_wheel_burst', sampleCount: 0 };
  }
  if (['typeText', 'pressKey'].includes(type)) {
    return actionEvents.length
      ? { level: 'full', reason: 'keyboard_timing_present', sampleCount: actionEvents.length }
      : { level: 'none', reason: 'missing_keyboard_timing', sampleCount: 0 };
  }
  if (type === 'drag') {
    const points = Array.isArray(window?.action?.points) ? window.action.points : [];
    return points.length >= 2 && Number(window?.action?.distancePx || 0) > 0
      ? { level: 'full', reason: 'pointer_drag_series_present', sampleCount: points.length }
      : { level: 'none', reason: 'missing_drag_series', sampleCount: points.length };
  }
  if (['focus', 'selectOption', 'submit'].includes(type)) {
    const physical = before.filter(event => ['pointer', 'keyboard'].includes(event.type));
    return physical.length
      ? { level: 'partial', reason: 'physical_lead_in_present', sampleCount: physical.length }
      : { level: 'partial', reason: 'semantic_form_fact_only', sampleCount: 0 };
  }
  return { level: 'none', reason: 'unsupported_behavior_family', sampleCount: 0 };
}

function summarizeActionWindows(result) {
  const windows = Array.isArray(result?.windows) ? result.windows : [];
  const byType = {};
  let targeted = 0;
  let labeled = 0;
  let enriched = 0;
  let mutationOutcome = 0;
  let routeOutcome = 0;
  let clickWithPointerLeadIn = 0;
  let keyboardWindows = 0;
  let keyboardPrintableLeakSuspected = 0;
  let strategyEligible = 0;
  let behaviorFull = 0;
  let behaviorPartial = 0;
  let behaviorNone = 0;
  const strategyRejectedReasons = {};
  const behaviorReasons = {};
  const frames = new Set();

  for (const window of windows) {
    const type = window.actionType || 'unknown';
    const row = byType[type] = byType[type] || {
      count: 0, targeted: 0, labeled: 0, enriched: 0,
      strategyEligible: 0, behaviorFull: 0, behaviorPartial: 0, behaviorNone: 0
    };
    row.count += 1;
    if (window.context?.frameId != null) frames.add(`${window.context?.tabId ?? '?'}::${window.context.frameId}`);
    if (window.target?.targetRef) {
      targeted += 1;
      row.targeted += 1;
      if (window.target.label) { labeled += 1; row.labeled += 1; }
      if (window.target.labelEnriched) { enriched += 1; row.enriched += 1; }
    }
    if (Number(window.outcome?.mutationBurstCount || 0) > 0) mutationOutcome += 1;
    if (window.outcome?.routeChangeObserved) routeOutcome += 1;
    if (type === 'click' || type === 'dismiss' || type === 'toggle') {
      if ((window.before || []).some(event => event.type === 'pointer' && Number.isFinite(event.x) && Number.isFinite(event.y))) clickWithPointerLeadIn += 1;
    }
    if (type === 'typeText' || type === 'pressKey') {
      keyboardWindows += 1;
      const serialized = JSON.stringify(window.action || {});
      if (/"key"\s*:\s*".+?"/.test(serialized) || /"text"\s*:\s*".+?"/.test(serialized)) keyboardPrintableLeakSuspected += 1;
    }

    const strategy = strategyEligibility(window);
    if (strategy.eligible) { strategyEligible += 1; row.strategyEligible += 1; }
    else strategyRejectedReasons[strategy.reason] = (strategyRejectedReasons[strategy.reason] || 0) + 1;

    const behavior = behaviorEvidence(window);
    if (behavior.level === 'full') { behaviorFull += 1; row.behaviorFull += 1; }
    else if (behavior.level === 'partial') { behaviorPartial += 1; row.behaviorPartial += 1; }
    else { behaviorNone += 1; row.behaviorNone += 1; }
    behaviorReasons[behavior.reason] = (behaviorReasons[behavior.reason] || 0) + 1;
  }

  for (const row of Object.values(byType)) {
    row.labelCoverage = ratio(row.labeled, row.targeted);
    row.enrichmentRate = ratio(row.enriched, row.targeted);
    row.strategyEligibilityRate = ratio(row.strategyEligible, row.count);
    row.behaviorFullRate = ratio(row.behaviorFull, row.count);
  }

  const clickLikeCount = ['click', 'dismiss', 'toggle'].reduce((n, type) => n + Number(byType[type]?.count || 0), 0);
  return {
    actionWindowVersion: result?.actionWindowVersion || null,
    sourceSessionId: result?.sourceSessionId || null,
    totalWindows: windows.length,
    byType,
    targetQuality: {
      targeted,
      labeled,
      enriched,
      labelCoverage: ratio(labeled, targeted),
      enrichmentRate: ratio(enriched, targeted)
    },
    trainingEligibility: {
      strategy: {
        eligible: strategyEligible,
        rejected: windows.length - strategyEligible,
        eligibilityRate: ratio(strategyEligible, windows.length),
        rejectedReasons: strategyRejectedReasons
      },
      behavior: {
        full: behaviorFull,
        partial: behaviorPartial,
        none: behaviorNone,
        fullRate: ratio(behaviorFull, windows.length),
        reasons: behaviorReasons
      }
    },
    behaviorEvidence: {
      clickLikeCount,
      clickWithPointerLeadIn,
      clickPointerLeadInCoverage: ratio(clickWithPointerLeadIn, clickLikeCount),
      dragCount: Number(byType.drag?.count || 0),
      horizontalScrollCount: Number(byType.scrollHorizontal?.count || 0),
      verticalScrollCount: Number(byType.scrollVertical?.count || 0),
      frameContexts: frames.size
    },
    outcomeCoverage: {
      mutationPositive: mutationOutcome,
      mutationPositiveRate: ratio(mutationOutcome, windows.length),
      routePositive: routeOutcome,
      routePositiveRate: ratio(routeOutcome, windows.length)
    },
    derivation: result?.derivation || {},
    privacy: {
      keyboardWindows,
      printableLeakSuspected: keyboardPrintableLeakSuspected,
      printableContentContractOk: keyboardPrintableLeakSuspected === 0 && result?.privacy?.printableHumanKeyContentStored === false
    }
  };
}

function main(argv = process.argv.slice(2)) {
  const input = argv[0];
  if (!input) {
    console.error('Usage: node training-collector/tools/analyze_action_windows.js <session.raw.jsonl[.gz]>');
    process.exitCode = 2;
    return;
  }
  const raw = Semantics.readRaw(input);
  const result = Windows.buildActionWindows(raw);
  const summary = summarizeActionWindows(result);
  console.log(JSON.stringify({ input: path.resolve(input), sourceEvents: raw.events.length, ...summary }, null, 2));
}

if (require.main === module) main();

module.exports = { strategyEligibility, behaviorEvidence, summarizeActionWindows };
