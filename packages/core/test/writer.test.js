import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readMatch, writeMat, formatMoves, contentHash, normalizeName, makeBloom, bloomHas, CORE_VERSION } from '../src/index.js';
import { allTextFixtures } from './helpers.js';

const fixtures = allTextFixtures();

test('there are fixtures to test with', () => assert.ok(fixtures.length >= 14));

for (const [file, text] of fixtures) {
  test(`writeMat round trip: ${file.split('/').pop().slice(0, 48)}`, () => {
    const a = readMatch(text);
    assert.equal(a.ok, true);
    const written = writeMat(a.match);
    const b = readMatch(written);
    assert.equal(b.ok, true, JSON.stringify(b.errors));
    assert.equal(contentHash(b.match), contentHash(a.match), 'same identity');
    assert.deepEqual(b.match.result, a.match.result);
    const norm = (m) => m.games.map((g) => [g.result.winner, g.result.points, g.result.kind, g.result.cube]);
    assert.deepEqual(norm(b.match), norm(a.match));
    assert.deepEqual(b.match.sides.map((s) => s.name), a.match.sides.map((s) => s.name));
    assert.equal(b.match.provenance.dialect, 'bgdb');
    assert.equal(writeMat(b.match), written, 'writing is a fixed point');
  });
}

test('formatMoves groups identical checkers and marks hits, bar and off', () => {
  const m = (from, to, hit = false) => ({ from, to, hit });
  assert.equal(formatMoves([m(13, 10), m(13, 10), m(25, 20), m(6, 0), m(8, 3, true)]), '13/10(2) bar/20 6/off 8/3*');
  assert.equal(formatMoves([m(13, 7, true), m(13, 7)]), '13/7* 13/7');
});

test('the hidden-play resignation of a Backgammon Studio match is written as a resignation with the effective points', () => {
  const [, text] = fixtures.find(([f]) => f.includes('Bluejay'));
  const out = writeMat(readMatch(text).match);
  assert.match(out, /Resigned Game\n\s+Wins 2 points and the match/);
  assert.ok(!out.includes('????'));
});

test('long left cells push the right column to the right instead of breaking the layout', () => {
  const [, text] = fixtures.find(([f]) => f.includes('XG_Roller__03-10-2026.txt'));
  const m = readMatch(text).match;
  m.sides[0].name = 'A very long player name that exceeds forty characters';
  const b = readMatch(writeMat(m));
  assert.equal(b.ok, true, JSON.stringify(b.errors));
  assert.equal(b.match.sides[0].name, m.sides[0].name);
});

test('normalizeName: accents, case, spaces', () => {
  assert.equal(normalizeName('  Élodie   DUPONT '), 'elodie dupont');
  assert.equal(normalizeName('XG Roller+'), 'xg roller+');
});

test('bloom filter: no false negatives, few false positives, deterministic bytes', () => {
  const names = Array.from({ length: 500 }, (_, i) => `player${i}`);
  const b = makeBloom(names);
  for (const n of names) assert.equal(bloomHas(b, n), true);
  let fp = 0;
  for (let i = 0; i < 2000; i++) if (bloomHas(b, `stranger${i}`)) fp++;
  assert.ok(fp / 2000 < 0.03, `false positive rate ${fp / 2000}`);
  assert.deepEqual(makeBloom([...names].reverse()), b, 'order of items does not matter');
});

test('CORE_VERSION is the version of the package', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(CORE_VERSION, pkg.version);
});
