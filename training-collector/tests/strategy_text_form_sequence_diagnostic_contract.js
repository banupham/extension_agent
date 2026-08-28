'use strict';

const assert = require('assert');
const Diagnostic = require('../tools/diagnose_strategy_text_form_sequences.js');

function observation(element, pageSignal = null) {
  return {
    url: 'https://example.test/form',
    title: '',
    interactiveElements: element ? [{ rendered: true, visible: true, enabled: true, ...element }] : [],
    pageSignals: pageSignal ? { status: pageSignal } : {},
    privacy: { redacted: true, selectorsStored: false, tabIdStored: false }
  };
}

function transition(id, rawAction, before, after) {
  return {
    transitionId: id,
    rawAction,
    strategyObservationBefore: before,
    strategyObservationAfter: after,
    outcome: { actionSucceeded: true, partial: false }
  };
}

function allKeys(value, out = []) {
  if (Array.isArray(value)) {
    value.forEach(item => allKeys(item, out));
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value)) {
    out.push(key.toLowerCase());
    allKeys(child, out);
  }
  return out;
}

function main() {
  const field = { ref: 'semantic-ref-1', label: 'Generic Input', role: 'textbox', tag: 'textarea', editable: true };
  const before = observation(field);
  const afterSubmit = observation(field, 'submitted');
  const transitions = [
    transition('t1', { kind: 'focus', targetRef: 'semantic-ref-1' }, before, before),
    transition('t2', { kind: 'text-key', operation: 'type-char', key: 'Q', targetRef: 'semantic-ref-1' }, before, before),
    transition('t3', { kind: 'text-key', operation: 'type-char', key: 'Z', targetRef: 'semantic-ref-1' }, before, before),
    transition('t4', { kind: 'text-key', operation: 'enter', code: 'Enter', targetRef: 'semantic-ref-1' }, before, afterSubmit)
  ];

  const result = Diagnostic.sequenceDiagnostic(
    transitions,
    { instruction: 'Type SENSITIVE_LITERAL into Generic Input then press Enter.' },
    { finalOutcome: { status: 'success' } }
  );

  assert.equal(result.declaredTextPresent, true);
  assert.equal(result.taskSubmitIntent, true);
  assert.equal(result.finalOutcomeSuccess, true);
  assert.equal(result.typeCharCount, 2);
  assert.equal(result.enterCandidateCount, 1);
  assert.equal(result.resolvedSequenceDetected, true);
  assert.deepEqual(result.rejectionReasons, []);

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('SENSITIVE_LITERAL'), false);
  assert.equal(serialized.includes('"key":"Q"'), false);
  assert.equal(serialized.includes('"key":"Z"'), false);
  assert.equal(serialized.includes('semantic-ref-1'), false);

  const keys = allKeys(result);
  for (const forbidden of ['selector', 'selectorcandidates', 'coordinate', 'coordinates', 'tabid', 'cdp', 'rawcdp', 'point']) {
    assert.equal(keys.includes(forbidden), false, `forbidden diagnostic field: ${forbidden}`);
  }

  const unsupported = Diagnostic.sequenceDiagnostic(
    transitions.slice(0, 3),
    { instruction: 'Type harmless words into Generic Input.' },
    { finalOutcome: { status: 'success' } }
  );
  assert.equal(unsupported.resolvedSequenceDetected, false);
  assert.equal(unsupported.rejectionReasons.includes('task_submit_intent_not_detected'), true);
  assert.equal(unsupported.rejectionReasons.includes('enter_transition_not_detected'), true);

  console.log('Strategy text/form sequence diagnostic contract: PASS');
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error('Strategy text/form sequence diagnostic contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { main };
