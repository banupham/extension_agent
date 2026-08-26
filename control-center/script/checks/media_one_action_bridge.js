'use strict';

const assert = require('assert');
const { runOneAction } = require('../../manager/agent/one_action_bridge.js');

async function runCase({ action, beforeTarget, afterTarget, afterTitle }) {
  let executed = null;
  let observeCount = 0;
  const runtime = {
    async observe() {
      observeCount += 1;
      const after = !!executed;
      return {
        observationId: `media-obs-${observeCount}`,
        url: 'https://example.test/media',
        title: after ? afterTitle : 'MEDIA READY',
        viewport: { width: 800, height: 600 },
        scroll: { x: 0, y: 0 },
        interactiveElements: [after ? afterTarget : beforeTarget]
      };
    },
    async executePlan(payload) {
      executed = payload;
      return { ok: true, actionType: payload.plan.actionType, stepCount: payload.plan.steps.length };
    }
  };

  const result = await runOneAction({
    runtime,
    decide: async () => ({ status: 'act', action }),
    rng: () => 0.5,
    postActionSettle: false
  });
  assert.strictEqual(result.mappedAction.type, action.type);
  assert.strictEqual(result.cdpPlan.actionType, action.type);
  assert.strictEqual(executed.observationId, 'media-obs-1');
  assert.strictEqual(result.execution.ok, true);
  assert.strictEqual(result.after.title, afterTitle);
  return result;
}

(async () => {
  const volumeBefore = {
    ref: 'e10', tag: 'input', inputType: 'range', label: 'Volume Target', editable: true, enabled: true, visible: true,
    rangeValue: 20, rangeMin: 0, rangeMax: 100, rangeStep: 1,
    rect: { x: 100, y: 200, width: 129, height: 16 }
  };
  const volume = await runCase({
    action: { type: 'setVolume', targetRef: 'e10', args: { value: 80 } },
    beforeTarget: volumeBefore,
    afterTarget: { ...volumeBefore, rangeValue: 80 },
    afterTitle: 'SETVOLUME PASS'
  });
  assert.ok(volume.cdpPlan.steps.some(step => step.params?.type === 'mousePressed'));
  assert.ok(volume.cdpPlan.steps.some(step => step.params?.type === 'mouseMoved' && step.params?.buttons === 1));

  const seekBefore = {
    ...volumeBefore,
    ref: 'e11', label: 'Seek Target', rangeValue: 10,
    rect: { x: 300, y: 200, width: 129, height: 16 }
  };
  const seek = await runCase({
    action: { type: 'seek', targetRef: 'e11', args: { value: 80 } },
    beforeTarget: seekBefore,
    afterTarget: { ...seekBefore, rangeValue: 80 },
    afterTitle: 'SEEK PASS'
  });
  assert.ok(seek.cdpPlan.steps.some(step => step.params?.type === 'mouseReleased'));

  const rateBefore = {
    ref: 'e12', tag: 'select', label: 'Playback Rate Target', editable: true, enabled: true, visible: true,
    selectedValue: '1', selectedIndex: 0,
    options: [
      { index: 0, value: '1', label: '1x', disabled: false, selected: true },
      { index: 1, value: '1.5', label: '1.5x', disabled: false, selected: false },
      { index: 2, value: '2', label: '2x', disabled: false, selected: false }
    ],
    rect: { x: 500, y: 200, width: 60, height: 20 }
  };
  const rate = await runCase({
    action: { type: 'changePlaybackRate', targetRef: 'e12', args: { value: 2 } },
    beforeTarget: rateBefore,
    afterTarget: { ...rateBefore, selectedValue: '2', selectedIndex: 2 },
    afterTitle: 'PLAYBACKRATE PASS'
  });
  const keyDowns = rate.cdpPlan.steps.filter(step => step.method === 'Input.dispatchKeyEvent' && step.params?.type === 'rawKeyDown');
  assert.deepStrictEqual(keyDowns.map(step => step.params.key), ['Home', 'ArrowDown', 'ArrowDown', 'Enter']);

  console.log('media_bridge: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
