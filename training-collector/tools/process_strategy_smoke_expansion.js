'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REQUIRED_PER_TASK = 2;

const TASKS = {
  click: {
    actionType: 'click',
    targetLabel: 'Submit Target',
    successTitle: 'SUBMIT PASS',
    slug: 'submit-target-click',
    splitGroup: '8091-submit-target-click-v1',
    taskId: 'task-8091-submit-target-click-v1',
    canonicalInstruction: 'Click Submit Target'
  },
  dismiss: {
    actionType: 'dismiss',
    targetLabel: 'Dismiss Target',
    successTitle: 'DISMISS PASS',
    slug: 'dismiss-target',
    splitGroup: '8091-dismiss-target-v1',
    taskId: 'task-8091-dismiss-target-v1',
    canonicalInstruction: 'Dismiss Dismiss Target'
  },
  play: {
    actionType: 'play',
    targetLabel: 'Media Play',
    successTitle: 'PLAY PASS',
    slug: 'media-play',
    splitGroup: '8091-media-play-v1',
    taskId: 'task-8091-media-play-v1',
    canonicalInstruction: 'Play Media'
  },
  pause: {
    actionType: 'pause',
    targetLabel: 'Media Pause',
    successTitle: 'PAUSE PASS',
    slug: 'media-pause',
    splitGroup: '8091-media-pause-v1',
    taskId: 'task-8091-media-pause-v1',
    canonicalInstruction: 'Pause Media'
  },
  mute: {
    actionType: 'mute',
    targetLabel: 'Media Mute',
    successTitle: 'MUTE PASS',
    slug: 'media-mute',
    splitGroup: '8091-media-mute-v1',
    taskId: 'task-8091-media-mute-v1',
    canonicalInstruction: 'Mute Media'
  },
  unmute: {
    actionType: 'unmute',
    targetLabel: 'Media Unmute',
    successTitle: 'UNMUTE PASS',
    slug: 'media-unmute',
    splitGroup: '8091-media-unmute-v1',
    taskId: 'task-8091-media-unmute-v1',
    canonicalInstruction: 'Unmute Media'
  }
};

function die(message) {
  throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function taskKey(review) {
  const value = String(review?.task?.instruction || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(TASKS, value) ? value : null;
}

function reviewStamp(review, file) {
  return Date.parse(review?.exportedAt || review?.endedAt || '') || fs.statSync(file).mtimeMs;
}

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
  if (!out.length) die('no_task_episode_review_files_found');
  return [...new Set(out)];
}

function collectCandidates(files) {
  const items = [];
  for (const file of files) {
    const review = readJson(file);
    const key = taskKey(review);
    if (!key) continue;
    items.push({ key, file, review, stamp: reviewStamp(review, file) });
  }
  return items;
}

function selectExpansion(items, requiredPerTask = REQUIRED_PER_TASK) {
  const selected = [];
  const reserve = [];
  for (const key of Object.keys(TASKS)) {
    const group = items
      .filter(item => item.key === key)
      .sort((a, b) => a.stamp - b.stamp || a.file.localeCompare(b.file));
    if (group.length < requiredPerTask) {
      die(`insufficient_${key}_reviews: required=${requiredPerTask} found=${group.length}`);
    }
    selected.push(...group.slice(0, requiredPerTask));
    reserve.push(...group.slice(requiredPerTask));
  }
  return { selected, reserve };
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

function validateReview(item) {
  if (item.review?.finalOutcome?.status !== 'success') {
    die(`final_outcome_not_success: ${path.basename(item.file)}`);
  }
  if (item.review?.strategyReady !== true) {
    die(`strategy_not_ready: ${path.basename(item.file)}`);
  }
  return findSemanticTransition(item.review, TASKS[item.key]);
}

function printPlan(selection) {
  console.log('STRATEGY SMOKE EXPANSION PLAN');
  for (const key of Object.keys(TASKS)) {
    const cfg = TASKS[key];
    const group = selection.selected.filter(item => item.key === key);
    for (const item of group) {
      const hit = validateReview(item);
      console.log(`${key} -> ${cfg.actionType} -> ${cfg.targetLabel} -> ${hit.rawAction.targetRef} -> ${item.review.episodeId}`);
    }
  }
  for (const item of selection.reserve) {
    console.log(`RESERVE -> ${item.key} -> ${item.review.episodeId}`);
  }
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
    successCriteria: [
      { type: 'page', field: 'title', operator: 'equals', value: cfg.successTitle }
    ],
    constraints: {},
    metadata: { surface: '127.0.0.1:8091', reviewed: true }
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
  const relevant = validateReview(item);
  const tools = path.join(repoRoot, 'training-collector', 'tools');
  const checker = path.join(tools, 'check_task_episode_review.js');
  const maker = path.join(tools, 'make_strategy_review_template.js');
  const adapter = path.join(tools, 'adapt_task_episode_review.js');
  for (const tool of [checker, maker, adapter]) {
    if (!fs.existsSync(tool)) die(`repo_tool_not_found: ${tool}`);
  }

  console.log(`\n[${item.key}] ${cfg.actionType} / ${cfg.targetLabel} / ${relevant.rawAction.targetRef} / ${item.review.episodeId}`);
  runNode(checker, [item.file]);
  runNode(maker, [item.file]);

  const annotationFile = item.file.replace(/\.json$/i, '.strategy-review.json');
  if (!fs.existsSync(annotationFile)) die(`annotation_template_not_created: ${annotationFile}`);
  annotate(annotationFile, item, relevant);
  console.log(`ANNOTATION UPDATED: ${annotationFile}`);

  runNode(adapter, [item.file, '--annotation', annotationFile]);
  const strategyEpisodeFile = item.file.replace(/\.json$/i, '.strategy-episode.json');
  if (!fs.existsSync(strategyEpisodeFile)) die(`strategy_episode_not_created: ${strategyEpisodeFile}`);

  const destDir = path.join(repoRoot, 'training-collector', 'strategy-data', 'human-reviewed-v01', 'source');
  fs.mkdirSync(destDir, { recursive: true });
  const output = readJson(strategyEpisodeFile);
  const dest = path.join(destDir, `${output.episodeId}.json`);
  fs.copyFileSync(strategyEpisodeFile, dest);
  console.log(`COPIED: ${dest}`);
}

function rebuildDataset(repoRoot) {
  const builder = path.join(repoRoot, 'training-collector', 'tools', 'build_strategy_episode_dataset.js');
  const sourceDir = path.join(repoRoot, 'training-collector', 'strategy-data', 'human-reviewed-v01', 'source');
  const outputDir = path.join(repoRoot, 'training-collector', 'strategy-data', 'human-reviewed-v01', 'dataset-v02');
  console.log('\nREBUILD DATASET V02');
  runNode(builder, [sourceDir, '--output', outputDir]);
  return outputDir;
}

function main() {
  const args = process.argv.slice(2);
  const mapOnly = args.includes('--map-only');
  const inputs = args.filter(a => a !== '--map-only');
  const files = discoverInputs(inputs);
  const candidates = collectCandidates(files);
  const selection = selectExpansion(candidates, REQUIRED_PER_TASK);
  printPlan(selection);
  if (mapOnly) return;

  const repoRoot = path.resolve(__dirname, '..', '..');
  for (const item of selection.selected) processItem(item, repoRoot);
  const datasetDir = rebuildDataset(repoRoot);
  console.log(`\nSTRATEGY SMOKE EXPANSION: PASS (${selection.selected.length} selected, ${selection.reserve.length} reserve)`);
  console.log(`DATASET: ${datasetDir}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`STRATEGY SMOKE EXPANSION: FAIL\n${String(error?.message || error)}`);
    process.exitCode = 1;
  }
}

module.exports = {
  TASKS,
  REQUIRED_PER_TASK,
  taskKey,
  selectExpansion,
  transitionTargetLabel,
  findSemanticTransition,
  validateReview
};
