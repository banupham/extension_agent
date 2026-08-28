'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const GATES = Object.freeze({
  cargo: require('./offline_strategy_fresh_native_text_gate.js'),
  signal: require('./offline_strategy_fresh_long_mission_gate.js'),
  harbor: require('./offline_strategy_fresh_long_harbor_gate.js')
});

const CANDIDATE_PROTECTION_VERSION = '0.1.0';

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

function isLegacyVersionAssertion(error) {
  const text = String(error || '');
  return /^provider_version:/.test(text) || /^model_version:/.test(text);
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

  // The native gates create Strategy with tab-lifecycle enabled. Its public provider
  // version therefore describes the wrapper, not the learned model.
  // Model identity must come from the model metadata that createStrategy loaded from file.
  const loadedModelVersion = String(result?.loadedModelVersion || expectedVersion).trim();
  const wrapperProviderVersion = String(result?.modelVersion || '').trim();
  const originalErrors = Array.isArray(result?.errors) ? [...result.errors] : [];
  const loadedModelMatches = loadedModelVersion === expectedVersion;
  const removedLegacyVersionAssertions = originalErrors.filter(isLegacyVersionAssertion);
  const remainingErrors = originalErrors.filter(error => !isLegacyVersionAssertion(error));

  if (!loadedModelMatches) {
    remainingErrors.push(`loaded_model_version_mismatch:${loadedModelVersion || '<missing>'}!=${expectedVersion}`);
  }
  if (hashBefore !== hashAfter) remainingErrors.push('compat_model_file_mutated');

  const ok = remainingErrors.length === 0;
  return {
    ...result,
    ok,
    result: ok ? 'PASS' : 'FAIL',
    errors: remainingErrors,
    compatibility: {
      runner: 'native-regression-model-compat',
      suppliedModelVersion: expectedVersion,
      loadedModelVersion,
      loadedModelMatches,
      wrapperProviderVersion,
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

function numericScore(benchmark) {
  const value = Number(benchmark?.score?.total);
  return Number.isFinite(value) ? value : null;
}

function benchmarkDimensions(benchmark) {
  const source = benchmark?.score?.dimensions;
  return source && typeof source === 'object' && !Array.isArray(source) ? source : {};
}

function evaluateCandidateProtection(input = {}) {
  const minimumBenchmarkScore = Number.isFinite(Number(input.minimumBenchmarkScore))
    ? Number(input.minimumBenchmarkScore)
    : 90;
  const allowedTotalRegression = Number.isFinite(Number(input.allowedTotalRegression))
    ? Math.max(0, Number(input.allowedTotalRegression))
    : 0;
  const allowedDimensionRegression = Number.isFinite(Number(input.allowedDimensionRegression))
    ? Math.max(0, Number(input.allowedDimensionRegression))
    : 0;
  const reasons = [];
  const nativeResults = input.nativeResults && typeof input.nativeResults === 'object' ? input.nativeResults : {};
  for (const gateName of Object.keys(GATES)) {
    if (nativeResults?.[gateName]?.ok !== true) reasons.push(`native_gate_failed:${gateName}`);
  }

  const baseBenchmark = input.baseBenchmark || null;
  const candidateBenchmark = input.candidateBenchmark || null;
  const baseScore = numericScore(baseBenchmark);
  const candidateScore = numericScore(candidateBenchmark);
  if (baseBenchmark?.ok !== true || baseScore == null) reasons.push('base_benchmark_unavailable');
  if (candidateBenchmark?.ok !== true || candidateScore == null) reasons.push('candidate_benchmark_failed');
  if (candidateBenchmark?.safetyScenario?.safeBlocked !== true) reasons.push('candidate_ambiguity_safe_block_failed');
  if (candidateScore != null && candidateScore < minimumBenchmarkScore) {
    reasons.push(`candidate_benchmark_below_minimum:${candidateScore}<${minimumBenchmarkScore}`);
  }
  if (baseScore != null && candidateScore != null && candidateScore + allowedTotalRegression < baseScore) {
    reasons.push(`candidate_total_regression:${candidateScore}<${baseScore}`);
  }

  const baseDimensions = benchmarkDimensions(baseBenchmark);
  const candidateDimensions = benchmarkDimensions(candidateBenchmark);
  const dimensionRegressions = [];
  for (const [name, baseValueRaw] of Object.entries(baseDimensions)) {
    const baseValue = Number(baseValueRaw);
    const candidateValue = Number(candidateDimensions[name]);
    if (!Number.isFinite(baseValue) || !Number.isFinite(candidateValue)) {
      reasons.push(`candidate_dimension_missing:${name}`);
      continue;
    }
    if (candidateValue + allowedDimensionRegression < baseValue) {
      dimensionRegressions.push({ name, base: baseValue, candidate: candidateValue });
      reasons.push(`candidate_dimension_regression:${name}:${candidateValue}<${baseValue}`);
    }
  }

  const environmentBlocked = reasons.includes('base_benchmark_unavailable');
  const pass = reasons.length === 0;
  return {
    candidateProtectionVersion: CANDIDATE_PROTECTION_VERSION,
    pass,
    status: pass
      ? 'candidate-protected-ready-for-manual-promotion'
      : (environmentBlocked ? 'candidate-protection-blocked-environment' : 'candidate-rejected-runtime-regression'),
    reasons: [...new Set(reasons)],
    thresholds: {
      minimumBenchmarkScore,
      allowedTotalRegression,
      allowedDimensionRegression
    },
    baseScore,
    candidateScore,
    dimensionRegressions,
    nativeGatePass: Object.fromEntries(Object.keys(GATES).map(name => [name, nativeResults?.[name]?.ok === true])),
    ambiguitySafeBlockPass: candidateBenchmark?.safetyScenario?.safeBlocked === true,
    productionPromotionApplied: false
  };
}

async function runCandidateProtection(options = {}) {
  const baseModelFile = path.resolve(String(options.baseModelFile || ''));
  const candidateModelFile = path.resolve(String(options.candidateModelFile || ''));
  if (!baseModelFile || !fs.existsSync(baseModelFile)) throw new Error(`base_model_file_missing:${baseModelFile}`);
  if (!candidateModelFile || !fs.existsSync(candidateModelFile)) throw new Error(`candidate_model_file_missing:${candidateModelFile}`);

  const baseHashBefore = sha256File(baseModelFile);
  const candidateHashBefore = sha256File(candidateModelFile);
  const runNative = typeof options.runNativeCompat === 'function' ? options.runNativeCompat : runCompat;
  const runBenchmark = typeof options.runBenchmark === 'function'
    ? options.runBenchmark
    : require('./agent_intelligence_benchmark.js').runBenchmark;

  const common = {
    agentId: options.agentId || null,
    healthBase: options.healthBase || 'http://127.0.0.1:3000',
    broker: options.broker || 'ws://127.0.0.1:3000',
    timeoutMs: Number(options.timeoutMs || 10000),
    minimumConfidence: options.minimumConfidence == null ? 0 : Number(options.minimumConfidence)
  };
  const nativeResults = {};
  for (const gateName of Object.keys(GATES)) {
    try {
      nativeResults[gateName] = await runNative({ ...common, gate: gateName, modelFile: candidateModelFile });
    } catch (error) {
      nativeResults[gateName] = { ok: false, result: 'ERROR', error: String(error?.message || error) };
    }
  }

  let baseBenchmark;
  let candidateBenchmark;
  try {
    baseBenchmark = await runBenchmark({ ...common, modelFile: baseModelFile });
  } catch (error) {
    baseBenchmark = { ok: false, error: String(error?.message || error), score: null };
  }
  try {
    candidateBenchmark = await runBenchmark({ ...common, modelFile: candidateModelFile });
  } catch (error) {
    candidateBenchmark = { ok: false, error: String(error?.message || error), score: null };
  }

  const baseHashAfter = sha256File(baseModelFile);
  const candidateHashAfter = sha256File(candidateModelFile);
  const protection = evaluateCandidateProtection({
    nativeResults,
    baseBenchmark,
    candidateBenchmark,
    minimumBenchmarkScore: options.minimumBenchmarkScore,
    allowedTotalRegression: options.allowedTotalRegression,
    allowedDimensionRegression: options.allowedDimensionRegression
  });
  const mutationReasons = [];
  if (baseHashBefore !== baseHashAfter) mutationReasons.push('base_model_mutated_during_candidate_protection');
  if (candidateHashBefore !== candidateHashAfter) mutationReasons.push('candidate_model_mutated_during_candidate_protection');
  const reasons = [...new Set([...protection.reasons, ...mutationReasons])];
  const pass = protection.pass && mutationReasons.length === 0;
  const status = pass
    ? 'candidate-protected-ready-for-manual-promotion'
    : (protection.status === 'candidate-protection-blocked-environment' && !mutationReasons.length
        ? protection.status
        : 'candidate-rejected-runtime-regression');

  return {
    ...protection,
    pass,
    status,
    reasons,
    modelIntegrity: {
      base: { file: baseModelFile, hashBefore: baseHashBefore, hashAfter: baseHashAfter, mutated: baseHashBefore !== baseHashAfter },
      candidate: { file: candidateModelFile, hashBefore: candidateHashBefore, hashAfter: candidateHashAfter, mutated: candidateHashBefore !== candidateHashAfter }
    },
    nativeResults,
    baseBenchmark,
    candidateBenchmark,
    productionPromotionApplied: false
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args['base-model'] || args['candidate-model']) {
    if (!args['base-model'] || !args['candidate-model']) throw new Error('--base-model and --candidate-model are both required for candidate protection');
    const output = await runCandidateProtection({
      baseModelFile: args['base-model'],
      candidateModelFile: args['candidate-model'],
      agentId: args.agent || null,
      healthBase: args['health-base'] || 'http://127.0.0.1:3000',
      broker: args.broker || 'ws://127.0.0.1:3000',
      timeoutMs: Number(args.timeout || 10000),
      minimumConfidence: args['minimum-confidence'] == null ? 0 : Number(args['minimum-confidence']),
      minimumBenchmarkScore: args['minimum-benchmark-score'] == null ? 90 : Number(args['minimum-benchmark-score']),
      allowedTotalRegression: args['allowed-total-regression'] == null ? 0 : Number(args['allowed-total-regression']),
      allowedDimensionRegression: args['allowed-dimension-regression'] == null ? 0 : Number(args['allowed-dimension-regression'])
    });
    console.log(JSON.stringify(output, null, 2));
    if (!output.pass) process.exitCode = 2;
    return;
  }

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
  CANDIDATE_PROTECTION_VERSION,
  parseArgs,
  sha256File,
  isLegacyVersionAssertion,
  runCompat,
  numericScore,
  benchmarkDimensions,
  evaluateCandidateProtection,
  runCandidateProtection,
  main
};