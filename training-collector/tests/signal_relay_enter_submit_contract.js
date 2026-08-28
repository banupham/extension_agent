'use strict';

const assert = require('assert');
const { labHtml, EVIDENCE_CLASS } = require('../../control-center/script/offline_strategy_fresh_long_mission_gate.js');

function between(text, start, end) {
  const from = text.indexOf(start);
  if (from < 0) return '';
  const to = text.indexOf(end, from + start.length);
  return to < 0 ? '' : text.slice(from, to + end.length);
}

function main() {
  const html = labHtml();
  const form = between(html, '<form id="relayForm">', '</form>');

  assert.ok(form, 'relayForm must exist');
  assert.ok(form.includes('id="relayNote"'), 'Relay Note input must remain in the form');
  assert.ok(form.includes('aria-label="Relay Note"'), 'Relay Note must remain semantically observable');

  const submit = /<button\s+id="relaySubmit"\s+type="submit"\s+hidden\s+aria-hidden="true"\s+tabindex="-1">Submit Relay<\/button>/u;
  assert.ok(submit.test(form), 'relayForm must contain a real default submit control for Enter implicit submission');

  assert.ok(html.includes("relayForm.addEventListener('submit'"), 'stage transition must be driven by the form submit event');
  assert.ok(!html.includes("relayNote.addEventListener('keydown'"), 'lab must not hardcode an Enter key handler on the target input');
  assert.ok(!html.includes('.requestSubmit('), 'lab must not synthesize submission through requestSubmit');
  assert.ok(!html.includes('.submit()'), 'lab must not bypass native form submission');

  assert.equal(EVIDENCE_CLASS, 'regression-after-diagnosis');

  console.log('Signal Relay Enter-submit semantics contract: PASS');
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error('Signal Relay Enter-submit semantics contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { between, main };
