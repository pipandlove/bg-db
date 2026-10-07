/**
 * Two transcriptions of one match (decision 0023): the rolls are compared, game by game, whatever the notation of the plays.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMat, rollTokens, compareRolls, diffText, sameMatchClusters, keeperOf } from '../src/index.js';
import { read } from './helpers.js';

const TEXT = read('opengammon/vireo_vs_tester_2026-09-30.mat');
const tokens = (t) => rollTokens(parseMat(t));

test('the rolls of a match: numbered by the players\' names, so the order of the columns does not matter; the key holds players and length', () => {
  const t = tokens(TEXT);
  assert.equal(t.key, 'tester / vireo | 5');
  assert.deepEqual(t.players, ['tester', 'vireo']);
  assert.deepEqual(t.games[0].tokens.slice(0, 3), ['m1:51', 'm0:52', 'm1:63']);
  assert.equal(t.games[0].rows[0], 1);
  assert.equal(rollTokens({ sides: [{ name: 'A' }, { name: 'a' }], matchLength: 1, games: [] }).key, null, 'two players with the same name');
});

test('comparison: the share of rolls in common, and the first place they differ, named', () => {
  const same = compareRolls(tokens(TEXT), tokens(TEXT.replace('52: 24/22 13/8', '52: 13/11 13/8')));
  assert.deepEqual([same.ratio, same.diff], [1, null], 'another play with the same dice: the rolls are the same');
  assert.equal(diffText(same.diff), 'the same rolls; the plays differ');
  const typo = compareRolls(tokens(TEXT), tokens(TEXT.replace('52: 24/22 13/8', '53: 24/22 13/8')));
  assert.ok(typo.ratio > 0.98 && typo.ratio < 1);
  assert.equal(diffText(typo.diff), 'game 1, row 1: tester rolls 52 here, tester rolls 53 in the other');
  const other = compareRolls(tokens(TEXT), tokens(read('opengammon/Sir_Plover_vs_tester_2026-08-03.mat')));
  assert.ok(other.ratio < 0.5, 'two different matches');
});

test('clusters: only the same players and length, and at least 95% in common; the keeper is the only best rank', () => {
  const a = tokens(TEXT);
  const b = tokens(TEXT.replace('52: 24/22 13/8', '53: 24/22 13/8'));
  const c = tokens(read('opengammon/Sir_Plover_vs_tester_2026-08-03.mat'));
  const cl = sameMatchClusters([{ id: 'a', tokens: a }, { id: 'b', tokens: b }, { id: 'c', tokens: c }]);
  assert.deepEqual(cl.map((x) => x.members.sort()), [['a', 'b']]);
  assert.equal(sameMatchClusters([{ id: 'a', tokens: a }, { id: 'b', tokens: b }], 1).length, 0, 'below the ratio asked');
  assert.equal(keeperOf([{ id: 'a', rank: 3 }, { id: 'b', rank: 2 }]), 'a');
  assert.equal(keeperOf([{ id: 'a', rank: 3 }, { id: 'b', rank: 3 }]), null, 'both valid: a person chooses');
  assert.equal(keeperOf([{ id: 'a', rank: 1 }, { id: 'b', rank: 1 }]), null, 'both refused: nothing to keep');
});
