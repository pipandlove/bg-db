import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anonymizeMatchText, ANON_ID, readMatch, matchHash16 } from '../src/index.js';
import { allTextFixtures } from './helpers.js';

test('replaces the match id and nothing else, keeps handles and line endings', () => {
  const text = '; [Site "X"]\r\n; [Match ID "-859897353"]\r\n; [Player 1 "XG Roller+"]\r\n';
  const r = anonymizeMatchText(text);
  assert.equal(r.changed, true);
  assert.deepEqual(r.ids, ['-859897353']);
  assert.equal(r.text, `; [Site "X"]\r\n; [Match ID "${ANON_ID}"]\r\n; [Player 1 "XG Roller+"]\r\n`);
});

test('is idempotent and leaves files without a match id alone', () => {
  const once = anonymizeMatchText('; [Match ID "123"]\n').text;
  const twice = anonymizeMatchText(once);
  assert.equal(twice.changed, false);
  assert.equal(twice.text, once);
  assert.equal(anonymizeMatchText('(;FF[4]GM[6])').changed, false);
});

test('every fixture is anonymised, still valid, and keeps its identity', () => {
  for (const [file, text] of allTextFixtures()) {
    assert.equal(anonymizeMatchText(text).changed, false, `${file} still has a site match id`);
    const r = readMatch(text);
    assert.equal(r.ok, true, file);
    assert.match(matchHash16(r.match), /^[0-9a-f]{16}$/);
  }
});

test('anonymising does not change the identity of a match', () => {
  const [, text] = allTextFixtures().find(([f]) => f.includes('Linnet14'));
  const withId = text.replace(`"${ANON_ID}"`, '"7629174"');
  assert.notEqual(withId, text);
  assert.equal(matchHash16(readMatch(withId).match), matchHash16(readMatch(text).match));
});
