'use strict';

const assert = require('assert');
const Labels = require('../observer/semantic_observer.js');

assert.strictEqual(Labels.normalizeAccessibleText('  HTML\n  elements  '), 'HTML elements');
assert.strictEqual(Labels.labelFromParts({ ariaLabel: 'Explicit', visibleText: 'Fallback' }), 'Explicit');
assert.strictEqual(Labels.labelFromParts({ ariaLabelledBy: 'Referenced label', visibleText: 'Fallback' }), 'Referenced label');
assert.strictEqual(Labels.labelFromParts({ visibleText: 'Visible nested link text' }), 'Visible nested link text');
assert.strictEqual(Labels.labelFromParts({ imageAlt: 'Image action' }), 'Image action');
assert.strictEqual(Labels.labelFromParts({}), '');

console.log('Semantic accessible label contract: PASS');
