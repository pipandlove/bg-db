import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPosition, emptyPosition, legalPlays, pipCount, checkPosition, applyNotated, positionKey, step, winKind } from '../src/index.js';

test('start position: 15 checkers, 167 pips each, consistent', () => {
  const p = startPosition();
  assert.equal(checkPosition(p), null);
  assert.equal(pipCount(p, 0), 167);
  assert.equal(pipCount(p, 1), 167);
});

test('opening 31: 8/5 6/5 (making the 5 point) is legal, 24/21 alone is not', () => {
  const p = startPosition();
  const { plays } = legalPlays(p, 0, 3, 1);
  const good = applyNotated(p, 0, [{ from: 8, to: 5 }, { from: 6, to: 5 }]);
  const bad = applyNotated(p, 0, [{ from: 24, to: 21 }]);
  assert.ok(plays.has(positionKey(good.pos)));
  assert.ok(!plays.has(positionKey(bad.pos)));
});

test('entering from the bar is mandatory and blocked points cannot be entered', () => {
  const p = emptyPosition();
  p.c[0][25] = 1; p.c[0][13] = 14;
  p.c[1][24] = 2; p.c[1][13] = 13;           // opponent holds our entry point 1 (25-24)... as their 24 => our 1
  // our entry with die d lands on point 25-d; block entry for a 6 (point 19 = opponent's point 6)
  p.c[1][6] = 2; p.c[1][24] = 0; p.c[1][12] = 13;
  assert.equal(step(p, 0, 13, 3), null, 'must enter first');
  assert.equal(step(p, 0, 25, 6), null, 'point 19 is blocked');
  assert.deepEqual(step(p, 0, 25, 5), { to: 20, hit: false });
});

test('a lone blot is hit', () => {
  const p = emptyPosition();
  p.c[0][8] = 15; p.c[1][20] = 1; p.c[1][13] = 14; // opponent blot on their 20 = our 5
  assert.deepEqual(step(p, 0, 8, 3), { to: 5, hit: true });
});

test('bearing off: a larger die may only be used from the highest point', () => {
  const p = emptyPosition();
  p.c[0][6] = 1; p.c[0][3] = 1; p.off[0] = 13;
  p.c[1][24] = 15;
  assert.equal(step(p, 0, 3, 5), null, 'checker on 6 still exists');
  assert.deepEqual(step(p, 0, 6, 6), { to: 0, hit: false });
  const q = emptyPosition();
  q.c[0][3] = 2; q.off[0] = 13; q.c[1][24] = 15;
  assert.deepEqual(step(q, 0, 3, 6), { to: 0, hit: false });
});

test('"cannot move" is a legal outcome only when nothing can be played', () => {
  const p = emptyPosition();
  p.c[0][25] = 1; p.c[0][13] = 14;
  for (let pt = 19; pt <= 24; pt++) p.c[1][25 - pt] = 2; // closed board: our entry points blocked
  p.c[1][1] = 3;
  const r = legalPlays(p, 0, 6, 5);
  assert.equal(r.used, 0);
  assert.equal(r.plays.size, 1);
});

test('only one die playable: the larger must be played when possible', () => {
  // one checker on point 24, both dice (6 and 5) are playable alone but never together
  // because the opponent holds our point 13 (reached by 24-6-5 or 24-5-6)
  const p = emptyPosition();
  p.c[0][24] = 1; p.off[0] = 14;
  p.c[1][12] = 2;      // our point 13 is blocked
  p.c[1][24] = 13;
  const r = legalPlays(p, 0, 5, 6);
  assert.equal(r.used, 1);
  assert.equal(r.plays.size, 1);
  assert.equal([...r.plays.values()][0].pos.c[0][18], 1, 'the 6 must be played (24 -> 18)');
});

test('win kinds: single, gammon, backgammon', () => {
  const p = emptyPosition();
  p.off[0] = 15; p.off[1] = 3; p.c[1][5] = 12;
  assert.equal(winKind(p, 0).kind, 'single');
  p.off[1] = 0;
  assert.equal(winKind(p, 0).kind, 'gammon');
  p.c[1][20] = 1; p.c[1][5] = 11;
  assert.equal(winKind(p, 0).kind, 'backgammon');
});
