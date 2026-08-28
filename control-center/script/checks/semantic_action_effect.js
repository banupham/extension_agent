'use strict';

const assert = require('assert');
const {
  SEMANTIC_EFFECT_VERSION,
  observableEffectExpectedFor,
  evaluateActionEffect
} = require('../../manager/goal/semantic_effect_evaluator.js');

function page(overrides = {}) {
  return {
    observationId: overrides.observationId || 'obs',
    url: overrides.url || 'https://example.test/',
    title: overrides.title || 'READY',
    viewport: overrides.viewport || { width: 800, height: 600 },
    scroll: overrides.scroll || { x: 0, y: 0 },
    focusedRef: overrides.focusedRef || null,
    interactiveElements: overrides.interactiveElements || [],
    ...overrides
  };
}

function button(ref, label, overrides = {}) {
  return {
    ref,
    tag: 'button',
    role: 'button',
    label,
    visible: true,
    enabled: true,
    editable: false,
    checked: null,
    selectedValue: null,
    selectedIndex: null,
    rangeValue: null,
    ...overrides
  };
}

function effect({ before, after, action = { type: 'click', targetRef: 'e0' }, execution = { ok: true } }) {
  return evaluateActionEffect({ execution, action, before, after });
}

(function main() {
  assert.equal(SEMANTIC_EFFECT_VERSION, '0.2.0');
  assert.equal(observableEffectExpectedFor({ type: 'click' }), true);
  assert.equal(observableEffectExpectedFor({ type: 'moveTo' }), false);
  assert.equal(observableEffectExpectedFor({ type: 'waitAndObserve' }), false);

  const disappeared = effect({
    before: page({ interactiveElements: [button('e0', 'Dismiss')] }),
    after: page({ observationId: 'obs2', interactiveElements: [] })
  });
  assert.equal(disappeared.status, 'effect_observed');
  assert.equal(disappeared.observableEffectExpected, true);
  assert.ok(disappeared.meaningfulCodes.includes('target_disappeared'));
  assert.ok(disappeared.meaningfulCodes.includes('elements_removed'));

  const toggled = effect({
    before: page({ interactiveElements: [button('e0', 'Choice', { checked: false })] }),
    after: page({ observationId: 'obs2', interactiveElements: [button('e9', 'Choice', { checked: true })] })
  });
  assert.equal(toggled.status, 'effect_observed');
  assert.ok(toggled.meaningfulCodes.includes('target_checked_changed'));

  const disabled = effect({
    before: page({ interactiveElements: [button('e0', 'Run')] }),
    after: page({ observationId: 'obs2', interactiveElements: [button('e7', 'Run', { enabled: false })] })
  });
  assert.ok(disabled.meaningfulCodes.includes('target_enabled_changed'));

  const newUi = effect({
    before: page({ interactiveElements: [button('e0', 'Open')] }),
    after: page({
      observationId: 'obs2',
      interactiveElements: [button('e9', 'Open'), button('e10', 'Confirm')]
    })
  });
  assert.equal(newUi.status, 'effect_observed');
  assert.ok(newUi.meaningfulCodes.includes('elements_added'));

  const navigation = effect({
    before: page({ url: 'https://example.test/a', title: 'A', interactiveElements: [button('e0', 'Next')] }),
    after: page({ observationId: 'obs2', url: 'https://example.test/b', title: 'B', interactiveElements: [] })
  });
  assert.ok(navigation.meaningfulCodes.includes('page_url_changed'));
  assert.ok(navigation.meaningfulCodes.includes('page_title_changed'));

  const scrolled = evaluateActionEffect({
    execution: { ok: true },
    action: { type: 'scrollVertical', targetRef: null },
    before: page({ scroll: { x: 0, y: 0 } }),
    after: page({ observationId: 'obs2', scroll: { x: 0, y: 500 } })
  });
  assert.equal(scrolled.status, 'effect_observed');
  assert.equal(scrolled.observableEffectExpected, true);
  assert.deepEqual(scrolled.meaningfulCodes, ['scroll_changed']);

  const incidentalFocus = effect({
    before: page({
      interactiveElements: [button('e0', 'No Op')],
      focusedRef: null
    }),
    after: page({
      observationId: 'obs2',
      interactiveElements: [button('e9', 'No Op')],
      focusedRef: 'e9'
    })
  });
  assert.equal(incidentalFocus.status, 'no_effect');
  assert.deepEqual(incidentalFocus.meaningfulCodes, []);
  assert.deepEqual(incidentalFocus.incidentalCodes, ['focus_changed']);

  const explicitFocus = evaluateActionEffect({
    execution: { ok: true },
    action: { type: 'focus', targetRef: 'e0' },
    before: page({ interactiveElements: [button('e0', 'Search')], focusedRef: null }),
    after: page({ observationId: 'obs2', interactiveElements: [button('e9', 'Search')], focusedRef: 'e9' })
  });
  assert.equal(explicitFocus.status, 'effect_observed');
  assert.deepEqual(explicitFocus.meaningfulCodes, ['focus_changed']);

  const noEffect = effect({
    before: page({ interactiveElements: [button('e0', 'No Op')] }),
    after: page({ observationId: 'obs2', interactiveElements: [button('e9', 'No Op')] })
  });
  assert.equal(noEffect.status, 'no_effect');
  assert.equal(noEffect.observableEffectExpected, true);
  assert.deepEqual(noEffect.codes, []);

  const optionalNoEffect = evaluateActionEffect({
    execution: { ok: true },
    action: { type: 'moveTo', targetRef: 'e0' },
    before: page({ interactiveElements: [button('e0', 'Hover')]}),
    after: page({ observationId: 'obs2', interactiveElements: [button('e9', 'Hover')] })
  });
  assert.equal(optionalNoEffect.status, 'no_effect');
  assert.equal(optionalNoEffect.observableEffectExpected, false);

  const failed = evaluateActionEffect({
    execution: { ok: false, error: 'target_stale' },
    action: { type: 'click', targetRef: 'e0' },
    before: page(),
    after: page({ observationId: 'obs2' })
  });
  assert.equal(failed.status, 'execution_failed');
  assert.equal(failed.observableEffectExpected, true);
  assert.deepEqual(failed.codes, ['execution_failed']);

  const tabs = evaluateActionEffect({
    execution: { ok: true },
    action: { type: 'switchTab', targetRef: null },
    beforeBrowserContext: { tabs: [{ title: 'A', url: 'https://a.test/', active: true }] },
    afterBrowserContext: { tabs: [{ title: 'A', url: 'https://a.test/', active: false }, { title: 'B', url: 'https://b.test/', active: true }] }
  });
  assert.equal(tabs.status, 'effect_observed');
  assert.ok(tabs.meaningfulCodes.includes('browser_context_changed'));

  console.log('Semantic action effect contract: PASS');
})();
