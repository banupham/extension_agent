'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const GATES = Object.freeze({
  cargo: require('./offline_strategy_fresh_native_text_gate.js'),
  signal: require('./offline_strategy_fresh_long_mission_gate.js'),
  harbor: require('./offline_strategy_fresh_long_harbor_gate.js')
});

function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function isLegacyVersionOnlyError(error, expectedVersion) {
  const text = String(error || '');
  return text === `provider_version:${expectedVersion}` || text === `model_version:${expectedVersion}`;
}

async function runCompat(options = {}) {
  const gateName = String(options.gate || '').trim().toLowerCase();
  const gate = GATES[gateName];
  if (!gate || typeof gate.runGate !== 'function') throw new Error(`unsupported_gate:${gateName || '<missing>'}`);

  const modelFile = path.resolve(String(options.modelFile || ''));
  if (!modelFile || !fs.existsSync(modelFile)) throw new Error(`model_file_missing:${modelFile}`);
  const raw = fs.readFileSync(modelFile, 'utf8');
  const model = JSON.parse(raw);
  const expectedVersion = String(model?.modelVersion || '').trim();
  if (!expectedVersion) throw new Error('model_version_missing');

  const hashBefore = sha256File(modelFile);
  const result = await gate.runGate({
    modelFile,
    agentId: options.agentId || null,
    healthBase: options.healthBase || 'http://127.0.0.1:3000',
    broker: options.broker || 'ws://127.0.0.1:3000',
    timeoutMs: Number(options.timeoutMs || 10000),
    minimumConfidence: options.minimumConfidence == null ? 0 : Number(options.minimumConfidence)
  });
  const hashAfter = sha256File(modelFile);

  const providerVersion = String(result?.modelVersion || '').trim();
  const originalErrors = Array.isArray(result?.errors) ? [...result.errors] : [];
  const providerMatchesModel = providerVersion === expectedVersion;
  const remainingErrors = originalErrors.filter(error => !(
    providerMatchesModel && isLegacyVersionOnlyError(error, expectedVersion)
  ));

  if (!providerMatchesModel) {
    remainingErrors.push(`provider_model_version_mismatch:${providerVersion || '<missing>'}!=${expectedVersion}`);
  }
  if (hashBefore !== hashAfter) remainingErrors.push('compat_model_file_mutated');

  const removedLegacyVersionAssertions = originalErrors.filter(error =>
    providerMatchesModel && isLegacyVersionOnlyError(error, expectedVersion)
  );
  const ok = remainingErrors.length === 0;

  return {
    ...result,
    ok,
    result: ok ? 'PASS' : 'FAIL',
    errors: remainingErrors,
    compatibility: {
      runner: 'native-regression-model-compat',
      suppliedModelVersion: expectedVersion,
      providerVersion,
      providerMatchesModel,
      removedLegacyVersionAssertions,
      behaviorAssertionsPreserved: true,
      goalAssertionsPreserved: true,
      recoveryAssertionsPreserved: true,
      modelHashBefore: hashBefore,
      modelHashAfter: hashAfter,
      modelFileMutated: hashBefore !== hashAfter
    }
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.gate) throw new Error('--gate cargo|signal|harbor is required');
  if (!args.model) throw new Error('--model is required');
  const output = await runCompat({
    gate: args.gate,
    modelFile: args.model,
    agentId: args.agent || null,
    healthBase: args['health-base'] || 'http://127.0.0.1:3000',
    broker: args.broker || 'ws://127.0.0.1:3000',
    timeoutMs: Number(args.timeout || 10000),
    minimumConfidence: args['minimum-confidence'] == null ? 0 : Number(args['minimum-confidence'])
  });
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({
      ok: false,
      result: 'FAIL',
      gate: 'native-regression-model-compat',
      error: String(error?.message || error)
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  GATES,
  parseArgs,
  sha256File,
  isLegacyVersionOnlyError,
  runCompat,
  main
};
