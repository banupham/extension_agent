'use strict';

const path = require('path');
const Semantics = require('./build_action_semantics.js');
const Windows = require('./build_action_windows.js');

function ratio(n, d) { return d > 0 ? Math.round((n / d) * 10000) / 10000 : 0; }

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
  const frames = new Set();

  for (const window of windows) {
    const type = window.actionType || 'unknown';
    const row = byType[type] = byType[type] || { count: 0, targeted: 0, labeled: 0, enriched: 0 };
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
  }

  for (const row of Object.values(byType)) {
    row.labelCoverage = ratio(row.labeled, row.targeted);
    row.enrichmentRate = ratio(row.enriched, row.targeted);
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

module.exports = { summarizeActionWindows };
