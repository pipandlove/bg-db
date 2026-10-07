/**
 * Games that start from a set position ("; Set Pos=<XGID board>/n", eXtreme Gammon). Not supported yet: the file is refused (roadmap,
 * docs/formats/README.md). The tests marked `todo` describe what the feature must do; they run and report, but do not fail the suite until
 * the feature exists. When it does, remove the `todo` marks and move the fixture out of fixtures/invalid/ (to fixtures/extmatchdb/).
 *
 * The fixture: an 11-point match recorded from 0-1, whose game 1 starts from a set position ("unclear opening"). Found in four real files:
 * the uppercase checkers of the board are the LEFT player of the score line (side 0), whatever the "/0" or "/1" suffix says; from that
 * position every play of the game is legal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMatch, parseMat, parseXGID, writeMat, matchHash16, contentHash, toBgdbJson, buildMeta, CANONICAL_VERSION } from '../src/index.js';
import { positionKey, startPosition } from '../src/rules.js';
import { read } from './helpers.js';

const FIXTURE = 'invalid/set-position-start_11pt.mat';
const TODO = { todo: 'games from a set position: not supported yet (roadmap)' };
const BOARD = '----cBD-D-B--A--Abcdc---A-';
const setPosition = () => parseXGID(`${BOARD}:0:0:1:00:0:0:0:0:10`).pos;   // uppercase = side 0

test('today: a game from a set position is refused with a sentence, never replayed from the opening', () => {
  const r = readMatch(read(FIXTURE));
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1, JSON.stringify(r.errors));
  assert.match(r.errors[0].message, /Game 1: the file starts the game from a set position/);
});

test('the parser keeps the "Set Pos" board on the first action of the game', () => {
  const m = parseMat(read(FIXTURE));
  assert.equal(m.games[0].actions[0].setPos.board, BOARD);
  assert.deepEqual(m.games[0].startScore, [0, 1]);
});

test('a game from a set position is valid: it is replayed from that position (uppercase = the left player)', TODO, () => {
  const r = readMatch(read(FIXTURE));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const g = r.match.games[0];
  assert.equal(positionKey(g.startPosition), positionKey(setPosition()), 'the game records where it starts');
  assert.ok(r.match.games.slice(1).every((x) => !x.startPosition || positionKey(x.startPosition) === positionKey(startPosition())), 'the other games start from the opening');
  assert.ok(r.warnings.some((d) => d.code === 'V-PARTIAL'), 'recorded from 0-1: a fragment');
});

test('the identity covers the start position: the same moves from another position are another match', TODO, () => {
  const r = readMatch(read(FIXTURE));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const moved = structuredClone(r.match);
  const p = moved.games[0].startPosition;
  const from = p.c[1].findIndex((n, i) => i > 0 && n > 0);          // move one checker of the right player by one point
  p.c[1][from]--;
  p.c[1][from + 1]++;
  assert.notEqual(contentHash(moved), contentHash(r.match));
});

test('the normalised .mat keeps the start position: writing and reading again gives the same match', TODO, () => {
  const r = readMatch(read(FIXTURE));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const again = readMatch(writeMat(r.match));
  assert.equal(again.ok, true, JSON.stringify(again.errors));
  assert.equal(matchHash16(again.match), matchHash16(r.match));
});

test('the replay data says where the game starts', TODO, () => {
  const r = readMatch(read(FIXTURE));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const meta = buildMeta(r.match, { id: `0001/${matchHash16(r.match)}`, contentHash: 'x'.repeat(64), canonicalVersion: CANONICAL_VERSION, originalHash: 'y' });
  const json = toBgdbJson(r.match, meta);
  assert.ok(json.games[0].start, 'game 1 carries its start position');
  assert.equal(json.games[1].start, undefined, 'a game from the opening carries none');
});
