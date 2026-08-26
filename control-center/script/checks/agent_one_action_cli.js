'use strict';

const assert = require('assert');
const Harness = require('../agent_one_action.js');

const args = Harness.parseArgs(['--type', 'click', '--label', 'Like', '--timeout', '5000']);
assert.strictEqual(args.type, 'click');
assert.strictEqual(args.label, 'Like');
assert.strictEqual(args.timeout, '5000');
assert.strictEqual(Harness.normalizeText('  Hello   WORLD '), 'hello world');

const scopeArgs = Harness.parseArgs(['--tabs', '--tabs-scope', 'matching', '--host', 'facebook.com', '--max-tabs', '4']);
assert.deepStrictEqual(Harness.scopeFromArgs(scopeArgs, 'all'), {
  mode: 'matching',
  hostname: 'facebook.com',
  maxTabs: 4
});

const observation = {
  interactiveElements: [
    { ref: 'e1', label: 'Like', role: 'button' },
    { ref: 'e2', label: 'Comments', role: 'button' },
    { ref: 'e3', label: 'Open video', role: 'link' }
  ]
};
assert.strictEqual(Harness.chooseTarget(observation, { label: 'Like' }).ref, 'e1');
assert.strictEqual(Harness.chooseTarget(observation, { label: 'video' }).ref, 'e3');
assert.strictEqual(Harness.chooseTarget(observation, { ref: 'e2' }).ref, 'e2');

const click = Harness.actionFromArgs(observation, { type: 'click', label: 'Like' });
assert.strictEqual(click.action.type, 'click');
assert.strictEqual(click.action.targetRef, 'e1');

const scroll = Harness.actionFromArgs(observation, { type: 'scrollHorizontal', direction: '-1' });
assert.strictEqual(scroll.action.args.direction, -1);
assert.strictEqual(scroll.action.targetRef, undefined);

const typing = Harness.actionFromArgs(observation, { type: 'typeText', text: 'hello' });
assert.strictEqual(typing.action.args.text, 'hello');

assert.throws(() => Harness.chooseTarget({ interactiveElements: [
  { ref: 'a', label: 'Open item' }, { ref: 'b', label: 'Open item' }
] }, { label: 'Open item' }), /ambiguous_exact_label/);

console.log('Agent one-action native harness contract: PASS');
