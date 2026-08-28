#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Semantics = require('./build_action_semantics.js');
const Windows = require('./build_action_windows.js');
const Features = require('./extract_behavior_features.js');
const { collectFiles, curateSession } = require('./curate_random_human_data.js');

const BATCH_VERSION = '0.2.0';
const CONTEXT_FORBIDDEN_KEYS = new Set([
  'tabId', 'windowId', 'frameId', 'documentId', 'pageInstanceId',
  'selector', 'selectors', 'targetRef', 'elementRef', 'privateReasoning', 'chainOfThought'
]);

function safeName(value) {
  return String(value || 'session').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120) || 'session';
}

function sanitizeContext(value, depth = 0) {
  if (depth > 6) return null;
  if (Array.isArray(value)) return value.map(item => sanitizeContext(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (CONTEXT_FORBIDDEN_KEYS.has(key)) continue;
    out[key] = sanitizeContext(child, depth + 1);
  }
  return out;
}

function sanitizeBehaviorFeatures(result) {
  return {
    behaviorFeatureVersion: result?.behaviorFeatureVersion || null,
    sourceActionWindowVersion: result?.sourceActionWindowVersion || null,
    privacy: {
      printableHumanKeyContentStored: false,
      credentialValuesExpected: false,
      observationLocalIdsStored: false,
      selectorsStored: false
    },
    counts: { ...(result?.counts || {}) },
    rows: (Array.isArray(result?.rows) ? result.rows : []).map(row => ({
      ...row,
      context: sanitizeContext(row?.context || {})
    }))
  };
}

function collectReviewFiles(root) {
  if (!root) return [];
  const full = path.resolve(root);
  if (!fs.existsSync(full)) return [];
  const stat = fs.statSync(full);
  if (stat.isFile()) return /\.task-episode-review\.json$/i.test(full) ? [full] : [];
  const out = [];
  const stack = [full];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      const child = path.join(dir, name);
      const childStat = fs.statSync(child);
      if (childStat.isDirectory()) stack.push(child);
      else if (/\.task-episode-review\.json$/i.test(name)) out.push(child);
    }
  }
  return out.sort();
}

function reviewQueueItem(file, review) {
  const privacy = review?.privacy || {};
  const privacySafe =
    privacy.rawTextValuesStored !== true &&
    privacy.passwordValuesStored !== true &&
    privacy.cookiesStored !== true &&
    privacy.storageSecretsStored !== true &&
    privacy.authorizationDataStored !== true &&
    privacy.selectorsExported === false &&
    privacy.tabIdExported === false &&
    privacy.rawActionCoordinatesExported === false;
  const transitions = Array.isArray(review?.transitions) ? review.transitions : [];
  const finalStatus = typeof review?.finalOutcome?.status === 'string' ? review.finalOutcome.status : null;
  const strategyReady = review?.strategyReady === true;
  return {
    file: path.relative(process.cwd(), file),
    episodeId: typeof review?.episodeId === 'string' ? review.episodeId : null,
    reviewExportVersion: typeof review?.reviewExportVersion === 'string' ? review.reviewExportVersion : null,
    transitionCount: transitions.length,
    completeTransitionCount: transitions.filter(item => item?.status === 'complete').length,
    finalOutcomeStatus: finalStatus,
    strategyReady,
    privacySafe,
    humanReviewRequired: true,
    semanticLabelsVerified: false,
    outcomeProgressReviewed: false,
    splitAssigned: false,
    strategyAutoTrainEligible: false,
    queueStatus: strategyReady && privacySafe && finalStatus ? 'ready-for-human-review' : 'blocked-before-review'
  };
}

function quarantineDiagnostics(curation) {
  const keyCounts = {};
  let quarantinedEvents = 0;
  for (const item of Array.isArray(curation?.eventManifest) ? curation.eventManifest : []) {
    if (item?.quarantine !== true) continue;
    quarantinedEvents += 1;
    for (const key of Array.isArray(item.sensitiveKeyNames) ? item.sensitiveKeyNames : []) {
      const safeKey = String(key || '').trim();
      if (!safeKey) continue;
      keyCounts[safeKey] = (keyCounts[safeKey] || 0) + 1;
    }
  }
  return {
    quarantinedEventCount: quarantinedEvents,
    sensitiveKeyNames: Object.keys(keyCounts).sort(),
    sensitiveKeyCounts: keyCounts,
    rawSensitiveValuesCopied: false
  };
}

function prepareBehaviorFile(file, outputDir) {
  const raw = Semantics.readRaw(file);
  const curation = curateSession(raw);
  if (!curation.behavior.eligibleForBehaviorFeatureExtraction) {
    const diagnostics = quarantineDiagnostics(curation);
    return {
      file: path.relative(process.cwd(), file),
      status: curation.privacy.quarantinedEventCount ? 'quarantined' : 'no-behavior-candidates',
      reasonCode: curation.privacy.quarantinedEventCount ? 'privacy_quarantine' : 'no_behavior_candidates',
      quarantinedEventCount: curation.privacy.quarantinedEventCount,
      quarantineDiagnostics: diagnostics,
      featureRows: 0,
      output: null
    };
  }
  const windows = Windows.buildActionWindows(raw);
  const features = sanitizeBehaviorFeatures(Features.extractBehaviorFeatures(windows));
  if (!features.rows.length) {
    return {
      file: path.relative(process.cwd(), file),
      status: 'no-derived-actions',
      reasonCode: 'no_supported_behavior_windows',
      quarantinedEventCount: 0,
      quarantineDiagnostics: quarantineDiagnostics(curation),
      featureRows: 0,
      output: null
    };
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const sessionId = raw?.session?.sessionId || path.basename(file).replace(/\.raw\.json(?:l)?(?:\.gz)?$/i, '');
  const output = path.join(outputDir, `${safeName(sessionId)}.behavior-features.safe.v01.json`);
  fs.writeFileSync(output, `${JSON.stringify(features, null, 2)}\n`, 'utf8');
  return {
    file: path.relative(process.cwd(), file),
    status: 'behavior-features-ready',
    reasonCode: 'privacy_safe_derived_behavior',
    quarantinedEventCount: 0,
    quarantineDiagnostics: quarantineDiagnostics(curation),
    featureRows: features.rows.length,
    counts: features.counts,
    output: path.relative(process.cwd(), output)
  };
}

function aggregateActionCounts(sessions) {
  const counts = {};
  for (const session of sessions) {
    for (const [type, count] of Object.entries(session?.counts || {})) {
      counts[type] = (counts[type] || 0) + Number(count || 0);
    }
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])));
}

function aggregateQuarantineKeys(sessions) {
  const counts = {};
  for (const session of sessions) {
    for (const [key, count] of Object.entries(session?.quarantineDiagnostics?.sensitiveKeyCounts || {})) {
      counts[key] = (counts[key] || 0) + Number(count || 0);
    }
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function prepareBatch(options = {}) {
  const rawRoot = options.rawRoot ? path.resolve(options.rawRoot) : null;
  const reviewRoot = options.reviewRoot ? path.resolve(options.reviewRoot) : null;
  const outputDir = path.resolve(options.outputDir || 'training-collector/learning-batches/latest');
  const behaviorDir = path.join(outputDir, 'behavior');
  const rawFiles = rawRoot && fs.existsSync(rawRoot) ? collectFiles(rawRoot) : [];
  const behaviorSessions = rawFiles.map(file => prepareBehaviorFile(file, behaviorDir));
  const reviewFiles = collectReviewFiles(reviewRoot);
  const strategyReviewQueue = reviewFiles.map(file => {
    try {
      return reviewQueueItem(file, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (error) {
      return {
        file: path.relative(process.cwd(), file),
        episodeId: null,
        strategyReady: false,
        privacySafe: false,
        humanReviewRequired: true,
        strategyAutoTrainEligible: false,
        queueStatus: 'blocked-before-review',
        error: String(error?.message || error)
      };
    }
  });

  const manifest = {
    batchVersion: BATCH_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      rawRoot: rawRoot ? path.relative(process.cwd(), rawRoot) : null,
      reviewRoot: reviewRoot ? path.relative(process.cwd(), reviewRoot) : null
    },
    behavior: {
      sourceSessionCount: behaviorSessions.length,
      readySessionCount: behaviorSessions.filter(item => item.status === 'behavior-features-ready').length,
      quarantinedSessionCount: behaviorSessions.filter(item => item.status === 'quarantined').length,
      featureRowCount: behaviorSessions.reduce((sum, item) => sum + Number(item.featureRows || 0), 0),
      actionCounts: aggregateActionCounts(behaviorSessions),
      quarantineSensitiveKeyCounts: aggregateQuarantineKeys(behaviorSessions),
      sessions: behaviorSessions
    },
    strategy: {
      reviewFileCount: strategyReviewQueue.length,
      readyForHumanReviewCount: strategyReviewQueue.filter(item => item.queueStatus === 'ready-for-human-review').length,
      autoTrainEligibleCount: 0,
      queue: strategyReviewQueue
    },
    invariants: {
      rawRandomTelemetryAutoPromotedToStrategyTraining: false,
      behaviorOutputsAreDerivedFeaturesOnly: true,
      strategyStillRequiresHumanReview: true,
      quarantineDiagnosticsContainKeyNamesOnly: true
    }
  };
  fs.mkdirSync(outputDir, { recursive: true });
  const manifestFile = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { manifest, manifestFile };
}

function parseArgs(argv) {
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
  const args = parseArgs(argv);
  if (!args.raw && !args.reviews) {
    console.error('Usage: node training-collector/tools/prepare_human_learning_batch.js --raw <socket-data-dir> [--reviews <review-export-dir>] [--out <output-dir>]');
    process.exitCode = 2;
    return;
  }
  const { manifest, manifestFile } = prepareBatch({
    rawRoot: args.raw || null,
    reviewRoot: args.reviews || null,
    outputDir: args.out || 'training-collector/learning-batches/latest'
  });
  console.log(JSON.stringify({
    ok: true,
    batchVersion: manifest.batchVersion,
    manifest: path.resolve(manifestFile),
    behavior: {
      sourceSessionCount: manifest.behavior.sourceSessionCount,
      readySessionCount: manifest.behavior.readySessionCount,
      quarantinedSessionCount: manifest.behavior.quarantinedSessionCount,
      featureRowCount: manifest.behavior.featureRowCount,
      actionCounts: manifest.behavior.actionCounts,
      quarantineSensitiveKeyCounts: manifest.behavior.quarantineSensitiveKeyCounts
    },
    strategy: {
      reviewFileCount: manifest.strategy.reviewFileCount,
      readyForHumanReviewCount: manifest.strategy.readyForHumanReviewCount,
      autoTrainEligibleCount: manifest.strategy.autoTrainEligibleCount
    },
    invariants: manifest.invariants
  }, null, 2));
}

if (require.main === module) main();

module.exports = {
  BATCH_VERSION,
  CONTEXT_FORBIDDEN_KEYS,
  safeName,
  sanitizeContext,
  sanitizeBehaviorFeatures,
  collectReviewFiles,
  reviewQueueItem,
  quarantineDiagnostics,
  prepareBehaviorFile,
  aggregateActionCounts,
  aggregateQuarantineKeys,
  prepareBatch,
  parseArgs,
  main
};
