#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

function increment(map, key, amount = 1) {
  map[key] = (map[key] || 0) + amount;
}

function analyze(data) {
  const events = Array.isArray(data?.events) ? data.events : [];
  const typeCounts = {};
  const sourceCounts = {};
  const tabCounts = {};
  const frameCounts = {};
  const documentCounts = {};
  const pageInstanceCounts = {};
  const perFrameSources = {};
  const latestHealthByPage = new Map();
  const pointer = [];
  const pointerGaps = [];
  let semanticCorrelated = 0;
  let physicalEligible = 0;
  let domEvents = 0;
  let mutationEvents = 0;
  let mutationRecords = 0;
  let sensitiveRedFlags = 0;
  let seqProblems = 0;
  let timestampBackwards = 0;
  let routeChanges = 0;
  let semanticSnapshots = 0;
  let frameContexts = 0;
  let streamHealthEvents = 0;
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
    increment(typeCounts, type);
    const source = String(event?.captureSource || 'unknown');
    increment(sourceCounts, source);
    const tab = String(event?.tabId ?? 'null');
    increment(tabCounts, tab);
    const frame = `${tab}:${String(event?.frameId ?? 'null')}`;
    increment(frameCounts, frame);
    const documentId = String(event?.documentId || 'null');
    increment(documentCounts, documentId);
    const pageId = String(event?.pageInstanceId || 'null');
    increment(pageInstanceCounts, pageId);
    if (!perFrameSources[frame]) perFrameSources[frame] = {};
    increment(perFrameSources[frame], source);

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
      if (event.targetRef || event.semanticTarget?.elementRef) semanticCorrelated += 1;
    }
    if (type.startsWith('dom-')) domEvents += 1;
    if (type === 'dom-mutation' || type === 'dom-mutation-burst') {
      mutationEvents += 1;
      mutationRecords += type === 'dom-mutation-burst' ? Number(event.recordCount || 0) : 1;
    }
    if (type === 'route-change') routeChanges += 1;
    if (type === 'semantic-snapshot') semanticSnapshots += 1;
    if (type === 'frame-context') frameContexts += 1;
    if (type === 'collector-stream-start' || type === 'collector-stream-health' || type === 'collector-stream-stop') {
      streamHealthEvents += 1;
      if (event.pageInstanceId) latestHealthByPage.set(event.pageInstanceId, event);
    }
    scanForbidden(event);
  }

  const streamPages = [];
  let physicalOnlySuspicions = 0;
  let missingInitialSemantic = 0;
  for (const [pageInstanceId, event] of latestHealthByPage.entries()) {
    const counts = event.sourceEventCounts || {};
    const physical = Number(counts.physical || 0);
    const semantic = Number(counts.semantic || 0);
    const semanticSide = semantic + Number(counts.dom || 0) + Number(counts.hover || 0) + Number(counts.mutation || 0) + Number(counts.navigation || 0);
    const missingSemantic = semantic === 0;
    const suspicious = physical >= 50 && semanticSide === 0;
    if (missingSemantic) missingInitialSemantic += 1;
    if (suspicious) physicalOnlySuspicions += 1;
    streamPages.push({
      pageInstanceId,
      frameId: event.frameId ?? null,
      documentId: event.documentId || null,
      isTopFrame: event.isTopFrame ?? null,
      modules: event.modules || null,
      sourceEventCounts: counts,
      missingInitialSemantic: missingSemantic,
      physicalOnlySuspicion: suspicious
    });
  }

  const cleanPointerGaps = pointerGaps.filter(x => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  const timestamps = events.map(x => Number(x?.tsEpochMs)).filter(Number.isFinite);
  const durationMs = timestamps.length > 1 ? Math.max(0, Math.max(...timestamps) - Math.min(...timestamps)) : 0;

  return {
    exportVersion: data?.session?.schemaVersion || data?.exportVersion || null,
    sessionId: data?.session?.sessionId || null,
    totalEvents: events.length,
    durationMs,
    typeCounts,
    sourceCounts,
    tabCounts,
    frames: {
      uniqueTabFrames: Object.keys(frameCounts).length,
      uniqueDocuments: Object.keys(documentCounts).filter(x => x !== 'null').length,
      uniquePageInstances: Object.keys(pageInstanceCounts).filter(x => x !== 'null').length,
      eventCounts: frameCounts,
      sourceCountsByFrame: perFrameSources,
      frameContextEvents: frameContexts
    },
    navigation: { routeChanges, semanticSnapshots },
    streamHealth: {
      events: streamHealthEvents,
      pagesObserved: streamPages.length,
      missingInitialSemantic,
      physicalOnlySuspicions,
      pages: streamPages
    },
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
    dom: { events: domEvents, mutationEvents, mutationRecords },
    integrity: {
      sequenceProblems: seqProblems,
      timestampBackwards,
      privacyRedFlags: sensitiveRedFlags
    }
  };
}

function parseInput(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { events: [] };
  if (trimmed.startsWith('{') && trimmed.includes('\n')) {
    try { return JSON.parse(trimmed); } catch {}
  }
  const records = trimmed.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const sessionRecord = records.find(x => x.recordType === 'session') || {};
  return {
    exportVersion: sessionRecord.session?.schemaVersion || sessionRecord.exportVersion || null,
    exportedAt: sessionRecord.exportedAt || null,
    session: sessionRecord.session || null,
    events: records.filter(x => x.recordType === 'event').map(({ recordType, ...event }) => event)
  };
}

function readInputFile(file) {
  const full = path.resolve(file);
  const buffer = fs.readFileSync(full);
  const decoded = /\.gz$/i.test(full) ? zlib.gunzipSync(buffer) : buffer;
  return parseInput(decoded.toString('utf8'));
}

function main(argv) {
  const file = argv[2];
  if (!file) {
    console.error('Usage: node training-collector/tools/analyze_raw.js <export.raw.json|export.raw.jsonl|export.raw.jsonl.gz>');
    process.exitCode = 2;
    return;
  }
  const report = analyze(readInputFile(file));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) main(process.argv);
module.exports = { analyze, parseInput, readInputFile };
