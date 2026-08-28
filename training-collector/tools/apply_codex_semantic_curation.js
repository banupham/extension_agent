#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Base = require('./resolve_strategy_review_ambiguity.js');

const CURATION_VERSION = '0.1.0';

function readJson(file) { return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); }
function writeJson(file, value) {
  const full = path.resolve(file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return full;
}
function sourceFile(file) { return path.isAbsolute(file) ? file : path.resolve(file); }
function safeTarget(input = {}, fallback = null) {
  const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim().slice(0, 160) : null;
  return {
    label,
    role: typeof input.role === 'string' ? input.role : (fallback?.role || null),
    tag: typeof input.tag === 'string' ? input.tag : (fallback?.tag || null),
    editable: input.editable === true || fallback?.editable === true,
    enabled: fallback?.enabled !== false,
    visible: fallback?.visible !== false
  };
}
function curate(options = {}) {
  const pack = readJson(options.packFile);
  const plan = readJson(options.curationFile);
  const planByEpisode = new Map((plan.episodes || []).map(item => [String(item.episodeId || ''), item]));
  const items = [];

  for (const packItem of (pack.items || []).filter(item => item.status === 'awaiting-human-review')) {
    const episodePlan = planByEpisode.get(String(packItem.episodeId || ''));
    if (!episodePlan || episodePlan.decision !== 'ACCEPT') continue;
    const review = readJson(sourceFile(packItem.sourceFile));
    const transitionById = new Map((review.transitions || []).map(item => [String(item.transitionId || ''), item]));
    const stepById = new Map((episodePlan.steps || []).map(item => [String(item.transitionId || ''), item]));
    const resolutions = [];

    for (const transition of review.transitions || []) {
      const id = String(transition.transitionId || '');
      const selected = stepById.get(id);
      const raw = transition.rawAction || {};
      const found = Base.targetForTransition(transition);
      const fallbackTarget = Base.semanticTarget(found.element);
      if (!selected) {
        resolutions.push({
          transitionId: id,
          sourceHint: raw.kind || null,
          status: 'capture-noise',
          semanticActionType: null,
          suggestedAction: null,
          exclusionReason: 'codex_curated_how_or_non_task_interaction',
          reasonCode: 'codex_curated_how_or_non_task_interaction',
          semanticTarget: fallbackTarget,
          requiresHumanConfirmation: true,
          autoTrainEligible: false
        });
        continue;
      }
      if (transition.outcome?.actionSucceeded === false) throw new Error(`curated_action_not_captured_success:${id}`);
      const targetRef = typeof raw.targetRef === 'string' && raw.targetRef.trim() ? raw.targetRef.trim() : null;
      if (selected.type !== 'scrollVertical' && selected.type !== 'scrollHorizontal' && !targetRef) {
        throw new Error(`curated_action_target_missing:${id}`);
      }
      const action = Base.safeAction(selected.type, targetRef, selected.args || {}, selected.intent || 'codex-curated-semantic-what');
      resolutions.push({
        transitionId: id,
        sourceHint: raw.kind || null,
        status: 'resolved-semantic-action',
        semanticActionType: action.type,
        suggestedAction: action,
        exclusionReason: null,
        reasonCode: 'codex_curated_from_task_outcome_and_human_demonstration',
        semanticTarget: safeTarget(selected.target || {}, fallbackTarget),
        requiresHumanConfirmation: true,
        autoTrainEligible: false
      });
    }
    for (const id of stepById.keys()) if (!transitionById.has(id)) throw new Error(`curated_transition_missing:${packItem.episodeId}:${id}`);
    items.push({
      episodeId: packItem.episodeId,
      task: packItem.task,
      finalOutcomeStatus: packItem.finalOutcomeStatus,
      ambiguousTransitionCount: resolutions.length,
      reviewAidTransitionCount: resolutions.length,
      resolvedSemanticActionCount: resolutions.filter(item => item.status === 'resolved-semantic-action').length,
      captureNoiseCount: resolutions.filter(item => item.status === 'capture-noise').length,
      unresolvedHumanReviewCount: 0,
      allAmbiguityResolvedForApprovalAid: true,
      resolutions
    });
  }

  if (!items.length) throw new Error('no_accepted_curation_episodes');
  const result = {
    codexSemanticCurationVersion: CURATION_VERSION,
    generatedAt: new Date().toISOString(),
    sourcePack: path.relative(process.cwd(), path.resolve(options.packFile)),
    sourceCuration: path.relative(process.cwd(), path.resolve(options.curationFile)),
    episodeCount: items.length,
    resolvedSemanticActionCount: items.reduce((sum, item) => sum + item.resolvedSemanticActionCount, 0),
    captureNoiseCount: items.reduce((sum, item) => sum + item.captureNoiseCount, 0),
    unresolvedHumanReviewCount: 0,
    fullyResolvedEpisodeCount: items.length,
    policy: {
      reviewAidOnly: true,
      curationNeverCountsAsDigestApproval: true,
      rawTrajectoryNotReplayed: true,
      selectorsCoordinatesTabIdsExcluded: true,
      explicitHumanDigestApprovalRequired: true,
      autoTrainEligible: false
    },
    items
  };
  return { result, outputFile: writeJson(options.outputFile, result) };
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i];
  return out;
}
function main() {
  try {
    const input = args(process.argv.slice(2));
    if (!input.pack || !input.curation || !input.out) throw new Error('Usage: node apply_codex_semantic_curation.js --pack <review-pack.json> --curation <curation.json> --out <resolution.json>');
    const done = curate({ packFile: input.pack, curationFile: input.curation, outputFile: input.out });
    console.log(JSON.stringify({ ok: true, result: 'PASS', episodeCount: done.result.episodeCount, resolvedSemanticActionCount: done.result.resolvedSemanticActionCount, autoTrainEligible: false, output: done.outputFile }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, result: 'FAIL', error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}
if (require.main === module) main();
module.exports = { CURATION_VERSION, safeTarget, curate };
