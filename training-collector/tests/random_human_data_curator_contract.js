'use strict';

const assert = require('assert');
const {
  classifyEvent,
  curateSession
} = require('../tools/curate_random_human_data.js');

function safeSession() {
  return {
    session: { sessionId: 'safe-session' },
    events: [
      {
        type: 'dom-click',
        sessionSeq: 1,
        targetRef: 'el-1',
        semanticTarget: { elementRef: 'el-1', label: 'Open result' },
        targetDescriptor: {
          elementRef: 'el-1',
          tag: 'button',
          role: 'button',
          label: 'Open result',
          selector: '#open-result',
          selectorCandidates: [
            { type: 'id', value: '#open-result', score: 1 },
            { type: 'tag', value: 'button', score: 0.2 }
          ]
        }
      },
      {
        type: 'pointer',
        sessionSeq: 2,
        xNorm: 0.4,
        yNorm: 0.6
      },
      {
        type: 'collector-stream-health',
        sessionSeq: 3,
        sourceEventCounts: { physical: 2, semantic: 1 }
      }
    ]
  };
}

function unsafeSession() {
  return {
    session: { sessionId: 'unsafe-session' },
    events: [
      {
        type: 'dom-click',
        sessionSeq: 1,
        targetRef: 'el-2',
        semanticTarget: { elementRef: 'el-2', label: 'Submit' },
        password: 'DO_NOT_COPY_THIS_SECRET'
      },
      {
        type: 'pointer',
        sessionSeq: 2,
        xNorm: 0.1,
        yNorm: 0.2
      }
    ]
  };
}

function rawValueSession() {
  return {
    session: { sessionId: 'raw-value-session' },
    events: [
      {
        type: 'dom-input',
        sessionSeq: 1,
        targetRef: 'el-3',
        value: 'RAW_TYPED_CONTENT_MUST_NOT_FLOW_TO_DERIVED_DATA'
      }
    ]
  };
}

function main() {
  const safe = curateSession(safeSession(), {
    taskContextVerified: true,
    outcomeVerified: true
  });
  assert.equal(safe.curatorVersion, '0.1.1');
  assert.equal(safe.totalEvents, 3);
  assert.equal(safe.behavior.candidateEventCount, 2);
  assert.equal(safe.behavior.semanticActionAnchorCount, 1);
  assert.equal(safe.behavior.eligibleForBehaviorFeatureExtraction, true);
  assert.equal(safe.counts.diagnostics, 1);
  assert.equal(safe.privacy.quarantinedEventCount, 0);
  assert.deepEqual(safe.privacy.quarantineSensitiveKeyCounts, {});
  assert.equal(safe.strategy.reviewCandidate, true);
  assert.equal(safe.strategy.autoTrainEligible, false);
  assert.equal(safe.strategy.reasonCode, 'requires_human_strategy_review_before_dataset_fit');

  const randomWithoutTask = curateSession(safeSession());
  assert.equal(randomWithoutTask.strategy.reviewCandidate, false);
  assert.equal(randomWithoutTask.strategy.autoTrainEligible, false);
  assert.equal(randomWithoutTask.strategy.reasonCode, 'task_context_and_verified_outcome_required');

  const unsafe = curateSession(unsafeSession(), {
    taskContextVerified: true,
    outcomeVerified: true
  });
  assert.equal(unsafe.privacy.quarantinedEventCount, 1);
  assert.equal(unsafe.privacy.quarantineSensitiveKeyCounts.password, 1);
  assert.equal(unsafe.behavior.eligibleForBehaviorFeatureExtraction, false);
  assert.equal(unsafe.strategy.reviewCandidate, false);
  assert.equal(unsafe.strategy.autoTrainEligible, false);
  assert.equal(unsafe.eventManifest[0].quarantine, true);
  assert(unsafe.eventManifest[0].sensitiveKeyNames.includes('password'));

  const rawValue = curateSession(rawValueSession());
  assert.equal(rawValue.privacy.quarantinedEventCount, 1);
  assert.equal(rawValue.privacy.quarantineSensitiveKeyCounts.value, 1);
  assert.equal(rawValue.behavior.eligibleForBehaviorFeatureExtraction, false);

  const serializedUnsafe = JSON.stringify(unsafe);
  assert.equal(serializedUnsafe.includes('DO_NOT_COPY_THIS_SECRET'), false);
  assert.equal(serializedUnsafe.includes('"tabId"'), false);
  assert.equal(serializedUnsafe.includes('"selector"'), false);
  assert.equal(serializedUnsafe.includes('privateReasoning'), false);

  const unsupported = classifyEvent({ type: 'opaque-noise', sessionSeq: 9 }, 0);
  assert.equal(unsupported.behaviorLane, false);
  assert.equal(unsupported.strategyLane, false);
  assert.equal(unsupported.reasonCode, 'unsupported_or_low_value_event');

  console.log('Random human data curator contract: PASS');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('Random human data curator contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = {
  safeSession,
  unsafeSession,
  rawValueSession,
  main
};
