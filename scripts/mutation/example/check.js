// The "test suite" of the example: exits non-zero when the module misbehaves. Constants are written as LITERALS (a check that reads LIMIT from the module under mutation can
// never kill a mutant of LIMIT).
const assert = require('node:assert/strict');
const { clamp, isOverLimit } = require('./lib.js');

assert.equal(clamp(5, 0, 10), 5);
assert.equal(clamp(-1, 0, 10), 0);
assert.equal(clamp(11, 0, 10), 10);
assert.equal(clamp(0, 0, 10), 0);
assert.equal(clamp(10, 0, 10), 10);
assert.equal(isOverLimit(7), false);
assert.equal(isOverLimit(8), true);
assert.equal(isOverLimit(6), false);
console.log('example check passed');
