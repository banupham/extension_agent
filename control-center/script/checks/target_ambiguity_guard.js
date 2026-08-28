'use strict';

const assert = require('assert');
const { createTargetAmbiguityGuardProvider } = require('../../manager/strategy/target_ambiguity_guard_provider.js');

function element(ref, label, extra = {}) {
  return { ref, label, tag: 'button', editable: false, enabled: true, visible: true, ...extra };
}

function provider(decision) {
  return { name: 'stub', version: 'test', async decide() { return decision; } };
}

async function main() {
  const duplicateDecision = {
    status: 'act', confidence: 0.9, reasonCode: 'stub', recovery: {}, metadata: {},
    action: { type: 'click', targetRef: 'e0', args: {}, expectedOutcome: {} }, targetRef: 'e0'
  };
  const guard = createTargetAmbiguityGuardProvider({ baseProvider: provider(duplicateDecision) });

  const blocked = await guard.decide({
    task: { instruction: 'click Control Node' }, history: [],
    observation: { interactiveElements: [element('e0', 'Control Node'), element('e1', 'Control Node')] }
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reasonCode, 'target_ambiguous_multiple_matches');
  assert.equal(blocked.metadata.duplicateSemanticTargetCount, 2);

  const unique = await guard.decide({
    task: { instruction: 'click Control Node' }, history: [],
    observation: { interactiveElements: [element('e0', 'Control Node'), element('e1', 'Other Node')] }
  });
  assert.equal(unique.status, 'act');
  assert.equal(unique.action.targetRef, 'e0');

  const continuity = await guard.decide({
    task: { instruction: 'submit Control Node' },
    history: [{ actionType: 'typeText', targetRef: 'e0' }],
    observation: { interactiveElements: [element('e0', 'Control Node'), element('e1', 'Control Node')] }
  });
  assert.equal(continuity.status, 'act');
  assert.equal(continuity.metadata.ambiguityAllowedByTargetContinuity, true);

  const disabledDuplicate = await guard.decide({
    task: { instruction: 'click Control Node' }, history: [],
    observation: { interactiveElements: [element('e0', 'Control Node'), element('e1', 'Control Node', { enabled: false })] }
  });
  assert.equal(disabledDuplicate.status, 'act');

  console.log('Target ambiguity guard contract: PASS');
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
