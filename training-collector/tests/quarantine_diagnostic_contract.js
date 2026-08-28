'use strict';

const assert = require('assert');
const { quarantineDiagnostics, aggregateQuarantineKeys } = require('../tools/prepare_human_learning_batch.js');

function main() {
  const diagnostics = quarantineDiagnostics({
    eventManifest: [
      { quarantine: true, sensitiveKeyNames: ['value', 'token'] },
      { quarantine: true, sensitiveKeyNames: ['value'] },
      { quarantine: false, sensitiveKeyNames: ['ignored'] }
    ]
  });
  assert.equal(diagnostics.quarantinedEventCount, 2);
  assert.deepEqual(diagnostics.sensitiveKeyNames, ['token', 'value']);
  assert.equal(diagnostics.sensitiveKeyCounts.value, 2);
  assert.equal(diagnostics.sensitiveKeyCounts.token, 1);
  assert.equal(diagnostics.rawSensitiveValuesCopied, false);

  const aggregate = aggregateQuarantineKeys([
    { quarantineDiagnostics: diagnostics },
    { quarantineDiagnostics: { sensitiveKeyCounts: { token: 2, text: 1 } } }
  ]);
  assert.deepEqual(aggregate, { token: 3, value: 2, text: 1 });
  const serialized = JSON.stringify({ diagnostics, aggregate });
  assert.equal(serialized.includes('secret-payload-value'), false);

  console.log('Quarantine diagnostic contract: PASS');
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error('Quarantine diagnostic contract: FAIL');
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { main };
