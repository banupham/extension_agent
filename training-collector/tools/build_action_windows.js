'use strict';

const fs = require('fs');
const path = require('path');
const Semantics = require('./build_action_semantics.js');

const DERIVED_VERSION = '0.1.0';

function chronologicalOrder(a, b) {
  const at = Number(a?.tsEpochMs || 0);
  const bt = Number(b?.tsEpochMs || 0);
  if (at !== bt) return at - bt;
  const ap = Number(a?.pageSeq || 0);
  const bp = Number(b?.pageSeq || 0);
  if (a?.pageInstanceId && a.pageInstanceId === b?.pageInstanceId && ap !== bp) return ap - bp;
  return Number(a?.sessionSeq || 0) - Number(b?.sessionSeq || 0);
}

function sameContext(a, b) {
  if (!a || !b) return false;
  if (a.pageInstanceId && b.pageInstanceId && a.pageInstanceId !== b.pageInstanceId) return false;
  if (a.tabId != null && b.tabId != null && a.tabId !== b.tabId) return false;
  if (a.frameId != null && b.frameId != null && a.frameId !== b.frameId) return false;
  return true;
}

function eventRef(event) {
  return {
    type: event.type || null,
    tsEpochMs: Number(event.tsEpochMs || 0),
    sessionSeq: Number(event.sessionSeq || 0) || null,
    pageSeq: Number(event.pageSeq || 0) || null,
    sourceSeq: Number(event.sourceSeq || 0) || null,
    targetRef: event.targetRef || null,
    rawTargetRef: event.rawTargetRef || null,
    resolvedTargetRef: event.resolvedTargetRef || null
  };
}

function targetRefFor(event) {
  return event?.resolvedTargetRef || event?.targetRef || event?.rawTargetRef || null;
}

function targetContext(event) {
  const descriptor = event?.resolvedTarget || event?.target || event?.semanticTarget || event?.targetDescriptor || null;
  const raw = event?.rawTarget || null;
  function pick(source, key) {
    if (!source || typeof source !== 'object') return null;
    const value = source[key];
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
  }
  return {
    targetRef: targetRefFor(event),
    rawTargetRef: event?.rawTargetRef || event?.targetRef || null,
    resolvedTargetRef: event?.resolvedTargetRef || null,
    role: pick(descriptor, 'role') || pick(raw, 'role'),
    label: pick(descriptor, 'label') || pick(descriptor, 'accessibleName') || pick(raw, 'label') || null,
    tag: pick(descriptor, 'tag') || pick(raw, 'tag'),
    rect: descriptor?.rect && typeof descriptor.rect === 'object' ? descriptor.rect : (raw?.rect && typeof raw.rect === 'object' ? raw.rect : null),
    frameId: event?.frameId ?? null,
    pageInstanceId: event?.pageInstanceId || null
  };
}

function collectWindow(ordered, anchor, beforeMs, afterMs) {
  const ts = Number(anchor.tsEpochMs || 0);
  return ordered.filter(event => sameContext(anchor, event) && Number(event.tsEpochMs || 0) >= ts - beforeMs && Number(event.tsEpochMs || 0) <= ts + afterMs);
}

function outcomeFrom(events, anchorTs) {
  const after = events.filter(event => Number(event.tsEpochMs || 0) >= anchorTs);
  const mutations = after.filter(event => event.type === 'dom-mutation-burst');
  const routes = after.filter(event => event.type === 'route-change');
  const snapshots = after.filter(event => event.type === 'semantic-snapshot');
  return {
    mutationBurstCount: mutations.length,
    mutationRecordCount: mutations.reduce((n, event) => n + Number(event.recordCount || 0), 0),
    routeChangeObserved: routes.length > 0,
    semanticSnapshotObserved: snapshots.length > 0,
    routeEvidence: routes.slice(0, 4).map(eventRef)
  };
}

function clickWindows(ordered, options) {
  const beforeMs = Number(options.beforeMs || 1200);
  const afterMs = Number(options.afterMs || 1200);
  return ordered.filter(event => event.type === 'dom-click').map((anchor, index) => {
    const windowEvents = collectWindow(ordered, anchor, beforeMs, afterMs);
    return {
      actionWindowVersion: DERIVED_VERSION,
      actionId: `click-${index + 1}-${Number(anchor.sessionSeq || anchor.pageSeq || 0)}`,
      actionType: 'click',
      anchorTsEpochMs: Number(anchor.tsEpochMs || 0),
      context: {
        tabId: anchor.tabId ?? null,
        frameId: anchor.frameId ?? null,
        pageInstanceId: anchor.pageInstanceId || null
      },
      target: targetContext(anchor),
      before: windowEvents.filter(event => Number(event.tsEpochMs || 0) < Number(anchor.tsEpochMs || 0)).map(eventRef),
      action: eventRef(anchor),
      after: windowEvents.filter(event => Number(event.tsEpochMs || 0) > Number(anchor.tsEpochMs || 0)).map(eventRef),
      outcome: outcomeFrom(windowEvents, Number(anchor.tsEpochMs || 0))
    };
  });
}

function scrollWindows(ordered, options) {
  const gapMs = Number(options.scrollGapMs || 220);
  const wheels = ordered.filter(event => event.type === 'wheel');
  const groups = [];
  let current = null;
  for (const event of wheels) {
    const dx = Number(event.deltaX || 0);
    const dy = Number(event.deltaY || 0);
    const axis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
    const ts = Number(event.tsEpochMs || 0);
    if (!current || !sameContext(current.anchor, event) || current.axis !== axis || ts - current.lastTs > gapMs) {
      current = { anchor: event, axis, events: [], lastTs: ts };
      groups.push(current);
    }
    current.events.push(event);
    current.lastTs = ts;
  }
  return groups.map((group, index) => ({
    actionWindowVersion: DERIVED_VERSION,
    actionId: `scroll-${index + 1}-${Number(group.anchor.sessionSeq || group.anchor.pageSeq || 0)}`,
    actionType: group.axis === 'horizontal' ? 'scrollHorizontal' : 'scrollVertical',
    anchorTsEpochMs: Number(group.anchor.tsEpochMs || 0),
    context: {
      tabId: group.anchor.tabId ?? null,
      frameId: group.anchor.frameId ?? null,
      pageInstanceId: group.anchor.pageInstanceId || null
    },
    target: targetContext(group.anchor),
    before: [],
    action: {
      startTsEpochMs: Number(group.events[0]?.tsEpochMs || 0),
      endTsEpochMs: Number(group.events[group.events.length - 1]?.tsEpochMs || 0),
      eventCount: group.events.length,
      axis: group.axis,
      deltaX: group.events.reduce((n, e) => n + Number(e.deltaX || 0), 0),
      deltaY: group.events.reduce((n, e) => n + Number(e.deltaY || 0), 0),
      events: group.events.map(eventRef)
    },
    after: [],
    outcome: {}
  }));
}

function keyboardWindows(ordered, options) {
  const gapMs = Number(options.keyboardGapMs || 450);
  const keys = ordered.filter(event => event.type === 'keyboard');
  const groups = [];
  let current = null;
  for (const event of keys) {
    const ts = Number(event.tsEpochMs || 0);
    const target = targetRefFor(event);
    if (!current || !sameContext(current.anchor, event) || current.target !== target || ts - current.lastTs > gapMs) {
      current = { anchor: event, target, events: [], lastTs: ts };
      groups.push(current);
    }
    current.events.push(event);
    current.lastTs = ts;
  }
  return groups.map((group, index) => {
    const operations = group.events.map(event => event.operation || event.keyClass || 'unknown');
    const typeTextLike = operations.some(op => op === 'printable');
    return {
      actionWindowVersion: DERIVED_VERSION,
      actionId: `keyboard-${index + 1}-${Number(group.anchor.sessionSeq || group.anchor.pageSeq || 0)}`,
      actionType: typeTextLike ? 'typeText' : 'pressKey',
      anchorTsEpochMs: Number(group.anchor.tsEpochMs || 0),
      context: {
        tabId: group.anchor.tabId ?? null,
        frameId: group.anchor.frameId ?? null,
        pageInstanceId: group.anchor.pageInstanceId || null
      },
      target: targetContext(group.anchor),
      before: [],
      action: {
        startTsEpochMs: Number(group.events[0]?.tsEpochMs || 0),
        endTsEpochMs: Number(group.events[group.events.length - 1]?.tsEpochMs || 0),
        eventCount: group.events.length,
        operationClasses: operations,
        printableContentStored: false,
        events: group.events.map(eventRef)
      },
      after: [],
      outcome: {}
    };
  });
}

function hoverWindows(raw, ordered) {
  const derived = Semantics.buildActionSemantics(raw);
  return (derived.hoverActions || []).map((action, index) => ({
    actionWindowVersion: DERIVED_VERSION,
    actionId: `hover-${index + 1}-${Number(action.evidence?.enterPageSeq || 0)}`,
    actionType: action.actionType === 'hover-preview' ? 'hoverAndObserve' : 'hover',
    anchorTsEpochMs: Number(action.startedAtEpochMs || 0),
    context: { pageInstanceId: action.pageInstanceId || null },
    target: { targetRef: action.targetRef || null, pageInstanceId: action.pageInstanceId || null },
    before: [],
    action: {
      startTsEpochMs: action.startedAtEpochMs,
      endTsEpochMs: action.endedAtEpochMs,
      dwellMs: action.dwellMs,
      derivedHoverType: action.actionType
    },
    after: [],
    outcome: action.outcome || {}
  }));
}

function buildActionWindows(raw, options = {}) {
  const ordered = [...(raw.events || [])].sort(chronologicalOrder);
  const windows = [
    ...clickWindows(ordered, options),
    ...hoverWindows(raw, ordered),
    ...scrollWindows(ordered, options),
    ...keyboardWindows(ordered, options)
  ].sort((a, b) => Number(a.anchorTsEpochMs || 0) - Number(b.anchorTsEpochMs || 0));

  return {
    actionWindowVersion: DERIVED_VERSION,
    sourceSessionId: raw.session?.sessionId || null,
    ordering: {
      primary: 'tsEpochMs',
      local: ['pageSeq', 'sourceSeq'],
      durabilityOnly: 'sessionSeq'
    },
    privacy: {
      printableHumanKeyContentStored: false,
      rawCredentialValuesExpected: false
    },
    counts: windows.reduce((out, item) => {
      out[item.actionType] = (out[item.actionType] || 0) + 1;
      return out;
    }, {}),
    windows
  };
}

function main(argv = process.argv.slice(2)) {
  const input = argv[0];
  if (!input) {
    console.error('Usage: node training-collector/tools/build_action_windows.js <session.raw.jsonl[.gz]> [output.json]');
    process.exitCode = 2;
    return;
  }
  const raw = Semantics.readRaw(input);
  const result = buildActionWindows(raw);
  const output = argv[1] || `${input.replace(/\.raw\.jsonl(?:\.gz)?$/i, '')}.action-windows.v01.json`;
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    input: path.resolve(input),
    output: path.resolve(output),
    sourceEvents: raw.events.length,
    windows: result.windows.length,
    counts: result.counts
  }, null, 2));
}

if (require.main === module) main();

module.exports = {
  DERIVED_VERSION,
  chronologicalOrder,
  sameContext,
  targetContext,
  clickWindows,
  scrollWindows,
  keyboardWindows,
  buildActionWindows
};
