#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { readInputFile } = require('./analyze_raw.js');

const CURATOR_VERSION = '0.1.1';
const DIAGNOSTIC_TYPES = new Set([
  'frame-context',
  'collector-stream-start',
  'collector-stream-health',
  'collector-stream-stop',
  'heartbeat',
  'idle-gap'
]);
const BEHAVIOR_TYPES = new Set([
  'pointer', 'pointer-down', 'pointer-up', 'wheel', 'scroll-position', 'keyboard',
  'focus', 'visibility',
  'dom-click', 'dom-focus', 'dom-input', 'dom-change', 'dom-submit',
  'dom-hover-enter', 'dom-hover-dwell', 'dom-hover-leave',
  'semantic-snapshot', 'route-change', 'dom-mutation', 'dom-mutation-burst'
]);
const ACTION_ANCHOR_TYPES = new Set([
  'dom-click', 'dom-input', 'dom-change', 'dom-submit',
  'dom-hover-enter', 'dom-hover-dwell', 'wheel', 'scroll-position', 'keyboard'
]);
const FORBIDDEN_KEY = /^(password|cookie|cookies|authorization|accessToken|refreshToken|clipboard|paymentSecret|privateReasoning|chainOfThought|token|secret)$/i;
const RAW_TEXT_KEY = /^(value|text|innerText|outerHTML|html)$/i;

function isNonEmptySensitiveValue(value) {
  return value !== null && value !== undefined && value !== '' && value !== false;
}

function safeStructuralRawTextKey(pathParts, object, key) {
  if (key !== 'value') return false;
  const parent = pathParts[pathParts.length - 1] || '';
  if (parent !== 'selectorCandidates') return false;
  return typeof object?.type === 'string' && Number.isFinite(Number(object?.score));
}

function scanSensitive(value, depth = 0, findings = [], pathParts = []) {
  if (!value || depth > 7) return findings;
  if (Array.isArray(value)) {
    for (const item of value) scanSensitive(item, depth + 1, findings, pathParts);
    return findings;
  }
  if (typeof value !== 'object') return findings;
  for (const [key, child] of Object.entries(value)) {
    const forbidden = FORBIDDEN_KEY.test(key);
    const rawText = RAW_TEXT_KEY.test(key) && !safeStructuralRawTextKey(pathParts, value, key);
    if ((forbidden || rawText) && isNonEmptySensitiveValue(child)) {
      findings.push(String(key));
    }
    scanSensitive(child, depth + 1, findings, [...pathParts, key]);
  }
  return findings;
}

function semanticAnchorPresent(event) {
  return !!(
    event?.targetRef ||
    event?.resolvedTargetRef ||
    event?.semanticTarget?.elementRef ||
    event?.semanticTarget?.label ||
    event?.target?.role ||
    event?.target?.tag
  );
}

function classifyEvent(event, index) {
  const type = String(event?.type || 'unknown');
  const sensitiveKeys = [...new Set(scanSensitive(event))];
  const base = {
    eventIndex: index,
    sessionSeq: Number.isFinite(Number(event?.sessionSeq)) ? Number(event.sessionSeq) : null,
    type,
    behaviorLane: false,
    actionAnchor: false,
    strategyLane: false,
    quarantine: false,
    reasonCode: null
  };

  if (sensitiveKeys.length) {
    return {
      ...base,
      quarantine: true,
      reasonCode: 'privacy_sensitive_payload',
      sensitiveKeyNames: sensitiveKeys
    };
  }
  if (DIAGNOSTIC_TYPES.has(type)) {
    return { ...base, reasonCode: 'diagnostic_noise' };
  }
  if (BEHAVIOR_TYPES.has(type)) {
    const actionAnchor = ACTION_ANCHOR_TYPES.has(type) && semanticAnchorPresent(event);
    return {
      ...base,
      behaviorLane: true,
      actionAnchor,
      reasonCode: actionAnchor ? 'behavior_semantic_action_anchor' : 'behavior_context'
    };
  }
  return { ...base, reasonCode: 'unsupported_or_low_value_event' };
}

function sensitiveKeyCounts(items) {
  const counts = {};
  for (const item of items) {
    for (const key of Array.isArray(item?.sensitiveKeyNames) ? item.sensitiveKeyNames : []) {
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

function curateSession(data, options = {}) {
  const events = Array.isArray(data?.events) ? data.events : [];
  const classified = events.map(classifyEvent);
  const quarantined = classified.filter(item => item.quarantine);
  const behavior = classified.filter(item => item.behaviorLane && !item.quarantine);
  const actionAnchors = behavior.filter(item => item.actionAnchor);
  const diagnostics = classified.filter(item => item.reasonCode === 'diagnostic_noise');
  const unsupported = classified.filter(item => item.reasonCode === 'unsupported_or_low_value_event');
  const hasTaskContext = options.taskContextVerified === true;
  const hasVerifiedOutcome = options.outcomeVerified === true;
  const strategyReviewCandidate = hasTaskContext && hasVerifiedOutcome && actionAnchors.length > 0 && quarantined.length === 0;

  return {
    curatorVersion: CURATOR_VERSION,
    sessionId: data?.session?.sessionId || null,
    totalEvents: events.length,
    privacy: {
      safeForDerivedBehaviorProcessing: quarantined.length === 0,
      quarantinedEventCount: quarantined.length,
      quarantineSensitiveKeyCounts: sensitiveKeyCounts(quarantined),
      rawSensitivePayloadCopiedToManifest: false
    },
    behavior: {
      candidateEventCount: behavior.length,
      semanticActionAnchorCount: actionAnchors.length,
      eligibleForBehaviorFeatureExtraction: behavior.length > 0 && quarantined.length === 0
    },
    strategy: {
      autoTrainEligible: false,
      reviewCandidate: strategyReviewCandidate,
      taskContextVerified: hasTaskContext,
      outcomeVerified: hasVerifiedOutcome,
      reasonCode: strategyReviewCandidate
        ? 'requires_human_strategy_review_before_dataset_fit'
        : 'task_context_and_verified_outcome_required'
    },
    counts: {
      diagnostics: diagnostics.length,
      unsupported: unsupported.length,
      quarantined: quarantined.length
    },
    eventManifest: classified
  };
}

function collectFiles(inputPath) {
  const full = path.resolve(inputPath);
  const stat = fs.statSync(full);
  if (stat.isFile()) return [full];
  const out = [];
  const stack = [full];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      const child = path.join(dir, name);
      const childStat = fs.statSync(child);
      if (childStat.isDirectory()) stack.push(child);
      else if (/\.raw\.json(?:l)?(?:\.gz)?$/i.test(name)) out.push(child);
    }
  }
  return out.sort();
}

function parseArgs(argv) {
  const out = { positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) { out.positional.push(token); continue; }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const input = args.positional[0];
  if (!input) {
    console.error('Usage: node training-collector/tools/curate_random_human_data.js <raw-file-or-directory> [--out report.json] [--task-context-verified] [--outcome-verified]');
    process.exitCode = 2;
    return;
  }
  const files = collectFiles(input);
  const sessions = files.map(file => ({
    file: path.relative(process.cwd(), file),
    ...curateSession(readInputFile(file), {
      taskContextVerified: args['task-context-verified'] === true,
      outcomeVerified: args['outcome-verified'] === true
    })
  }));
  const quarantineSensitiveKeyCounts = {};
  for (const session of sessions) {
    for (const [key, count] of Object.entries(session?.privacy?.quarantineSensitiveKeyCounts || {})) {
      quarantineSensitiveKeyCounts[key] = (quarantineSensitiveKeyCounts[key] || 0) + Number(count || 0);
    }
  }
  const report = {
    curatorVersion: CURATOR_VERSION,
    generatedAt: new Date().toISOString(),
    sourceFileCount: files.length,
    sessions,
    totals: {
      events: sessions.reduce((sum, item) => sum + item.totalEvents, 0),
      behaviorCandidates: sessions.reduce((sum, item) => sum + item.behavior.candidateEventCount, 0),
      actionAnchors: sessions.reduce((sum, item) => sum + item.behavior.semanticActionAnchorCount, 0),
      quarantined: sessions.reduce((sum, item) => sum + item.privacy.quarantinedEventCount, 0),
      quarantineSensitiveKeyCounts,
      strategyReviewCandidates: sessions.filter(item => item.strategy.reviewCandidate).length,
      strategyAutoTrainEligible: 0
    }
  };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out) fs.writeFileSync(path.resolve(args.out), text);
  process.stdout.write(text);
}

if (require.main === module) main();

module.exports = {
  CURATOR_VERSION,
  DIAGNOSTIC_TYPES,
  BEHAVIOR_TYPES,
  ACTION_ANCHOR_TYPES,
  safeStructuralRawTextKey,
  scanSensitive,
  semanticAnchorPresent,
  classifyEvent,
  sensitiveKeyCounts,
  curateSession,
  collectFiles,
  parseArgs,
  main
};
