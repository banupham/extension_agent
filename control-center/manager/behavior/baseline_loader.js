'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeBaseline } = require('./empirical_policy.js');

const LOADER_VERSION = '0.1.0';
const FORBIDDEN_KEYS = new Set([
  'tabId', 'windowId', 'frameId', 'documentId', 'pageInstanceId',
  'selector', 'selectors', 'targetRef', 'elementRef', 'privateReasoning', 'chainOfThought',
  'password', 'cookie', 'cookies', 'authorization', 'accessToken', 'refreshToken', 'clipboard', 'paymentSecret'
]);

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

function validateBehaviorBaselineArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) throw new Error('behavior_baseline_artifact_object_required');
  const model = normalizeBaseline(artifact);
  if (!model?.families) throw new Error('behavior_baseline_model_required');
  if (model?.design?.literalTrajectoryReplay !== false) throw new Error('behavior_baseline_literal_replay_boundary_failed');
  const forbidden = exactForbiddenKeys(artifact);
  if (forbidden.length) throw new Error(`behavior_baseline_forbidden_keys:${forbidden.slice(0, 8).join(',')}`);

  if (artifact.batchBehaviorBaselineVersion) {
    if (artifact?.splitPolicy?.trainOnlyUsedForFit !== true) throw new Error('behavior_baseline_train_only_fit_required');
    const privacy = artifact?.privacy || {};
    for (const key of ['derivedFeaturesOnly']) {
      if (privacy[key] !== true) throw new Error(`behavior_baseline_privacy_${key}_required`);
    }
    for (const key of ['rawTelemetryStored', 'rawTextStored', 'selectorsStored', 'observationLocalIdsStored', 'credentialsStored', 'privateReasoningStored']) {
      if (privacy[key] !== false) throw new Error(`behavior_baseline_privacy_${key}_must_be_false`);
    }
  }

  return artifact;
}

function loadBehaviorBaselineFile(file) {
  const full = path.resolve(String(file || ''));
  if (!full || !fs.existsSync(full)) throw new Error(`behavior_baseline_file_missing:${full}`);
  const artifact = JSON.parse(fs.readFileSync(full, 'utf8'));
  validateBehaviorBaselineArtifact(artifact);
  return artifact;
}

function describeBehaviorBaseline(artifact, source = 'object') {
  const model = normalizeBaseline(artifact);
  return {
    loaderVersion: LOADER_VERSION,
    loaded: !!model,
    source,
    behaviorBaselineVersion: model?.behaviorBaselineVersion || null,
    batchBehaviorBaselineVersion: artifact?.batchBehaviorBaselineVersion || null,
    literalTrajectoryReplay: model?.design?.literalTrajectoryReplay === true
  };
}

function resolveBehaviorBaseline(input = {}) {
  if (input.baseline) {
    validateBehaviorBaselineArtifact(input.baseline);
    return { artifact: input.baseline, metadata: describeBehaviorBaseline(input.baseline, 'object') };
  }
  if (input.baselineFile) {
    const artifact = loadBehaviorBaselineFile(input.baselineFile);
    return { artifact, metadata: describeBehaviorBaseline(artifact, 'file') };
  }
  return { artifact: null, metadata: describeBehaviorBaseline(null, 'none') };
}

module.exports = {
  LOADER_VERSION,
  FORBIDDEN_KEYS,
  exactForbiddenKeys,
  validateBehaviorBaselineArtifact,
  loadBehaviorBaselineFile,
  describeBehaviorBaseline,
  resolveBehaviorBaseline
};
