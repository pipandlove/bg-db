import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { sha256Hex } from '../src/index.js';

test('sha256 matches node:crypto on assorted inputs', () => {
  const inputs = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'héllo wörld', JSON.stringify([1, 'x', [2, 3]])];
  for (const s of inputs) assert.equal(sha256Hex(s), crypto.createHash('sha256').update(s).digest('hex'), `input length ${s.length}`);
});
