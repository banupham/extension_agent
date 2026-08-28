'use strict';

const assert = require('assert');
const Gate = require('../core/episode_capture_gate.js');

const observation = { observationId: 'obs-1', interactiveElements: [] };
assert.deepEqual(Gate.assertSnapshotReady({ ok: true, observation }), observation);
assert.throws(() => Gate.assertSnapshotReady(null), /episode_snapshot_unavailable/);
assert.throws(() => Gate.assertSnapshotReady({ ok: false }), /episode_snapshot_unavailable/);
assert.throws(() => Gate.assertSnapshotReady({ ok: true, observation: null }), /episode_snapshot_unavailable/);

assert.equal(Gate.assertCaptureArmed({ ok: true, pageInstanceId: 'page-1' }).ok, true);
assert.throws(() => Gate.assertCaptureArmed(undefined), /episode_capture_not_armed/);
assert.throws(() => Gate.assertCaptureArmed({ ok: false }), /episode_capture_not_armed/);
assert.throws(() => Gate.assertCaptureArmed({ ok: true, ignoredSubframe: true }), /episode_capture_not_armed/);

const emptyEpisode = { transitions: [] };
assert.deepEqual(Gate.transitionCounts(emptyEpisode), { total: 0, complete: 0, pending: 0 });
assert.throws(
  () => Gate.assertStopAllowed(emptyEpisode, { status: 'success' }),
  /episode_success_requires_complete_transition/
);

const pendingEpisode = { transitions: [{ transitionId: 't1', status: 'pending' }] };
assert.throws(
  () => Gate.assertStopAllowed(pendingEpisode, { status: 'success' }),
  /episode_success_requires_complete_transition/
);

const mixedEpisode = {
  transitions: [
    { transitionId: 't1', status: 'complete' },
    { transitionId: 't2', status: 'pending' }
  ]
};
assert.throws(
  () => Gate.assertStopAllowed(mixedEpisode, { status: 'success' }),
  /episode_success_has_pending_transition/
);

const completeEpisode = { transitions: [{ transitionId: 't1', status: 'complete' }] };
assert.deepEqual(
  Gate.assertStopAllowed(completeEpisode, { status: 'success' }),
  { total: 1, complete: 1, pending: 0 }
);
assert.deepEqual(
  Gate.assertStopAllowed(emptyEpisode, { status: 'failed' }),
  { total: 0, complete: 0, pending: 0 }
);

console.log('Task Episode capture fail-closed gate contract: PASS');
