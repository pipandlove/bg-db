import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPosition, toXGID, parseXGID, toGnubgId, parseGnubgId, positionKey, emptyPosition, legalPlays } from '../src/index.js';

const START_XGID = 'XGID=-b----E-C---eE---c-e----B-:0:0:1:00:0:0:0:0:10';

test('XGID of the start position is the well-known string', () => {
  assert.equal(toXGID(startPosition(), { onRoll: 0 }), START_XGID);
});

test('XGID decode/encode round trip with cube, dice and score', () => {
  const p = startPosition();
  const ctx = { onRoll: 0, cube: 4, cubeOwner: 1, dice: [3, 6], score: [2, 3], matchLength: 7, crawford: false };
  const x = toXGID(p, ctx);
  assert.match(x, /:2:-1:1:63:2:3:0:7:10$/);
  const d = parseXGID(x);
  assert.equal(positionKey(d.pos), positionKey(p));
  assert.equal(d.ctx.cube, 4);
  assert.deepEqual(d.ctx.dice, [6, 3]);
  assert.equal(d.ctx.cubeOwner, 1);
});

test('XGID with checkers on the bar and borne off round-trips', () => {
  const p = emptyPosition();
  p.c[0][25] = 1; p.c[0][6] = 4; p.off[0] = 10;
  p.c[1][25] = 2; p.c[1][12] = 13;
  const x = toXGID(p, { onRoll: 0 });
  const d = parseXGID(x);
  assert.equal(positionKey(d.pos), positionKey(p));
});

test('XGID rejects malformed input with a clear message', () => {
  assert.throws(() => parseXGID('XGID=abc'), /expected 10 fields/);
  assert.throws(() => parseXGID('XGID=' + '-'.repeat(25) + ':0:0:1:00:0:0:0:0:10'), /26 characters/);
});

test('GNUBGID of the start position matches the IDs printed by GNU Backgammon', () => {
  assert.equal(toGnubgId(startPosition(), { onRoll: 1 }), '4HPwATDgc/ABMA:cAkAAAAAAAAA');
  const d = parseGnubgId('4HPwATDgc/ABMA:cAkAAAAAAAAA');
  assert.equal(positionKey(d.pos), positionKey(startPosition()));
});

test('GNUBGID round trip with match state', () => {
  const p = emptyPosition();
  p.c[0][25] = 1; p.c[0][6] = 5; p.c[0][8] = 3; p.off[0] = 6;
  p.c[1][24] = 2; p.c[1][13] = 5; p.c[1][8] = 3; p.c[1][6] = 4; p.off[1] = 1;
  const ctx = { onRoll: 0, cube: 2, cubeOwner: 1, dice: [5, 2], score: [3, 1], matchLength: 9, crawford: false };
  const id = toGnubgId(p, ctx);
  const d = parseGnubgId(id);
  assert.equal(positionKey(d.pos), positionKey(p));
  assert.equal(d.ctx.onRoll, 0);
  assert.equal(d.ctx.cube, 2);
  assert.equal(d.ctx.cubeOwner, 1);
  assert.deepEqual(d.ctx.dice, [5, 2]);
  assert.deepEqual(d.ctx.score, [3, 1]);
  assert.equal(d.ctx.matchLength, 9);
});

test('a bare position ID (no match ID) is accepted', () => {
  const d = parseGnubgId('4HPwATDgc/ABMA');
  assert.equal(positionKey(d.pos), positionKey(startPosition()));
});

// A position exported by eXtreme Gammon: the lowercase player has 2 checkers on the bar (index 0),
// is on roll (turn -1) with 52, and the last-but-one field is 1 in a money game.
const BAR_XGID = 'XGID=b-A-BaC-D---cB---bBcbb--A-:0:0:-1:52:0:0:1:0:10';

test('XGID with two lowercase checkers on index 0 (real XG export) decodes as the other side\'s bar', () => {
  const d = parseXGID(BAR_XGID);
  assert.equal(d.pos.c[1][25], 2, 'two checkers on the bar of the lowercase side');
  assert.equal(d.pos.c[0][25], 0);
  assert.equal(d.ctx.onRoll, 1, 'turn -1: the lowercase side is on roll');
  assert.deepEqual(d.ctx.dice, [5, 2]);
  assert.equal(d.ctx.matchLength, 0);
  assert.equal(d.ctx.jacoby, true);
  assert.equal(d.ctx.crawford, false);
  for (const s of [0, 1]) {
    const on = d.pos.c[s].reduce((a, b) => a + b, 0);
    assert.equal(on + d.pos.off[s], 15);
  }
  assert.equal(d.pos.c[0][2], 1);   // 'A' on index 2 = point 2 of the uppercase side
  assert.equal(d.pos.c[0][8], 4);   // 'D' on index 8
  assert.equal(d.pos.c[1][20], 1);  // 'a' on index 5 = the lowercase side's point 20 (25 - 5)
});

test('the only legal play for that roll enters both checkers and hits the blot on point 2', () => {
  const d = parseXGID(BAR_XGID);
  const { plays, used } = legalPlays(d.pos, 1, 5, 2);
  assert.equal(used, 2);
  assert.equal(plays.size, 1);
  assert.equal([...plays.values()][0].pos.c[0][25], 1, 'the uppercase blot is now on the bar');
});

test('that XGID is reproduced character for character when written from the same perspective', () => {
  const d = parseXGID(BAR_XGID);
  assert.equal(toXGID(d.pos, { ...d.ctx }), BAR_XGID);
});

test('written from the side on roll, the same position gives a different but equivalent XGID', () => {
  const d = parseXGID(BAR_XGID);
  const flipped = toXGID(d.pos, { ...d.ctx, perspective: undefined });
  assert.notEqual(flipped, BAR_XGID);
  assert.match(flipped, /^XGID=[-A-Oa-o]{26}:0:0:1:52:0:0:1:0:10$/);
  const back = parseXGID(flipped);
  assert.equal(back.ctx.onRoll, 0);
  assert.equal(back.pos.c[0][25], 2);
});
