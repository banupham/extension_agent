'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function readRaw(filePath) {
  let buf = fs.readFileSync(filePath);
  if (/\.gz$/i.test(filePath)) buf = zlib.gunzipSync(buf);
  const text = buf.toString('utf8').trim();
  if (!text) return { session: null, events: [] };

  if (text.startsWith('{') && !text.includes('\n')) {
    const obj = JSON.parse(text);
    return { session: obj.session || obj, events: Array.isArray(obj.events) ? obj.events : [] };
  }

  if (text.startsWith('{') && text.includes('"events"') && !/\n\s*\{\s*"recordType"/.test(text)) {
    try {
      const obj = JSON.parse(text);
      return { session: obj.session || obj, events: Array.isArray(obj.events) ? obj.events : [] };
    } catch {}
  }

  let session = null;
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.recordType === 'session') session = row.session || row;
    else if (row.recordType === 'event') {
      const { recordType, ...event } = row;
      events.push(event);
    }
  }
  return { session, events };
}

function eventOrder(a, b) {
  if (a.pageInstanceId && b.pageInstanceId && a.pageInstanceId === b.pageInstanceId) {
    const ap = Number(a.pageSeq);
    const bp = Number(b.pageSeq);
    if (Number.isFinite(ap) && Number.isFinite(bp) && ap !== bp) return ap - bp;
  }
  const at = Number(a.tsEpochMs || 0);
  const bt = Number(b.tsEpochMs || 0);
  if (at !== bt) return at - bt;
  return Number(a.sessionSeq || 0) - Number(b.sessionSeq || 0);
}

function buildHoverActions(events, options = {}) {
  const maxWindowMs = Number(options.maxWindowMs || 4000);
  const outcomeTailMs = Number(options.outcomeTailMs || 500);
  const minPreviewDwellMs = Number(options.minPreviewDwellMs || 300);
  const ordered = [...events].sort(eventOrder);
  const active = new Map();
  const actions = [];

  function key(event) {
    return `${event.pageInstanceId || 'page?'}::${event.targetRef || 'target?'}`;
  }

  function closeHover(state, endEvent, reason) {
    if (!state) return;
    const endTs = Number(endEvent?.tsEpochMs || state.lastTs || state.startedAt);
    const dwellMs = Math.max(Number(state.maxDwellMs || 0), Math.max(0, endTs - state.startedAt));
    const mutationRecordCount = state.mutations.reduce((n, e) => n + Number(e.recordCount || 0), 0);
    const addedRefs = [...new Set(state.mutations.flatMap(e => Array.isArray(e.addedRefs) ? e.addedRefs : []))].slice(0, 40);
    const clicked = state.clicks.length > 0;
    const previewLike = dwellMs >= minPreviewDwellMs && mutationRecordCount > 0 && !clicked;

    actions.push({
      schemaVersion: '0.7.0-derived',
      actionType: previewLike ? 'hover-preview' : (dwellMs >= minPreviewDwellMs ? 'hover-dwell' : 'hover'),
      pageInstanceId: state.pageInstanceId,
      targetRef: state.targetRef,
      startedAtEpochMs: state.startedAt,
      endedAtEpochMs: endTs,
      dwellMs: Math.round(dwellMs),
      closeReason: reason,
      outcome: {
        mutationBurstCount: state.mutations.length,
        mutationRecordCount,
        addedRefs,
        clickOccurred: clicked,
        navigationObserved: false,
        previewLikeStateChange: previewLike
      },
      evidence: {
        enterPageSeq: state.enter.pageSeq ?? null,
        dwellPageSeq: state.dwell?.pageSeq ?? null,
        leavePageSeq: endEvent?.pageSeq ?? null,
        mutationPageSeqs: state.mutations.map(e => e.pageSeq).filter(Number.isFinite).slice(0, 50)
      }
    });
  }

  for (const event of ordered) {
    const ts = Number(event.tsEpochMs || 0);

    for (const [k, state] of [...active.entries()]) {
      if (ts > state.startedAt + maxWindowMs) {
        closeHover(state, { tsEpochMs: state.startedAt + maxWindowMs, pageSeq: event.pageSeq }, 'timeout');
        active.delete(k);
      }
    }

    if (event.type === 'dom-hover-enter' && event.targetRef) {
      const k = key(event);
      if (active.has(k)) closeHover(active.get(k), event, 'reenter');
      active.set(k, {
        pageInstanceId: event.pageInstanceId || null,
        targetRef: event.targetRef,
        startedAt: ts,
        lastTs: ts,
        enter: event,
        dwell: null,
        maxDwellMs: 0,
        mutations: [],
        clicks: []
      });
      continue;
    }

    if (event.type === 'dom-hover-dwell' && event.targetRef) {
      const state = active.get(key(event));
      if (state) {
        state.dwell = event;
        state.maxDwellMs = Math.max(state.maxDwellMs, Number(event.dwellMs || 0));
        state.lastTs = ts;
      }
      continue;
    }

    if (event.type === 'dom-hover-leave' && event.targetRef) {
      const k = key(event);
      const state = active.get(k);
      if (state) {
        state.maxDwellMs = Math.max(state.maxDwellMs, Number(event.dwellMs || 0));
        closeHover(state, event, 'leave');
        active.delete(k);
      }
      continue;
    }

    if (event.type === 'dom-mutation-burst') {
      for (const state of active.values()) {
        if (state.pageInstanceId !== (event.pageInstanceId || null)) continue;
        if (ts < state.startedAt || ts > state.startedAt + maxWindowMs + outcomeTailMs) continue;
        const refs = new Set([...(event.targetRefs || []), ...(event.addedRefs || []), ...(event.removedRefs || [])]);
        if (refs.has(state.targetRef) || (event.addedRefs || []).length || (event.attributes && Object.keys(event.attributes).length)) {
          state.mutations.push(event);
          state.lastTs = ts;
        }
      }
      continue;
    }

    if (event.type === 'dom-click') {
      const refs = new Set([event.targetRef, event.rawTargetRef, event.resolvedTargetRef].filter(Boolean));
      for (const state of active.values()) {
        if (state.pageInstanceId === (event.pageInstanceId || null) && refs.has(state.targetRef)) state.clicks.push(event);
      }
    }
  }

  for (const state of active.values()) closeHover(state, { tsEpochMs: state.lastTs }, 'stream-end');
  return actions;
}

function buildActionSemantics(raw, options = {}) {
  return {
    schemaVersion: '0.7.0-derived',
    sourceSessionId: raw.session?.sessionId || null,
    hoverActions: buildHoverActions(raw.events || [], options)
  };
}

function main(argv = process.argv.slice(2)) {
  const input = argv[0];
  if (!input) {
    console.error('Usage: node training-collector/tools/build_action_semantics.js <session.raw.jsonl.gz> [output.json]');
    process.exitCode = 2;
    return;
  }
  const raw = readRaw(input);
  const result = buildActionSemantics(raw);
  const output = argv[1] || `${input.replace(/\.raw\.jsonl(?:\.gz)?$/i, '')}.actions.v07.json`;
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    input: path.resolve(input),
    output: path.resolve(output),
    events: raw.events.length,
    hoverActions: result.hoverActions.length,
    hoverPreviewActions: result.hoverActions.filter(x => x.actionType === 'hover-preview').length
  }, null, 2));
}

if (require.main === module) main();

module.exports = { readRaw, eventOrder, buildHoverActions, buildActionSemantics };
