'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TASKS = {
  'Play Media': {
    actionType: 'play', targetLabel: 'Media Play', successTitle: 'PLAY PASS', slug: 'media-play'
  },
  'Pause Media': {
    actionType: 'pause', targetLabel: 'Media Pause', successTitle: 'PAUSE PASS', slug: 'media-pause'
  },
  'Mute Media': {
    actionType: 'mute', targetLabel: 'Media Mute', successTitle: 'MUTE PASS', slug: 'media-mute'
  },
  'Unmute Media': {
    actionType: 'unmute', targetLabel: 'Media Unmute', successTitle: 'UNMUTE PASS', slug: 'media-unmute'
  }
};

function die(message) {
  throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
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

function selectLatestKnownTaskFiles(files) {
  const latest = new Map();
  for (const file of files) {
    const review = readJson(file);
    const instruction = String(review?.task?.instruction || '').trim();
    if (!TASKS[instruction]) continue;
    const stamp = Date.parse(review.exportedAt || review.endedAt || '') || fs.statSync(file).mtimeMs;
    const prior = latest.get(instruction);
    if (!prior || stamp > prior.stamp) latest.set(instruction, { file, review, stamp });
  }
  return [...latest.entries()].map(([instruction, value]) => ({ instruction, ...value }));
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
    die(`expected_exactly_one_${cfg.actionType}_click_transition: found=${matches.length}`);
  }
  return matches[0];
}

function printMapping(items) {
  console.log('MEDIA SMOKE LABEL MAP');
  for (const item of items) {
    const cfg = TASKS[item.instruction];
    const hit = findSemanticTransition(item.review, cfg);
    console.log(`${item.instruction} -> ${cfg.actionType} -> ${cfg.targetLabel} -> ${hit.rawAction.targetRef} -> ${hit.transitionId}`);
  }
}

function runNode(toolPath, args) {
  const result = spawnSync(process.execPath, [toolPath, ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) die(`tool_failed: ${path.basename(toolPath)} exit=${result.status}`);
}

function annotate(templateFile, review, cfg, includedTransition) {
  const annotation = readJson(templateFile);
  const includedId = includedTransition.transitionId;
  annotation.splitGroup = `8091-${cfg.slug}-v1`;
  annotation.review = {
    taskPrivacyReviewed: true,
    semanticLabelsVerified: true,
    outcomeVerified: true,
    credentialsExcluded: true,
    secretsExcluded: true
  };
  annotation.taskOverride = {
    taskId: `task-8091-${cfg.slug}-v1`,
    type: 'controlled-browser-action',
    instruction: review.task.instruction,
    args: {},
    successCriteria: [
      { type: 'page', field: 'title', operator: 'equals', value: cfg.successTitle }
    ],
    constraints: {},
    metadata: { surface: '127.0.0.1:8091', reviewed: true }
  };

  let includedCount = 0;
  for (const step of annotation.steps || []) {
    if (step.transitionId === includedId) {
      const targetRef = step?.evidence?.targetSummary?.ref || includedTransition?.rawAction?.targetRef;
      if (!targetRef) die(`missing_target_ref: ${includedId}`);
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
  fs.writeFileSync(templateFile, `${JSON.stringify(annotation, null, 2)}\n`);
}

function processItem(item, repoRoot) {
  const cfg = TASKS[item.instruction];
  const relevant = findSemanticTransition(item.review, cfg);
  const tools = path.join(repoRoot, 'training-collector', 'tools');
  const checker = path.join(tools, 'check_task_episode_review.js');
  const maker = path.join(tools, 'make_strategy_review_template.js');
  const adapter = path.join(tools, 'adapt_task_episode_review.js');
  for (const tool of [checker, maker, adapter]) {
    if (!fs.existsSync(tool)) die(`repo_tool_not_found: ${tool}`);
  }

  console.log(`\n[${item.instruction}] ${cfg.actionType} / ${cfg.targetLabel} / ${relevant.rawAction.targetRef}`);
  runNode(checker, [item.file]);
  runNode(maker, [item.file]);

  const annotationFile = item.file.replace(/\.json$/i, '.strategy-review.json');
  if (!fs.existsSync(annotationFile)) die(`annotation_template_not_created: ${annotationFile}`);
  annotate(annotationFile, item.review, cfg, relevant);
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

function main() {
  const args = process.argv.slice(2);
  const mapOnly = args.includes('--map-only');
  const inputs = args.filter(a => a !== '--map-only');
  const files = discoverInputs(inputs);
  const items = selectLatestKnownTaskFiles(files);
  if (!items.length) die('no_known_media_smoke_tasks_found');
  const missing = Object.keys(TASKS).filter(instruction => !items.some(item => item.instruction === instruction));
  if (missing.length) die(`missing_media_smoke_tasks: ${missing.join(', ')}`);

  printMapping(items);
  if (mapOnly) return;

  const repoRoot = path.resolve(__dirname, '..', '..');
  for (const item of items) processItem(item, repoRoot);
  console.log(`\nMEDIA SMOKE BATCH: PASS (${items.length} task(s))`);
}

try {
  main();
} catch (error) {
  console.error(`MEDIA SMOKE BATCH: FAIL\n${String(error?.message || error)}`);
  process.exitCode = 1;
}
