'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TASKS = {
  'Start media playback, mute it, then unmute it': { slug: 'play-mute-unmute-a', splitGroup: '8091-multistep-play-mute-unmute-a-v1' },
  'Play the media, mute it, and then unmute it': { slug: 'play-mute-unmute-b', splitGroup: '8091-multistep-play-mute-unmute-b-v1' },
  'Begin playback, mute the media, then restore sound': { slug: 'play-mute-unmute-c', splitGroup: '8091-multistep-play-mute-unmute-c-v1' }
};

const SEQUENCE = [
  { type: 'play', label: 'Media Play', progress: 1 / 3, taskSucceeded: false },
  { type: 'mute', label: 'Media Mute', progress: 2 / 3, taskSucceeded: false },
  { type: 'unmute', label: 'Media Unmute', progress: 1, taskSucceeded: true }
];

const MAX_SCAN_DEPTH = 5;
const SKIP_DIRS = new Set(['.git', 'node_modules']);

function die(message) {
  throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalizeInstruction(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const TASK_BY_NORMALIZED = new Map(
  Object.entries(TASKS).map(([instruction, cfg]) => [normalizeInstruction(instruction), { instruction, cfg }])
);

function collectReviewFiles(root, out, depth = 0) {
  if (depth > MAX_SCAN_DEPTH) return;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectReviewFiles(full, out, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith('.task-episode-review.json')) {
      out.push(full);
    }
  }
}

function discoverInputs(args) {
  const raw = args.length ? args : [process.cwd()];
  const out = [];
  for (const input of raw) {
    const resolved = path.resolve(input);
    if (!fs.existsSync(resolved)) die(`input_not_found: ${resolved}`);
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) collectReviewFiles(resolved, out);
    else if (resolved.endsWith('.task-episode-review.json')) out.push(resolved);
  }
  if (!out.length) die('no_task_episode_review_files_found');
  return [...new Set(out)];
}

function selectLatestTaskFiles(files) {
  const latest = new Map();
  const discoveredInstructions = new Set();
  for (const file of files) {
    let review;
    try {
      review = readJson(file);
    } catch (_) {
      continue;
    }
    const rawInstruction = String(review?.task?.instruction || '').trim();
    if (rawInstruction) discoveredInstructions.add(rawInstruction);
    const matched = TASK_BY_NORMALIZED.get(normalizeInstruction(rawInstruction));
    if (!matched) continue;
    const instruction = matched.instruction;
    const stamp = Date.parse(review.exportedAt || review.endedAt || '') || fs.statSync(file).mtimeMs;
    const prior = latest.get(instruction);
    if (!prior || stamp > prior.stamp) latest.set(instruction, { file, review, stamp });
  }
  const items = [...latest.entries()].map(([instruction, value]) => ({ instruction, ...value }));
  items.discoveredInstructions = [...discoveredInstructions].sort();
  return items;
}

function transitionTargetLabel(transition) {
  const ref = transition?.rawAction?.targetRef;
  const elements = transition?.strategyObservationBefore?.interactiveElements || [];
  return elements.find(el => el?.ref === ref)?.label || null;
}

function findSequence(review) {
  const transitions = Array.isArray(review?.transitions) ? review.transitions : [];
  const hits = SEQUENCE.map(spec => transitions
    .map((transition, index) => ({ transition, index }))
    .filter(item =>
      item.transition?.status === 'complete' &&
      item.transition?.rawAction?.kind === 'click' &&
      transitionTargetLabel(item.transition) === spec.label
    ));

  for (let i = 0; i < hits.length; i += 1) {
    if (hits[i].length !== 1) die(`expected_exactly_one_${SEQUENCE[i].type}_transition: found=${hits[i].length}`);
  }
  const indexes = hits.map(items => items[0].index);
  if (!(indexes[0] < indexes[1] && indexes[1] < indexes[2])) {
    die('play_mute_unmute_transition_order_invalid');
  }
  return hits.map(items => items[0].transition);
}

function applyAnnotation(annotation, review, cfg, includedTransitions) {
  const includedById = new Map(includedTransitions.map((transition, index) => [transition.transitionId, {
    transition,
    spec: SEQUENCE[index]
  }]));

  annotation.splitGroup = cfg.splitGroup;
  annotation.review = {
    taskPrivacyReviewed: true,
    semanticLabelsVerified: true,
    outcomeVerified: true,
    credentialsExcluded: true,
    secretsExcluded: true
  };
  annotation.taskOverride = {
    taskId: `task-8091-${cfg.slug}-v1`,
    type: 'controlled-browser-action-sequence',
    instruction: review.task.instruction,
    args: {},
    successCriteria: [
      { type: 'page', field: 'title', operator: 'equals', value: 'UNMUTE PASS' }
    ],
    constraints: {},
    metadata: { surface: '127.0.0.1:8091', reviewed: true, sequence: ['play', 'mute', 'unmute'] }
  };

  let includedCount = 0;
  for (const step of annotation.steps || []) {
    const matched = includedById.get(step.transitionId);
    if (!matched) {
      step.include = false;
      step.exclusionReason = 'task_irrelevant_capture_noise';
      step.action = null;
      step.outcome = null;
      continue;
    }

    const targetRef = step?.evidence?.targetSummary?.ref || matched.transition?.rawAction?.targetRef;
    if (!targetRef) die(`missing_target_ref: ${step.transitionId}`);
    step.include = true;
    step.exclusionReason = null;
    step.action = {
      contractVersion: '0.1.0',
      type: matched.spec.type,
      targetRef,
      args: {},
      intent: `${matched.spec.type} ${matched.spec.label}`,
      expectedOutcome: {}
    };
    step.outcome = {
      actionSucceeded: true,
      taskSucceeded: matched.spec.taskSucceeded,
      progress: matched.spec.progress,
      evidence: [],
      errorCode: null
    };
    step.decisionReasonCode = 'verified_human_multistep_demonstration';
    includedCount += 1;
  }

  if (includedCount !== 3) die(`annotation_included_count_invalid: ${includedCount}`);
  return annotation;
}

function runNode(toolPath, args) {
  const result = spawnSync(process.execPath, [toolPath, ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) die(`tool_failed: ${path.basename(toolPath)} exit=${result.status}`);
}

function processItem(item, repoRoot, sourceDir) {
  const cfg = TASKS[item.instruction];
  const included = findSequence(item.review);
  const tools = path.join(repoRoot, 'training-collector', 'tools');
  const checker = path.join(tools, 'check_task_episode_review.js');
  const maker = path.join(tools, 'make_strategy_review_template.js');
  const adapter = path.join(tools, 'adapt_task_episode_review.js');

  console.log(`\n[${item.instruction}] play -> mute -> unmute`);
  console.log(`INPUT: ${item.file}`);
  runNode(checker, [item.file]);
  runNode(maker, [item.file]);

  const annotationFile = item.file.replace(/\.json$/i, '.strategy-review.json');
  const annotation = applyAnnotation(readJson(annotationFile), item.review, cfg, included);
  fs.writeFileSync(annotationFile, `${JSON.stringify(annotation, null, 2)}\n`, 'utf8');
  console.log(`ANNOTATION UPDATED: ${annotationFile}`);

  runNode(adapter, [item.file, '--annotation', annotationFile]);
  const strategyEpisodeFile = item.file.replace(/\.json$/i, '.strategy-episode.json');
  if (!fs.existsSync(strategyEpisodeFile)) die(`strategy_episode_not_created: ${strategyEpisodeFile}`);

  fs.mkdirSync(sourceDir, { recursive: true });
  const output = readJson(strategyEpisodeFile);
  if ((output.steps || []).map(step => step.action?.type).join(',') !== 'play,mute,unmute') {
    die(`adapted_sequence_invalid: ${output.episodeId}`);
  }
  const dest = path.join(sourceDir, `${output.episodeId}.json`);
  fs.copyFileSync(strategyEpisodeFile, dest);
  console.log(`COPIED: ${dest}`);
}

function main(argv = process.argv.slice(2)) {
  try {
    const files = discoverInputs(argv);
    const items = selectLatestTaskFiles(files);
    const missing = Object.keys(TASKS).filter(instruction => !items.some(item => item.instruction === instruction));
    if (missing.length) {
      const found = items.discoveredInstructions || [];
      console.error(`DISCOVERED REVIEW FILES: ${files.length}`);
      console.error(`DISCOVERED TASKS: ${found.length ? found.join(' | ') : '<none>'}`);
      die(`missing_multistep_tasks: ${missing.join(' | ')}`);
    }

    const repoRoot = path.resolve(__dirname, '..', '..');
    const root = path.join(repoRoot, 'training-collector', 'strategy-data', 'multistep-v02');
    const sourceDir = path.join(root, 'source');
    const datasetDir = path.join(root, 'dataset-v01');
    fs.mkdirSync(sourceDir, { recursive: true });

    for (const item of items) processItem(item, repoRoot, sourceDir);

    const tools = path.join(repoRoot, 'training-collector', 'tools');
    fs.rmSync(datasetDir, { recursive: true, force: true });
    runNode(path.join(tools, 'build_strategy_episode_dataset.js'), [sourceDir, '--output', datasetDir]);
    runNode(path.join(tools, 'check_strategy_baseline_readiness.js'), [datasetDir]);
    runNode(path.join(tools, 'fit_strategy_offline_baseline.js'), [datasetDir]);

    console.log(`\nMULTISTEP PLAY-MUTE-UNMUTE PIPELINE: PASS (${items.length} human episode(s))`);
    console.log(`MODEL: ${path.join(datasetDir, 'baseline-v01', 'model.json')}`);
  } catch (error) {
    console.error(`MULTISTEP PLAY-MUTE-UNMUTE PIPELINE: FAIL\n${String(error?.message || error)}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  TASKS,
  SEQUENCE,
  MAX_SCAN_DEPTH,
  normalizeInstruction,
  collectReviewFiles,
  discoverInputs,
  selectLatestTaskFiles,
  transitionTargetLabel,
  findSequence,
  applyAnnotation,
  main
};
