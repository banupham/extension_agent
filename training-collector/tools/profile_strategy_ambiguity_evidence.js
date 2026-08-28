#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PROFILER_VERSION = '0.1.0';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveFile(file) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.resolve(file);
}

function inc(map, key) {
  const safe = String(key || '<none>');
  map[safe] = Number(map[safe] || 0) + 1;
}

function observationElements(observation) {
  const direct = Array.isArray(observation?.interactiveElements) ? observation.interactiveElements : [];
  const nested = Array.isArray(observation?.page?.interactiveElements) ? observation.page.interactiveElements : [];
  return direct.length ? direct : nested;
}

function targetElement(transition) {
  const ref = typeof transition?.rawAction?.targetRef === 'string' ? transition.rawAction.targetRef : null;
  if (!ref) return null;
  return observationElements(transition?.strategyObservationBefore)
    .find(item => item?.ref === ref || item?.elementRef === ref || item?.targetRef === ref) || null;
}

function targetKind(element = {}) {
  const role = String(element?.role || '').toLowerCase();
  const tag = String(element?.tag || '').toLowerCase();
  if (role === 'checkbox' || role === 'switch') return 'checkable';
  if (role === 'radio') return 'radio';
  if (tag === 'select' || role === 'combobox' || role === 'listbox') return 'select';
  if (element?.editable === true || role === 'textbox' || role === 'searchbox' || tag === 'textarea') return 'editable';
  if (role === 'button' || tag === 'button') return 'button';
  return 'other';
}

function transitionById(review, id) {
  return (Array.isArray(review?.transitions) ? review.transitions : [])
    .find(item => String(item?.transitionId || '') === String(id || '')) || null;
}

function stateDelta(transition) {
  const before = transition?.strategyObservationBefore || {};
  const after = transition?.strategyObservationAfter || {};
  const ref = typeof transition?.rawAction?.targetRef === 'string' ? transition.rawAction.targetRef : null;
  const beforeEl = ref ? observationElements(before).find(item => item?.ref === ref) || null : null;
  const afterEl = ref ? observationElements(after).find(item => item?.ref === ref) || null : null;
  return {
    urlChanged: String(before?.url || '') !== String(after?.url || ''),
    focusChanged: String(before?.focusedElement?.ref || '') !== String(after?.focusedElement?.ref || ''),
    checkedChanged: beforeEl && afterEl && typeof beforeEl.checked === 'boolean' && typeof afterEl.checked === 'boolean' && beforeEl.checked !== afterEl.checked,
    selectedChanged: beforeEl && afterEl && typeof beforeEl.selected === 'boolean' && typeof afterEl.selected === 'boolean' && beforeEl.selected !== afterEl.selected,
    enabledChanged: beforeEl && afterEl && typeof beforeEl.enabled === 'boolean' && typeof afterEl.enabled === 'boolean' && beforeEl.enabled !== afterEl.enabled,
    visibleChanged: beforeEl && afterEl && (beforeEl.visible !== afterEl.visible || beforeEl.rendered !== afterEl.rendered)
  };
}

function safeRawKeyCounts(rawAction, out) {
  for (const key of Object.keys(rawAction || {})) {
    const lower = String(key).toLowerCase();
    if (['text', 'value', 'password', 'token', 'cookie', 'authorization'].includes(lower)) continue;
    inc(out, key);
  }
}

function profileAmbiguity(packFile, resolutionFile) {
  const pack = readJson(path.resolve(packFile));
  const resolution = readJson(path.resolve(resolutionFile));
  const resolutionByEpisode = new Map((Array.isArray(resolution?.items) ? resolution.items : [])
    .map(item => [String(item?.episodeId || ''), item]));

  const summary = {
    profilerVersion: PROFILER_VERSION,
    unresolvedTransitionCount: 0,
    byHint: {},
    byReason: {},
    byRawKind: {},
    byRawOperation: {},
    byTargetKind: {},
    byTargetRole: {},
    rawActionKeyCounts: {},
    stateDeltaCounts: {},
    sourceActionSucceededCount: 0,
    sourceActionFailedCount: 0,
    policy: {
      aggregateOnly: true,
      rawTextValuesExcluded: true,
      rawFieldValuesExcluded: true,
      selectorsExcluded: true,
      coordinatesExcluded: true,
      tabIdsExcluded: true
    }
  };

  for (const item of Array.isArray(pack?.items) ? pack.items : []) {
    const resolutionItem = resolutionByEpisode.get(String(item?.episodeId || ''));
    if (!resolutionItem) continue;
    const sourceFile = resolveFile(item?.sourceFile);
    if (!sourceFile || !fs.existsSync(sourceFile)) continue;
    const review = readJson(sourceFile);

    for (const resolvedItem of Array.isArray(resolutionItem?.resolutions) ? resolutionItem.resolutions : []) {
      if (resolvedItem?.status !== 'needs-human-review') continue;
      const transition = transitionById(review, resolvedItem?.transitionId);
      if (!transition) continue;
      summary.unresolvedTransitionCount += 1;
      const raw = transition.rawAction || {};
      const element = targetElement(transition) || resolvedItem?.semanticTarget || {};
      inc(summary.byHint, resolvedItem?.sourceHint || '<none>');
      inc(summary.byReason, resolvedItem?.reasonCode || '<none>');
      inc(summary.byRawKind, raw.kind || '<none>');
      inc(summary.byRawOperation, raw.operation || '<none>');
      inc(summary.byTargetKind, targetKind(element));
      inc(summary.byTargetRole, element?.role || '<none>');
      safeRawKeyCounts(raw, summary.rawActionKeyCounts);
      const delta = stateDelta(transition);
      for (const [name, changed] of Object.entries(delta)) if (changed) inc(summary.stateDeltaCounts, name);
      if (transition?.outcome?.actionSucceeded === false) summary.sourceActionFailedCount += 1;
      else summary.sourceActionSucceededCount += 1;
    }
  }

  return summary;
}

function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    if (!args.pack || !args.resolution) {
      throw new Error('Usage: node training-collector/tools/profile_strategy_ambiguity_evidence.js --pack <review-pack.json> --resolution <ambiguity-resolution.json> [--out file]');
    }
    const result = profileAmbiguity(args.pack, args.resolution);
    if (args.out) {
      const output = path.resolve(args.out);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify({ ok: true, result: 'PASS', ...result }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  PROFILER_VERSION,
  targetKind,
  stateDelta,
  safeRawKeyCounts,
  profileAmbiguity,
  parseArgs,
  main
};
