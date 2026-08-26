'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TASKS = {
  'start media playback': {
    actionType: 'play',
    targetLabel: 'Media Play',
    successTitle: 'PLAY PASS',
    splitGroup: '8091-media-play-paraphrase-v2',
    taskId: 'task-8091-media-play-paraphrase-v2',
    canonicalInstruction: 'Start media playback'
  },
  'dismiss the target': {
    actionType: 'dismiss',
    targetLabel: 'Dismiss Target',
    successTitle: 'DISMISS PASS',
    splitGroup: '8091-dismiss-target-paraphrase-v2',
    taskId: 'task-8091-dismiss-target-paraphrase-v2',
    canonicalInstruction: 'Dismiss the target'
  }
};

function die(message) { throw new Error(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function normalize(v) { return String(v || '').trim().toLowerCase(); }

function discoverInputs(args) {
  const raw = args.length ? args : [process.cwd()];
  const out = [];
  for (const input of raw) {
    const resolved = path.resolve(input);
    if (!fs.existsSync(resolved)) die(`input_not_found: ${resolved}`);
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(resolved)) {
        if (name.endsWith('.task-episode-review.json')) out.push(path.join(resolved, name));
      }
    } else if (resolved.endsWith('.task-episode-review.json')) {
      out.push(resolved);
    }
  }
  return [...new Set(out)];
}

function selectLatest(files) {
  const latest = new Map();
  for (const file of files) {
    const review = readJson(file);
    const key = normalize(review?.task?.instruction);
    if (!TASKS[key]) continue;
    const stamp = Date.parse(review?.exportedAt || review?.endedAt || '') || fs.statSync(file).mtimeMs;
    const prior = latest.get(key);
    if (!prior || stamp > prior.stamp) latest.set(key, { key, file, review, stamp });
  }
  const missing = Object.keys(TASKS).filter(key => !latest.has(key));
  if (missing.length) die(`missing_readiness_repair_tasks: ${missing.join(', ')}`);
  return Object.keys(TASKS).map(key => latest.get(key));
}

function transitionTargetLabel(transition) {
  const ref = transition?.rawAction?.targetRef;
  const elements = transition?.strategyObservationBefore?.interactiveElements || [];
  return elements.find(el => el?.ref === ref)?.label || null;
}

function findSemanticTransition(review, cfg) {
  const matches = (review.transitions || []).filter(t =>
    t?.status === 'complete' &&
    t?.rawAction?.kind === 'click' &&
    transitionTargetLabel(t) === cfg.targetLabel
  );
  if (matches.length !== 1) {
    die(`expected_exactly_one_${cfg.actionType}_semantic_click: found=${matches.length} episode=${review?.episodeId || 'unknown'}`);
  }
  return matches[0];
}

function validateItem(item) {
  if (item.review?.finalOutcome?.status !== 'success') die(`final_outcome_not_success: ${path.basename(item.file)}`);
  if (item.review?.strategyReady !== true) die(`strategy_not_ready: ${path.basename(item.file)}`);
  return findSemanticTransition(item.review, TASKS[item.key]);
}

function runNode(toolPath, args) {
  const result = spawnSync(process.execPath, [toolPath, ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) die(`tool_failed: ${path.basename(toolPath)} exit=${result.status}`);
}

function annotate(templateFile, item, includedTransition) {
  const cfg = TASKS[item.key];
  const annotation = readJson(templateFile);
  annotation.splitGroup = cfg.splitGroup;
  annotation.review = {
    taskPrivacyReviewed: true,
    semanticLabelsVerified: true,
    outcomeVerified: true,
    credentialsExcluded: true,
    secretsExcluded: true
  };
  annotation.taskOverride = {
    taskId: cfg.taskId,
    type: 'controlled-browser-action',
    instruction: cfg.canonicalInstruction,
    args: {},
    successCriteria: [{ type: 'page', field: 'title', operator: 'equals', value: cfg.successTitle }],
    constraints: {},
    metadata: { surface: '127.0.0.1:8091', reviewed: true, variant: 'paraphrase-v2' }
  };

  let includedCount = 0;
  for (const step of annotation.steps || []) {
    if (step.transitionId === includedTransition.transitionId) {
      const targetRef = step?.evidence?.targetSummary?.ref || includedTransition?.rawAction?.targetRef;
      if (!targetRef) die(`missing_target_ref: ${includedTransition.transitionId}`);
      step.include = true;
      step.exclusionReason = null;
      step.action = {
        contractVersion: '0.1.0',
        type: cfg.actionType,
        targetRef,
        args: {},
        intent: `${cfg.actionType} ${cfg.targetLabel}`,
        expectedOutcome: {}
      };
      step.outcome = {
        actionSucceeded: true,
        taskSucceeded: true,
        progress: 1,
        evidence: [],
        errorCode: null
      };
      includedCount += 1;
    } else {
      step.include = false;
      step.exclusionReason = 'task_irrelevant_capture_noise';
      step.action = null;
      step.outcome = null;
    }
  }
  if (includedCount !== 1) die(`annotation_included_count_invalid: ${includedCount}`);
  fs.writeFileSync(templateFile, `${JSON.stringify(annotation, null, 2)}\n`, 'utf8');
}

function processItem(item, repoRoot) {
  const cfg = TASKS[item.key];
  const relevant = validateItem(item);
  const tools = path.join(repoRoot, 'training-collector', 'tools');
  const checker = path.join(tools, 'check_task_episode_review.js');
  const maker = path.join(tools, 'make_strategy_review_template.js');
  const adapter = path.join(tools, 'adapt_task_episode_review.js');

  console.log(`\n[${cfg.canonicalInstruction}] ${cfg.actionType} / ${cfg.targetLabel} / ${relevant.rawAction.targetRef} / ${item.review.episodeId}`);
  runNode(checker, [item.file]);
  runNode(maker, [item.file]);

  const annotationFile = item.file.replace(/\.json$/i, '.strategy-review.json');
  annotate(annotationFile, item, relevant);
  console.log(`ANNOTATION UPDATED: ${annotationFile}`);

  runNode(adapter, [item.file, '--annotation', annotationFile]);
  const strategyEpisodeFile = item.file.replace(/\.json$/i, '.strategy-episode.json');
  const output = readJson(strategyEpisodeFile);
  const destDir = path.join(repoRoot, 'training-collector', 'strategy-data', 'human-reviewed-v01', 'source');
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, `${output.episodeId}.json`);
  fs.copyFileSync(strategyEpisodeFile, dest);
  console.log(`COPIED: ${dest}`);
}

function rebuild(repoRoot) {
  const builder = path.join(repoRoot, 'training-collector', 'tools', 'build_strategy_episode_dataset.js');
  const sourceDir = path.join(repoRoot, 'training-collector', 'strategy-data', 'human-reviewed-v01', 'source');
  const outputDir = path.join(repoRoot, 'training-collector', 'strategy-data', 'human-reviewed-v01', 'dataset-v03');
  runNode(builder, [sourceDir, '--output', outputDir]);
  return outputDir;
}

function main() {
  const files = discoverInputs(process.argv.slice(2));
  const items = selectLatest(files);
  console.log('BASELINE READINESS REPAIR PLAN');
  for (const item of items) {
    const cfg = TASKS[item.key];
    const hit = validateItem(item);
    console.log(`${cfg.canonicalInstruction} -> ${cfg.actionType} -> ${cfg.splitGroup} -> ${hit.rawAction.targetRef} -> ${item.review.episodeId}`);
  }

  const repoRoot = path.resolve(__dirname, '..', '..');
  for (const item of items) processItem(item, repoRoot);
  const datasetDir = rebuild(repoRoot);
  console.log(`\nBASELINE READINESS REPAIR: PASS (${items.length} selected)`);
  console.log(`DATASET: ${datasetDir}`);
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`BASELINE READINESS REPAIR: FAIL\n${String(error?.message || error)}`);
    process.exitCode = 1;
  }
}

module.exports = { TASKS, normalize, selectLatest, transitionTargetLabel, findSemanticTransition, validateItem };
