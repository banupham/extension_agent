'use strict';

const fs = require('fs');
const path = require('path');
const { validateModel } = require('./offline_baseline_provider.js');

const OFFLINE_STRATEGY_MODEL_LOADER_VERSION = '0.1.0';
const FORBIDDEN_MODEL_KEYS = new Set([
  'tabId', 'windowId', 'frameId', 'documentId', 'pageInstanceId',
  'selector', 'selectors', 'selectorCandidates', 'targetRef', 'elementRef',
  'x', 'y', 'rect', 'coordinates', 'cdpMethod', 'cdpPlan', 'rawCdp',
  'privateReasoning', 'chainOfThought',
  'password', 'cookie', 'cookies', 'authorization', 'accessToken', 'refreshToken',
  'clipboard', 'paymentSecret', 'typedValue', 'typedText', 'credential', 'credentials'
]);

function exactForbiddenModelKeys(value, pathParts = [], findings = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => exactForbiddenModelKeys(item, [...pathParts, String(index)], findings));
    return findings;
  }
  if (!value || typeof value !== 'object') return findings;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_MODEL_KEYS.has(key)) findings.push([...pathParts, key].join('.'));
    exactForbiddenModelKeys(child, [...pathParts, key], findings);
  }
  return findings;
}

function validateOfflineStrategyModelArtifact(model) {
  validateModel(model);
  if (model.heldOutUsedForFit !== false) {
    throw new Error('offline_strategy_model_heldout_fit_boundary_failed');
  }
  if (model.localTargetRefsPersisted !== false) {
    throw new Error('offline_strategy_model_local_target_ref_boundary_failed');
  }
  const forbidden = exactForbiddenModelKeys(model);
  if (forbidden.length) {
    throw new Error(`offline_strategy_model_forbidden_keys:${forbidden.slice(0, 8).join(',')}`);
  }
  return model;
}

function loadOfflineStrategyModelFile(file) {
  const full = path.resolve(String(file || ''));
  if (!full || !fs.existsSync(full)) throw new Error(`offline_strategy_model_file_missing:${full}`);
  const model = JSON.parse(fs.readFileSync(full, 'utf8'));
  validateOfflineStrategyModelArtifact(model);
  return model;
}

function describeOfflineStrategyModel(model, source = 'object') {
  return {
    loaderVersion: OFFLINE_STRATEGY_MODEL_LOADER_VERSION,
    loaded: !!model,
    source,
    modelVersion: model?.modelVersion || null,
    kind: model?.kind || null,
    fitSource: model?.fitSource || null,
    heldOutUsedForFit: model?.heldOutUsedForFit === true,
    localTargetRefsPersisted: model?.localTargetRefsPersisted === true,
    actionSelectionPolicy: model?.actionSelectionPolicy || null,
    targetGroundingPolicy: model?.targetGroundingPolicy || null
  };
}

function resolveOfflineStrategyModel(input = {}) {
  if (input.model && input.modelFile) throw new Error('offline_strategy_model_source_ambiguous');
  if (input.model) {
    validateOfflineStrategyModelArtifact(input.model);
    return { model: input.model, metadata: describeOfflineStrategyModel(input.model, 'object') };
  }
  if (input.modelFile) {
    const model = loadOfflineStrategyModelFile(input.modelFile);
    return { model, metadata: describeOfflineStrategyModel(model, 'file') };
  }
  return { model: null, metadata: describeOfflineStrategyModel(null, 'none') };
}

module.exports = {
  OFFLINE_STRATEGY_MODEL_LOADER_VERSION,
  FORBIDDEN_MODEL_KEYS,
  exactForbiddenModelKeys,
  validateOfflineStrategyModelArtifact,
  loadOfflineStrategyModelFile,
  describeOfflineStrategyModel,
  resolveOfflineStrategyModel
};
