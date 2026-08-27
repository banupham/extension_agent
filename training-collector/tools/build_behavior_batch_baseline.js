#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fitBehaviorBaseline } = require('./build_behavior_baseline.js');

const BATCH_BEHAVIOR_BASELINE_VERSION = '0.1.0';
const FORBIDDEN_KEYS = new Set([
  'tabId', 'windowId', 'frameId', 'documentId', 'pageInstanceId',
  'selector', 'selectors', 'targetRef', 'elementRef', 'privateReasoning', 'chainOfThought',
  'password', 'cookie', 'cookies', 'authorization', 'accessToken', 'refreshToken', 'clipboard', 'paymentSecret'
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function exactForbiddenKeys(value, pathParts = [], findings = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => exactForbiddenKeys(item, [...pathParts, String(index)], findings));
    return findings;
  }
  if (!value || typeof value !== 'object') return findings;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) findings.push([...pathParts, key].join('.'));
    exactForbiddenKeys(child, [...pathParts, key], findings);
  }
  return findings;
}

function sessionKey(session) {
  return String(session?.file || session?.output || 'unknown-session');
}

function hashNumber(value) {
  return parseInt(crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8), 16) >>> 0;
}

function stableSplit(sessions) {
  const rows = sessions.map(session => ({ session, key: sessionKey(session), hash: hashNumber(sessionKey(session)) }))
    .sort((a, b) => a.hash - b.hash || a.key.localeCompare(b.key));
  const out = { train: [], validation: [], test: [] };
  for (const row of rows) {
    const bucket = row.hash % 100;
    if (bucket < 80) out.train.push(row.session);
    else if (bucket < 90) out.validation.push(row.session);
    else out.test.push(row.session);
  }
  if (rows.length >= 3) {
    if (!out.validation.length) out.validation.push(out.train.pop() || out.test.pop());
    if (!out.test.length) out.test.push(out.train.pop() || out.validation.pop());
    if (!out.train.length) out.train.push(out.validation.pop() || out.test.pop());
  } else if (rows.length && !out.train.length) {
    out.train.push(out.validation.pop() || out.test.pop());
  }
  return out;
}

function resolveOutputPath(manifestFile, output) {
  if (!output) return null;
  if (path.isAbsolute(output)) return output;
  const cwdResolved = path.resolve(output);
  if (fs.existsSync(cwdResolved)) return cwdResolved;
  return path.resolve(path.dirname(manifestFile), output);
}

function loadFeatureSet(manifestFile, session) {
  const featureFile = resolveOutputPath(manifestFile, session.output);
  if (!featureFile || !fs.existsSync(featureFile)) throw new Error(`behavior feature file missing: ${session.output || '<none>'}`);
  const featureSet = readJson(featureFile);
  const privacy = featureSet?.privacy || {};
  if (privacy.printableHumanKeyContentStored !== false || privacy.credentialValuesExpected !== false ||
      privacy.observationLocalIdsStored !== false || privacy.selectorsStored !== false) {
    throw new Error(`behavior feature privacy contract failed: ${featureFile}`);
  }
  const findings = exactForbiddenKeys(featureSet);
  if (findings.length) throw new Error(`forbidden behavior feature keys: ${findings.slice(0, 8).join(', ')}`);
  return { ...featureSet, sourceSessionId: sessionKey(session), _featureFile: featureFile };
}

function actionCounts(featureSets) {
  const counts = {};
  for (const set of featureSets) {
    for (const row of Array.isArray(set?.rows) ? set.rows : []) counts[row.actionType] = (counts[row.actionType] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function splitSummary(featureSets) {
  return {
    sessionCount: featureSets.length,
    rowCount: featureSets.reduce((sum, set) => sum + (Array.isArray(set?.rows) ? set.rows.length : 0), 0),
    actionCounts: actionCounts(featureSets)
  };
}

function buildBehaviorBatchBaseline(manifestFile, options = {}) {
  const fullManifest = path.resolve(manifestFile);
  const manifest = readJson(fullManifest);
  const readySessions = (Array.isArray(manifest?.behavior?.sessions) ? manifest.behavior.sessions : [])
    .filter(session => session?.status === 'behavior-features-ready' && session?.output);
  if (!readySessions.length) throw new Error('no behavior-features-ready sessions in manifest');

  const splitSessions = stableSplit(readySessions);
  const loaded = {};
  for (const split of ['train', 'validation', 'test']) loaded[split] = splitSessions[split].map(session => loadFeatureSet(fullManifest, session));
  if (!loaded.train.length) throw new Error('training split is empty');

  const model = fitBehaviorBaseline(loaded.train, { minContextSamples: Number(options.minContextSamples || 12) });
  const diagnostics = {};
  for (const split of ['validation', 'test']) {
    diagnostics[split] = loaded[split].length ? fitBehaviorBaseline(loaded[split], { minContextSamples: Number(options.minContextSamples || 12) }) : null;
  }

  return {
    batchBehaviorBaselineVersion: BATCH_BEHAVIOR_BASELINE_VERSION,
    generatedAt: new Date().toISOString(),
    sourceManifest: path.relative(process.cwd(), fullManifest),
    sourceBatchVersion: manifest.batchVersion || null,
    sourceReadySessionCount: readySessions.length,
    sourceFeatureRowCount: readySessions.reduce((sum, session) => sum + Number(session.featureRows || 0), 0),
    splitPolicy: {
      unit: 'session',
      method: 'stable_sha256_bucket_80_10_10_with_nonempty_fallback',
      leakageBoundary: 'session_never_crosses_splits',
      trainOnlyUsedForFit: true
    },
    splits: {
      train: splitSummary(loaded.train),
      validation: splitSummary(loaded.validation),
      test: splitSummary(loaded.test)
    },
    model,
    heldoutDiagnostics: diagnostics,
    privacy: {
      derivedFeaturesOnly: true,
      rawTelemetryStored: false,
      rawTextStored: false,
      selectorsStored: false,
      observationLocalIdsStored: false,
      credentialsStored: false,
      privateReasoningStored: false
    }
  };
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
  try {
    const args = parseArgs(argv);
    if (!args.manifest) throw new Error('Usage: node training-collector/tools/build_behavior_batch_baseline.js --manifest <manifest.json> [--out baseline.json]');
    const result = buildBehaviorBatchBaseline(args.manifest);
    const output = path.resolve(args.out || path.join(path.dirname(path.resolve(args.manifest)), 'behavior-baseline.v01.json'));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      ok: true,
      result: 'PASS',
      version: result.batchBehaviorBaselineVersion,
      output,
      sourceReadySessionCount: result.sourceReadySessionCount,
      sourceFeatureRowCount: result.sourceFeatureRowCount,
      splits: result.splits,
      warnings: result.model.warnings || [],
      trainOnlyUsedForFit: result.splitPolicy.trainOnlyUsedForFit
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  BATCH_BEHAVIOR_BASELINE_VERSION,
  FORBIDDEN_KEYS,
  exactForbiddenKeys,
  sessionKey,
  hashNumber,
  stableSplit,
  resolveOutputPath,
  loadFeatureSet,
  actionCounts,
  splitSummary,
  buildBehaviorBatchBaseline,
  parseArgs,
  main
};
