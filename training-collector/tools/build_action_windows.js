'use strict';

const fs = require('fs');
const path = require('path');
const Semantics = require('./build_action_semantics.js');

const DERIVED_VERSION = '0.1.2';
const GENERIC_HOVER_TAGS = new Set(['html', 'body', 'main', 'ytd-app', 'ytd-browse', 'tp-yt-app-drawer']);
const ACTIONABLE_TAGS = new Set(['a', 'button', 'input', 'textarea', 'select', 'video', 'audio']);

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

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function eventRef(event) {
  const out = {
    type: event.type || null,
    tsEpochMs: Number(event.tsEpochMs || 0),
    sessionSeq: Number(event.sessionSeq || 0) || null,
    pageSeq: Number(event.pageSeq || 0) || null,
    sourceSeq: Number(event.sourceSeq || 0) || null,
    targetRef: event.targetRef || null,
    rawTargetRef: event.rawTargetRef || null,
    resolvedTargetRef: event.resolvedTargetRef || null
  };
  if (event.type === 'pointer') {
    Object.assign(out, {
      phase: event.phase || null,
      pointerType: event.pointerType || null,
      pointerId: finiteOrNull(event.pointerId),
      x: finiteOrNull(event.x), y: finiteOrNull(event.y),
      movementX: finiteOrNull(event.movementX), movementY: finiteOrNull(event.movementY),
      button: finiteOrNull(event.button), buttons: finiteOrNull(event.buttons), pressure: finiteOrNull(event.pressure)
    });
  } else if (event.type === 'wheel') {
    Object.assign(out, {
      x: finiteOrNull(event.x), y: finiteOrNull(event.y),
      deltaX: finiteOrNull(event.deltaX), deltaY: finiteOrNull(event.deltaY), deltaZ: finiteOrNull(event.deltaZ),
      deltaMode: finiteOrNull(event.deltaMode)
    });
  } else if (event.type === 'keyboard') {
    Object.assign(out, {
      phase: event.phase || null,
      operation: event.operation || null,
      keyClass: event.keyClass || null,
      code: event.operation === 'printable' ? null : (event.code || null),
      repeat: !!event.repeat,
      modifiers: event.modifiers && typeof event.modifiers === 'object' ? event.modifiers : null
    });
  }
  return out;
}

function targetRefFor(event) {
  return event?.resolvedTargetRef || event?.targetRef || event?.rawTargetRef || null;
}

function contextKey(event, ref) {
  return [event?.tabId ?? '?', event?.frameId ?? '?', event?.pageInstanceId || '?', ref || '?'].join('::');
}

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
}

function descriptorLabel(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') return null;
  return cleanString(descriptor.label) || cleanString(descriptor.accessibleName) || cleanString(descriptor.ariaLabel) || cleanString(descriptor.placeholder);
}

function descriptorQuality(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') return -1;
  let score = 0;
  if (descriptorLabel(descriptor)) score += 8;
  if (cleanString(descriptor.role)) score += 4;
  if (cleanString(descriptor.tag)) score += 2;
  if (descriptor.rect && typeof descriptor.rect === 'object') score += 1;
  return score;
}

function buildDescriptorIndex(ordered) {
  const index = new Map();
  function put(event, ref, descriptor, source) {
    if (!ref || !descriptor || typeof descriptor !== 'object') return;
    const key = contextKey(event, ref);
    const next = { descriptor, source, quality: descriptorQuality(descriptor) };
    const prev = index.get(key);
    if (!prev || next.quality > prev.quality) index.set(key, next);
  }
  for (const event of ordered) {
    put(event, event.resolvedTargetRef, event.resolvedTarget || event.resolvedSemantic, 'resolved-event');
    put(event, event.rawTargetRef, event.rawTarget || event.rawSemantic, 'raw-event');
    put(event, event.targetRef, event.target || event.semanticTarget || event.targetDescriptor, 'target-event');
    if (event.type === 'semantic-snapshot') {
      const elements = event.observation?.interactiveElements || event.snapshot?.interactiveElements || event.interactiveElements || [];
      for (const element of elements) put(event, element?.ref, element, 'semantic-snapshot');
    }
  }
  return index;
}

function indexedDescriptor(index, event, ref) {
  return ref ? index?.get(contextKey(event, ref)) || null : null;
}

function targetContext(event, descriptorIndex = null) {
  const resolved = event?.resolvedTarget || event?.resolvedSemantic || null;
  const raw = event?.rawTarget || event?.rawSemantic || null;
  const direct = event?.target || event?.semanticTarget || event?.targetDescriptor || null;
  const resolvedRef = event?.resolvedTargetRef || null;
  const rawRef = event?.rawTargetRef || event?.targetRef || null;
  const targetRef = targetRefFor(event);
  const resolvedIndexed = indexedDescriptor(descriptorIndex, event, resolvedRef || targetRef);
  const rawIndexed = indexedDescriptor(descriptorIndex, event, rawRef);
  const descriptor = resolved || resolvedIndexed?.descriptor || direct || raw || rawIndexed?.descriptor || null;
  const labelCandidates = [
    [descriptorLabel(resolved), 'resolved'],
    [descriptorLabel(resolvedIndexed?.descriptor), resolvedIndexed?.source || 'resolved-index'],
    [descriptorLabel(direct), 'target'],
    [descriptorLabel(raw), rawRef && rawRef !== resolvedRef ? 'raw-descendant' : 'raw'],
    [descriptorLabel(rawIndexed?.descriptor), rawRef && rawRef !== resolvedRef ? 'raw-descendant-index' : (rawIndexed?.source || 'raw-index')]
  ];
  const labelEntry = labelCandidates.find(([label]) => !!label) || [null, null];
  const role = cleanString(resolved?.role) || cleanString(resolvedIndexed?.descriptor?.role) || cleanString(direct?.role) || cleanString(raw?.role) || cleanString(rawIndexed?.descriptor?.role);
  const tag = cleanString(resolved?.tag) || cleanString(resolvedIndexed?.descriptor?.tag) || cleanString(direct?.tag) || cleanString(raw?.tag) || cleanString(rawIndexed?.descriptor?.tag);
  const rect = resolved?.rect || resolvedIndexed?.descriptor?.rect || direct?.rect || raw?.rect || rawIndexed?.descriptor?.rect || null;
  return {
    targetRef, rawTargetRef: rawRef, resolvedTargetRef: resolvedRef,
    role, label: labelEntry[0], labelSource: labelEntry[1],
    labelEnriched: !!labelEntry[0] && !descriptorLabel(resolved), tag,
    rect: rect && typeof rect === 'object' ? rect : null,
    frameId: event?.frameId ?? null, pageInstanceId: event?.pageInstanceId || null
  };
}

function isMeaningfulHoverTarget(target, action) {
  if (!target) return false;
  const tag = String(target.tag || '').toLowerCase();
  const role = String(target.role || '').toLowerCase();
  const hasLabel = !!target.label;
  const previewOutcome = !!action?.outcome?.previewLikeStateChange;
  if (hasLabel || role || ACTIONABLE_TAGS.has(tag) || previewOutcome) return true;
  if (GENERIC_HOVER_TAGS.has(tag)) return false;
  return !!target.targetRef;
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

function clickWindows(ordered, options, descriptorIndex) {
  const beforeMs = Number(options.beforeMs || 1200);
  const afterMs = Number(options.afterMs || 1200);
  return ordered.filter(event => event.type === 'dom-click').map((anchor, index) => {
    const windowEvents = collectWindow(ordered, anchor, beforeMs, afterMs);
    return {
      actionWindowVersion: DERIVED_VERSION,
      actionId: `click-${index + 1}-${Number(anchor.sessionSeq || anchor.pageSeq || 0)}`,
      actionType: 'click', anchorTsEpochMs: Number(anchor.tsEpochMs || 0),
      context: { tabId: anchor.tabId ?? null, frameId: anchor.frameId ?? null, pageInstanceId: anchor.pageInstanceId || null },
      target: targetContext(anchor, descriptorIndex),
      before: windowEvents.filter(event => Number(event.tsEpochMs || 0) < Number(anchor.tsEpochMs || 0)).map(eventRef),
      action: eventRef(anchor),
      after: windowEvents.filter(event => Number(event.tsEpochMs || 0) > Number(anchor.tsEpochMs || 0)).map(eventRef),
      outcome: outcomeFrom(windowEvents, Number(anchor.tsEpochMs || 0))
    };
  });
}

function dragWindows(ordered, options, descriptorIndex) {
  const minDistancePx = Number(options.minDragDistancePx || 8);
  const maxDurationMs = Number(options.maxDragDurationMs || 10000);
  const active = new Map();
  const windows = [];
  let counter = 0;
  function key(event) { return `${event.tabId ?? '?'}::${event.frameId ?? '?'}::${event.pageInstanceId || '?'}::${event.pointerId ?? 0}`; }
  for (const event of ordered) {
    if (event.type !== 'pointer') continue;
    const k = key(event);
    if (event.phase === 'down') {
      active.set(k, { down: event, events: [event] });
      continue;
    }
    const state = active.get(k);
    if (!state) continue;
    state.events.push(event);
    if (event.phase !== 'up' && event.phase !== 'cancel') continue;
    active.delete(k);
    if (event.phase === 'cancel') continue;
    const dx = Number(event.x || 0) - Number(state.down.x || 0);
    const dy = Number(event.y || 0) - Number(state.down.y || 0);
    const distancePx = Math.hypot(dx, dy);
    const durationMs = Number(event.tsEpochMs || 0) - Number(state.down.tsEpochMs || 0);
    if (distancePx < minDistancePx || durationMs < 0 || durationMs > maxDurationMs) continue;
    counter += 1;
    const outcomeEvents = collectWindow(ordered, event, 0, Number(options.afterMs || 1200));
    windows.push({
      actionWindowVersion: DERIVED_VERSION,
      actionId: `drag-${counter}-${Number(state.down.sessionSeq || state.down.pageSeq || 0)}`,
      actionType: 'drag', anchorTsEpochMs: Number(state.down.tsEpochMs || 0),
      context: { tabId: state.down.tabId ?? null, frameId: state.down.frameId ?? null, pageInstanceId: state.down.pageInstanceId || null },
      target: targetContext(state.down, descriptorIndex),
      destinationTarget: targetContext(event, descriptorIndex),
      before: [],
      action: {
        startTsEpochMs: Number(state.down.tsEpochMs || 0), endTsEpochMs: Number(event.tsEpochMs || 0),
        durationMs, distancePx: Math.round(distancePx * 1000) / 1000,
        start: { x: finiteOrNull(state.down.x), y: finiteOrNull(state.down.y) },
        end: { x: finiteOrNull(event.x), y: finiteOrNull(event.y) },
        pointerId: finiteOrNull(state.down.pointerId), points: state.events.map(eventRef)
      },
      after: outcomeEvents.filter(e => Number(e.tsEpochMs || 0) > Number(event.tsEpochMs || 0)).map(eventRef),
      outcome: outcomeFrom(outcomeEvents, Number(event.tsEpochMs || 0))
    });
  }
  return windows;
}

function scrollWindows(ordered, options, descriptorIndex) {
  const gapMs = Number(options.scrollGapMs || 220);
  const wheels = ordered.filter(event => event.type === 'wheel');
  const groups = [];
  let current = null;
  for (const event of wheels) {
    const dx = Number(event.deltaX || 0), dy = Number(event.deltaY || 0);
    const axis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
    const ts = Number(event.tsEpochMs || 0);
    if (!current || !sameContext(current.anchor, event) || current.axis !== axis || ts - current.lastTs > gapMs) {
      current = { anchor: event, axis, events: [], lastTs: ts }; groups.push(current);
    }
    current.events.push(event); current.lastTs = ts;
  }
  return groups.map((group, index) => ({
    actionWindowVersion: DERIVED_VERSION,
    actionId: `scroll-${index + 1}-${Number(group.anchor.sessionSeq || group.anchor.pageSeq || 0)}`,
    actionType: group.axis === 'horizontal' ? 'scrollHorizontal' : 'scrollVertical',
    anchorTsEpochMs: Number(group.anchor.tsEpochMs || 0),
    context: { tabId: group.anchor.tabId ?? null, frameId: group.anchor.frameId ?? null, pageInstanceId: group.anchor.pageInstanceId || null },
    target: targetContext(group.anchor, descriptorIndex), before: [],
    action: {
      startTsEpochMs: Number(group.events[0]?.tsEpochMs || 0), endTsEpochMs: Number(group.events[group.events.length - 1]?.tsEpochMs || 0),
      eventCount: group.events.length, axis: group.axis,
      deltaX: group.events.reduce((n, e) => n + Number(e.deltaX || 0), 0),
      deltaY: group.events.reduce((n, e) => n + Number(e.deltaY || 0), 0),
      events: group.events.map(eventRef)
    }, after: [], outcome: {}
  }));
}

function keyboardWindows(ordered, options, descriptorIndex) {
  const gapMs = Number(options.keyboardGapMs || 450);
  const keys = ordered.filter(event => event.type === 'keyboard');
  const groups = [];
  let current = null;
  for (const event of keys) {
    const ts = Number(event.tsEpochMs || 0), target = targetRefFor(event);
    if (!current || !sameContext(current.anchor, event) || current.target !== target || ts - current.lastTs > gapMs) {
      current = { anchor: event, target, events: [], lastTs: ts }; groups.push(current);
    }
    current.events.push(event); current.lastTs = ts;
  }
  return groups.map((group, index) => {
    const operations = group.events.map(event => event.operation || event.keyClass || 'unknown');
    const typeTextLike = operations.some(op => op === 'printable');
    return {
      actionWindowVersion: DERIVED_VERSION,
      actionId: `keyboard-${index + 1}-${Number(group.anchor.sessionSeq || group.anchor.pageSeq || 0)}`,
      actionType: typeTextLike ? 'typeText' : 'pressKey', anchorTsEpochMs: Number(group.anchor.tsEpochMs || 0),
      context: { tabId: group.anchor.tabId ?? null, frameId: group.anchor.frameId ?? null, pageInstanceId: group.anchor.pageInstanceId || null },
      target: targetContext(group.anchor, descriptorIndex), before: [],
      action: {
        startTsEpochMs: Number(group.events[0]?.tsEpochMs || 0), endTsEpochMs: Number(group.events[group.events.length - 1]?.tsEpochMs || 0),
        eventCount: group.events.length, operationClasses: operations,
        printableContentStored: false, events: group.events.map(eventRef)
      }, after: [], outcome: {}
    };
  });
}

function hoverWindows(raw, ordered, descriptorIndex, options = {}) {
  const derived = Semantics.buildActionSemantics(raw);
  const hoverEvents = ordered.filter(event => event.type === 'dom-hover-enter');
  const anchorsByPageRef = new Map();
  for (const event of hoverEvents) {
    const key = `${event.pageInstanceId || '?'}::${event.targetRef || '?'}`;
    if (!anchorsByPageRef.has(key)) anchorsByPageRef.set(key, []);
    anchorsByPageRef.get(key).push(event);
  }
  let filteredNoiseCount = 0;
  const windows = [];
  for (let index = 0; index < (derived.hoverActions || []).length; index += 1) {
    const action = derived.hoverActions[index];
    const key = `${action.pageInstanceId || '?'}::${action.targetRef || '?'}`;
    const candidates = anchorsByPageRef.get(key) || [];
    const anchor = candidates.find(event => Math.abs(Number(event.tsEpochMs || 0) - Number(action.startedAtEpochMs || 0)) <= 10) || candidates[0] || { pageInstanceId: action.pageInstanceId, targetRef: action.targetRef, tsEpochMs: action.startedAtEpochMs };
    const target = targetContext(anchor, descriptorIndex);
    if (options.filterHoverNoise !== false && !isMeaningfulHoverTarget(target, action)) { filteredNoiseCount += 1; continue; }
    windows.push({
      actionWindowVersion: DERIVED_VERSION,
      actionId: `hover-${index + 1}-${Number(action.evidence?.enterPageSeq || 0)}`,
      actionType: action.actionType === 'hover-preview' ? 'hoverAndObserve' : 'hover',
      anchorTsEpochMs: Number(action.startedAtEpochMs || 0),
      context: { tabId: anchor.tabId ?? null, frameId: anchor.frameId ?? null, pageInstanceId: action.pageInstanceId || null },
      target, before: [],
      action: { startTsEpochMs: action.startedAtEpochMs, endTsEpochMs: action.endedAtEpochMs, dwellMs: action.dwellMs, derivedHoverType: action.actionType },
      after: [], outcome: action.outcome || {}
    });
  }
  return { windows, filteredNoiseCount };
}

function buildActionWindows(raw, options = {}) {
  const ordered = [...(raw.events || [])].sort(chronologicalOrder);
  const descriptorIndex = buildDescriptorIndex(ordered);
  const hover = hoverWindows(raw, ordered, descriptorIndex, options);
  const windows = [
    ...clickWindows(ordered, options, descriptorIndex),
    ...dragWindows(ordered, options, descriptorIndex),
    ...hover.windows,
    ...scrollWindows(ordered, options, descriptorIndex),
    ...keyboardWindows(ordered, options, descriptorIndex)
  ].sort((a, b) => Number(a.anchorTsEpochMs || 0) - Number(b.anchorTsEpochMs || 0));
  return {
    actionWindowVersion: DERIVED_VERSION,
    sourceSessionId: raw.session?.sessionId || null,
    ordering: { primary: 'tsEpochMs', local: ['pageSeq', 'sourceSeq'], durabilityOnly: 'sessionSeq' },
    privacy: { printableHumanKeyContentStored: false, rawCredentialValuesExpected: false },
    derivation: {
      targetLabelEnrichment: 'resolved -> snapshot/index -> direct -> raw descendant', rawFactsMutated: false,
      hoverNoiseFilter: options.filterHoverNoise === false ? 'disabled' : 'generic-background-derived-filter',
      filteredHoverNoiseCount: hover.filteredNoiseCount,
      physicalBehaviorFactsPreserved: ['pointer phase/x/y/buttons/pressure', 'wheel delta', 'keyboard phase/operation without printable content']
    },
    counts: windows.reduce((out, item) => { out[item.actionType] = (out[item.actionType] || 0) + 1; return out; }, {}),
    windows
  };
}

function main(argv = process.argv.slice(2)) {
  const input = argv[0];
  if (!input) { console.error('Usage: node training-collector/tools/build_action_windows.js <session.raw.jsonl[.gz]> [output.json]'); process.exitCode = 2; return; }
  const raw = Semantics.readRaw(input);
  const result = buildActionWindows(raw);
  const output = argv[1] || `${input.replace(/\.raw\.jsonl(?:\.gz)?$/i, '')}.action-windows.v01.json`;
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ input: path.resolve(input), output: path.resolve(output), sourceEvents: raw.events.length, windows: result.windows.length, counts: result.counts, filteredHoverNoiseCount: result.derivation.filteredHoverNoiseCount }, null, 2));
}

if (require.main === module) main();

module.exports = {
  DERIVED_VERSION, chronologicalOrder, sameContext, eventRef, buildDescriptorIndex, targetContext,
  isMeaningfulHoverTarget, clickWindows, dragWindows, scrollWindows, keyboardWindows, hoverWindows, buildActionWindows
};
