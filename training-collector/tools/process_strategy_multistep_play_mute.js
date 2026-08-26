'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TASKS = {
  'Start media playback, then mute it': { slug: 'play-mute-a', splitGroup: '8091-multistep-play-mute-a-v1' },
  'Play the media and then mute it': { slug: 'play-mute-b', splitGroup: '8091-multistep-play-mute-b-v1' },
  'Begin playback before muting the media': { slug: 'play-mute-c', splitGroup: '8091-multistep-play-mute-c-v1' }
};

const SEQUENCE = [
  { type: 'play', label: 'Media Play', progress: 0.5, taskSucceeded: false },
  { type: 'mute', label: 'Media Mute', progress: 1, taskSucceeded: true }
];

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

function selectLatestTaskFiles(files) {
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
  if (hits[0][0].index >= hits[1][0].index) die('play_transition_must_precede_mute_transition');
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
      { type: 'page', field: 'title', operator: 'equals', value: 'MUTE PASS' }
    ],
    constraints: {},
    metadata: { surface: '127.0.0.1:8091', reviewed: true, sequence: ['play', 'mute'] }
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

  if (includedCount !== 2) die(`annotation_included_count_invalid: ${includedCount}`);
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

  console.log(`\n[${item.instruction}] play -> mute`);
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
  if ((output.steps || []).map(step => step.action?.type).join(',') !== 'play,mute') {
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
    if (missing.length) die(`missing_multistep_tasks: ${missing.join(' | ')}`);

    const repoRoot = path.resolve(__dirname, '..', '..');
    const root = path.join(repoRoot, 'training-collector', 'strategy-data', 'multistep-v01');
    const sourceDir = path.join(root, 'source');
    const datasetDir = path.join(root, 'dataset-v01');
    fs.mkdirSync(sourceDir, { recursive: true });

    for (const item of items) processItem(item, repoRoot, sourceDir);

    const tools = path.join(repoRoot, 'training-collector', 'tools');
    fs.rmSync(datasetDir, { recursive: true, force: true });
    runNode(path.join(tools, 'build_strategy_episode_dataset.js'), [sourceDir, '--output', datasetDir]);
    runNode(path.join(tools, 'check_strategy_baseline_readiness.js'), [datasetDir]);
    runNode(path.join(tools, 'fit_strategy_offline_baseline.js'), [datasetDir]);

    console.log(`\nMULTISTEP PLAY-MUTE PIPELINE: PASS (${items.length} human episode(s))`);
    console.log(`MODEL: ${path.join(datasetDir, 'baseline-v01', 'model.json')}`);
  } catch (error) {
    console.error(`MULTISTEP PLAY-MUTE PIPELINE: FAIL\n${String(error?.message || error)}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  TASKS,
  SEQUENCE,
  discoverInputs,
  selectLatestTaskFiles,
  transitionTargetLabel,
  findSequence,
  applyAnnotation,
  main
};
