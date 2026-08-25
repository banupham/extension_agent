#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

function analyze(data) {
  const events = Array.isArray(data?.events) ? data.events : [];
  const typeCounts = {};
  const sourceCounts = {};
  const tabCounts = {};
  const pointer = [];
  const pointerGaps = [];
  let semanticCorrelated = 0;
  let physicalEligible = 0;
  let domEvents = 0;
  let mutationEvents = 0;
  let sensitiveRedFlags = 0;
  let seqProblems = 0;
  let timestampBackwards = 0;
  let lastSeq = null;
  let lastTs = null;
  let lastPointerTs = null;

  const forbiddenKeys = /^(value|text|innerText|outerHTML|html|password|cookie|authorization|clipboard|token|secret)$/i;

  function scanForbidden(value, depth = 0) {
    if (!value || depth > 5) return;
    if (Array.isArray(value)) {
      for (const item of value) scanForbidden(item, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.test(key) && child != null && child !== '' && child !== false) sensitiveRedFlags += 1;
      scanForbidden(child, depth + 1);
    }
  }

  for (const event of events) {
    const type = String(event?.type || 'unknown');
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    const source = String(event?.captureSource || 'unknown');
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    const tab = String(event?.tabId ?? 'null');
    tabCounts[tab] = (tabCounts[tab] || 0) + 1;

    const seq = Number(event?.sessionSeq);
    if (Number.isFinite(seq)) {
      if (lastSeq != null && seq !== lastSeq + 1) seqProblems += 1;
      lastSeq = seq;
    }

    const ts = Number(event?.tsEpochMs);
    if (Number.isFinite(ts)) {
      if (lastTs != null && ts < lastTs) timestampBackwards += 1;
      lastTs = ts;
    }

    if (type === 'pointer') {
      pointer.push(event);
      if (lastPointerTs != null && Number.isFinite(ts)) pointerGaps.push(ts - lastPointerTs);
      if (Number.isFinite(ts)) lastPointerTs = ts;
    }

    if (type === 'pointer' || type === 'wheel' || type === 'keyboard') {
      physicalEligible += 1;
      if (event.semanticTarget?.elementRef) semanticCorrelated += 1;
    }
    if (type.startsWith('dom-')) domEvents += 1;
    if (type === 'dom-mutation') mutationEvents += 1;
    scanForbidden(event);
  }

  const cleanPointerGaps = pointerGaps.filter(x => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  const durationMs = events.length > 1
    ? Math.max(0, Number(events[events.length - 1]?.tsEpochMs || 0) - Number(events[0]?.tsEpochMs || 0))
    : 0;

  return {
    exportVersion: data?.exportVersion || null,
    sessionId: data?.session?.sessionId || null,
    totalEvents: events.length,
    durationMs,
    typeCounts,
    sourceCounts,
    tabCounts,
    pointer: {
      samples: pointer.length,
      gapMs: {
        p50: percentile(cleanPointerGaps, 0.50),
        p90: percentile(cleanPointerGaps, 0.90),
        p99: percentile(cleanPointerGaps, 0.99),
        max: cleanPointerGaps.length ? cleanPointerGaps[cleanPointerGaps.length - 1] : null
      }
    },
    semanticCorrelation: {
      eligiblePhysicalEvents: physicalEligible,
      correlatedEvents: semanticCorrelated,
      coverage: physicalEligible ? semanticCorrelated / physicalEligible : null
    },
    dom: { events: domEvents, mutations: mutationEvents },
    integrity: {
      sequenceProblems: seqProblems,
      timestampBackwards,
      privacyRedFlags: sensitiveRedFlags
    }
  };
}

function main(argv) {
  const file = argv[2];
  if (!file) {
    console.error('Usage: node training-collector/tools/analyze_raw.js <export.raw.json>');
    process.exitCode = 2;
    return;
  }
  const full = path.resolve(file);
  const data = JSON.parse(fs.readFileSync(full, 'utf8'));
  const report = analyze(data);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) main(process.argv);
module.exports = { analyze };
