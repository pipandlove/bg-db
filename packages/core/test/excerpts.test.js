/**
 * Matches that are not a plain list of consecutive games (docs/formats/illegal-play-marker.md, docs/game-endings.md, decision 0020):
 *   - excerpts: games are missing between two games of the file, the start score of each game is trusted
 *   - the "Illegal play (...)" marker: a play that is not written, with the position after it
 *   - a game whose plays are lost: kept by its result
 *   - damaged files: plays are missing, the position is unknown
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseMat } from '../src/mat.js';
import { validateMatch } from '../src/validate.js';
import { readMatch } from '../src/read.js';
import { writeMat } from '../src/mat-writer.js';
import { contentHash } from '../src/identity.js';
import { toBgdbJson, buildMeta } from '../src/record.js';
import { parseIllegalDump, positionFromDump } from '../src/illegal-dump.js';
import { emptyPosition, startPosition, legalPlays, applyNotated, hitsBetween, movesBetween, positionKey } from '../src/rules.js';
import { FIXTURES } from './helpers.js';

const read = (rel) => fs.readFileSync(path.join(FIXTURES, rel), 'utf8');
const MIDGAME = 'extmatchdb/illegal-play-marker-midgame_15pt.txt';
const LOST_GAME = 'extmatchdb/illegal-play-marker-lost-game_11pt.txt';
const EXCERPT = 'extmatchdb/excerpt-games-missing_19pt.mat';
const DAMAGED = 'invalid/damaged-missing-plays_ouzelbird-albatros_9pt.txt';
const BLUEJAY = 'backgammon-studio/Bluejay_-_tester_5pt_Backgammon_Studio_2026_08_16_13_00_36.mat';
const MARKER = '15;0;1;0;0;Morley;Tanguay;0;9;9;1;0;0;0;0;2;2;2;2;0;2;0;1;0;-2;0;0;-3;0;-4;0;-3;2;-1;0;2;-2;0;1;6;';

// ------------------------------------------------------------------------------------------------ the dump
test('marker: the dump is decoded (match length, names, scores, the board of 15 + 15 checkers, the dice of the next roll)', () => {
  const d = parseIllegalDump(MARKER);
  assert.deepEqual([d.matchLength, d.names, d.scores, d.dice], [15, ['Morley', 'Tanguay'], [9, 9], [1, 6]]);
  const pos = positionFromDump(d, 1);                                    // Morley is the right player: side 1
  assert.deepEqual([3, 4, 5, 6, 8, 10, 20, 23].map((p) => pos.c[1][p]), [2, 2, 2, 2, 2, 1, 2, 2]);
  assert.deepEqual([1, 4, 6, 8, 10, 13].map((p) => pos.c[0][p]), [2, 1, 3, 4, 3, 2]);
  assert.deepEqual(pos.off, [0, 0]);
  const z = positionFromDump(parseIllegalDump('11;0;1;0;0;Bob Zanders;Michael Dixon;0;9;10;1;0;0;1;1;2;2;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;-1;0;0;-2;0;0;6;6;'), 1);
  assert.deepEqual(z.off, [12, 9], 'checkers that are not on the board are borne off');
  assert.equal(parseIllegalDump('1;2;3'), null, 'another layout is not read');
});

test('moves between two positions: forward steps only, through the points that were hit', () => {
  const p0 = startPosition();
  const p1 = applyNotated(p0, 0, [{ from: 24, to: 18 }, { from: 13, to: 11 }]).pos;
  assert.deepEqual(movesBetween(p0, p1, 0).map((m) => [m.from, m.to]).sort(), [[13, 11], [24, 18]]);
  assert.equal(movesBetween(p1, p0, 0), null, 'a checker cannot move backwards');
});

test('moves between two positions: a hit that is passed through (a checker lands on the blot and goes on) is reproduced', () => {
  const before = emptyPosition();
  before.c[0][10] = 1; before.c[0][24] = 14;
  before.c[1][20] = 1; before.c[1][1] = 14;                              // side 1's point 20 is side 0's point 5: a blot there
  const after = applyNotated(before, 0, [{ from: 10, to: 5 }, { from: 5, to: 2 }]).pos;   // 10/5*/2
  assert.equal(after.c[1][25], 1, 'the blot was hit');
  const hits = hitsBetween(before, after, 0);
  assert.deepEqual(hits, [5]);
  const moves = movesBetween(before, after, 0, hits);
  assert.deepEqual(moves.map((m) => [m.from, m.to]), [[10, 5], [5, 2]], 'through the hit point');
  assert.equal(positionKey(applyNotated(before, 0, moves).pos), positionKey(after));
  assert.notEqual(positionKey(applyNotated(before, 0, movesBetween(before, after, 0, [])).pos), positionKey(after), 'without the waypoint the hit is missed');
  const lost = emptyPosition(); lost.c[0][10] = 1; lost.c[0][24] = 14; lost.c[1][1] = 14; lost.off[1] = 1;
  assert.equal(hitsBetween(before, lost, 0), null, 'a checker that vanished is not a hit');
});

// ------------------------------------------------------------------------------------------------ the marker in a match
test('marker: an unwritten play is rebuilt from the position after it (Tanguay vs Morley, game 12, move 10)', () => {
  const r = readMatch(read(MIDGAME));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.match.games.length, 16);
  const a = r.match.games[11].actions.find((x) => x.illegal);
  assert.deepEqual([a.side, a.dice, a.moves.map((m) => [m.from, m.to])], [0, [1, 1], [[14, 10], [11, 10], [11, 10]]]);
  assert.match(r.warnings.find((w) => w.code === 'V-ILLEGAL').message, /Game 12, move 10: the play of Tanguay \(11\) is not written.*reconstructed as 11: 14\/10 11\/10\(2\)/);
  assert.equal(r.match.illegalPlays.length, 1);
  assert.deepEqual([r.match.illegalPlays[0].game, r.match.illegalPlays[0].row, r.match.illegalPlays[0].player], [12, 10, 'Tanguay']);
  assert.equal(r.match.games[11].result.winner, 1, 'Morley wins game 12');
  assert.deepEqual(r.match.result.score, [11, 16]);
});

test('marker: the reconstructed play survives the normalised file (illegal play tag, same identity)', () => {
  const r = readMatch(read(MIDGAME));
  const text = writeMat(r.match);
  assert.match(text, /IllegalPlay "Game 12, Move 10 of Tanguay"/);
  assert.doesNotMatch(text, /Illegal play \(/, 'the dump is not copied into the normalised file');
  const back = readMatch(text);
  assert.equal(back.ok, true, JSON.stringify(back.errors));
  assert.equal(contentHash(back.match), contentHash(r.match));
});

test('marker: it must belong to the match, and agree with the plays around it; otherwise it is an error and says why', () => {
  const text = read(MIDGAME);
  const edit = (from, to) => readMatch(text.replace(from, to));
  assert.match(edit('Morley;Tanguay;0;9;9', 'Morley;Nobody;0;9;9').errors[0].message, /the marker names Morley and Nobody, who are not the players/);
  assert.match(edit('(15;0;1;0;0;Morley', '(19;0;1;0;0;Morley').errors[0].message, /belongs to a 19-point match/);
  assert.match(edit('Tanguay;0;9;9;1', 'Tanguay;0;9;8;1').errors[0].message, /the marker is for the score/);
  assert.match(edit('-2;0;1;6;)', '-2;0;2;6;)').errors[0].message, /says that the next roll is 26 but the file has 16/);
  const moved = edit('0;0;0;0;2;2;2;2;0;2;0;1;', '0;0;0;0;2;2;2;2;0;2;1;0;');   // the OTHER player's checker has moved: no single play explains it
  assert.match(moved.errors[0].message, /does not follow from the position before it by one play/);
  assert.equal(moved.errors[0].code, 'V-LEGAL');
});

/** the marker (same layout as a real one) of a position, for the match of the Tanguay file */
const markerOf = (legal) => {
  const board = Array(26).fill(0);
  for (let p = 1; p <= 24; p++) board[p] = legal.c[1][p] - legal.c[0][25 - p];
  return ['15', '0', '1', '0', '0', 'Morley', 'Tanguay', '0', '9', '9', '1', '0', ...board.map(String), '1', '6', ''].join(';');
};
const positionBeforeMarker = (m) => {
  let pos = startPosition();
  for (const a of m.games[11].actions) {
    if (a.kind !== 'move') continue;
    if (a.marker) break;
    pos = applyNotated(pos, a.side, a.moves).pos;
  }
  return pos;
};

test('marker: when a legal play reaches the position, the play is rebuilt and NOT flagged as illegal', () => {
  const { plays } = legalPlays(positionBeforeMarker(parseMat(read(MIDGAME))), 0, 1, 1);
  assert.ok(plays.size > 10);
  for (const v of [...plays.values()].slice(0, 12)) {
    const m = parseMat(read(MIDGAME));
    const g = m.games[11];
    const at = g.actions.findIndex((a) => a.marker);
    g.actions[at].marker = parseIllegalDump(markerOf(v.pos));
    g.actions = g.actions.slice(0, at + 2);                              // the unwritten play and the next roll (Morley's 16: 8/2 10/9)
    g.declared = { winner: 1, points: 1, matchEnd: false };
    m.games = [g];
    const r = validateMatch(m);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.match.illegalPlays.length, 0, 'a legal play is not an illegal play');
    assert.equal(g.actions[at].illegal, undefined);
    assert.match(r.infos.find((x) => x.code === 'V-ILLEGAL').message, /reached by a legal play: reconstructed as 11:/);
    assert.equal(positionKey(g.actions[at].pos), positionKey(v.pos), 'the position is the one the marker gives');
  }
});

test('marker: no legal play of that roll fits the rest of the real game: the play was really illegal (the 80 legal results of 1-1 are tried)', () => {
  const { plays } = legalPlays(positionBeforeMarker(parseMat(read(MIDGAME))), 0, 1, 1);
  assert.equal(plays.size, 80);
  let fits = 0;
  for (const v of plays.values()) {
    const m = parseMat(read(MIDGAME));
    const g = m.games[11];
    g.actions.find((x) => x.marker).marker = parseIllegalDump(markerOf(v.pos));
    m.games = [g];                                                       // game 12 alone: it starts at 9-9, a fragment
    if (validateMatch(m).ok) fits++;
  }
  assert.equal(fits, 0);
});

// ------------------------------------------------------------------------------------------------ a game whose plays are lost
test('lost game: a game that starts with the marker of a much later position is kept by its result (Dixon vs Zanders, game 13)', () => {
  const r = readMatch(read(LOST_GAME));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const g = r.match.games[12];
  assert.deepEqual([g.resultOnly, g.actions.length, g.result.winner, g.result.points, g.result.how], [true, 0, 1, 2, 'declared']);
  assert.deepEqual(r.match.result, { winner: 1, score: [10, 11], finished: true });
  assert.match(r.warnings.find((w) => /plays before it are lost/.test(w.message)).message, /only its result is kept \(Bob Zanders wins 2 point\(s\)\)/);
  assert.equal(r.match.games.filter((x) => x.resultOnly).length, 1, 'the other 12 games are complete');
});

test('lost game: the result is part of the identity (it is all there is), is written as a declared game and reads back identically', () => {
  const r = readMatch(read(LOST_GAME));
  const text = writeMat(r.match);
  assert.match(text, /ResultOnly "Game 13"/);
  const back = readMatch(text);
  assert.equal(back.ok, true, JSON.stringify(back.errors));
  assert.equal(contentHash(back.match), contentHash(r.match));
  const other = parseMat(read(LOST_GAME));
  other.games[12].declared.points = 1;                                    // a different result for the lost game: a different match
  other.games[12].declared.matchEnd = false;
  assert.notEqual(contentHash(validateMatch(other).match), contentHash(r.match));
});

test('lost game: a game with no plays and a Wins line, not declared as result-only, is a resignation before the first roll (as before)', () => {
  const m = parseMat(read(LOST_GAME));
  m.games[12].actions = [];
  m.resultOnlyDeclared = [];
  const r = validateMatch(m);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.match.games[12].result.how, 'resign');
  assert.equal(r.match.games[12].resultOnly, undefined);
  assert.notEqual(contentHash(r.match), contentHash(readMatch(read(LOST_GAME)).match), 'a lost game is not the same as a resignation');
});

test('lost game: the replay data and the metadata say it', () => {
  const r = readMatch(read(LOST_GAME));
  const j = toBgdbJson(r.match, { id: '0001/x', sides: r.match.sides });
  assert.equal(j.games[12].ro, 1);
  assert.deepEqual(j.games[12].actions, []);
  assert.equal(j.games[0].ro, undefined);
  const meta = buildMeta(r.match, { id: '0001/x', contentHash: 'h', canonicalVersion: 1, originalHash: 'o' });
  assert.equal(meta.games[12].resultOnly, true);
});

// ------------------------------------------------------------------------------------------------ excerpts
test('excerpt: games missing between games of the file are accepted, reported, and the start score of each game is trusted (1978 San Francisco)', () => {
  const r = readMatch(read(EXCERPT));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.match.games.map((g) => g.startScore), [[6, 4], [6, 5], [8, 10], [11, 14]]);
  assert.deepEqual(r.match.result.partial, { startScore: [6, 4], gaps: [{ before: 3, from: [6, 7], to: [8, 10] }, { before: 4, from: [8, 11], to: [11, 14] }] });
  assert.deepEqual(r.match.result, { winner: null, score: [11, 16], finished: false, partial: r.match.result.partial });
  const w = r.warnings.find((x) => /Game 3 starts at 8-10 but game 2 ended at 6-7/.test(x.message));
  assert.match(w.message, /the Wins line of game 2 says Chris Peterson wins 2 point\(s\)/);
  assert.match(w.message, /games are missing between them, the file is an excerpt/);
});

test('excerpt: it is written as normalised .mat (start scores as written) and reads back to the same match', () => {
  const r = readMatch(read(EXCERPT));
  const back = readMatch(writeMat(r.match));
  assert.equal(back.ok, true, JSON.stringify(back.errors));
  assert.equal(contentHash(back.match), contentHash(r.match));
  assert.deepEqual(back.match.result.partial.gaps.length, 2);
});

test('excerpt: games numbered with holes (1, 2, 6, 10) keep their numbers in the normalised file, so the gaps read back the same', () => {
  const text = read(EXCERPT).replace(/^ Game 3(\r?)$/m, ' Game 6$1').replace(/^ Game 4(\r?)$/m, ' Game 10$1');
  const r = readMatch(text);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.match.result.partial.gaps.map((g) => g.before), [6, 10], 'a gap names the game by its number in the file');
  const out = writeMat(r.match);
  assert.deepEqual(out.match(/^ Game \d+$/gm), [' Game 1', ' Game 2', ' Game 6', ' Game 10']);
  const back = readMatch(out);
  assert.equal(back.ok, true, JSON.stringify(back.errors));
  assert.deepEqual(back.match.result, r.match.result, 'the build compares exactly this');
  assert.equal(writeMat(back.match), out, 'writing is a fixed point');
  assert.equal(contentHash(r.match), contentHash(readMatch(read(EXCERPT)).match), 'game numbers are not part of the identity');
});

test('excerpt: after a gap the Crawford game is inferred like at the start of a fragment (a double proves it is behind)', () => {
  const run = (cut) => { const m = parseMat(read(BLUEJAY)); m.games.splice(1, cut); const r = validateMatch(m); assert.equal(r.ok, true, JSON.stringify(r.errors)); return r; };
  assert.deepEqual(readMatch(read(BLUEJAY)).match.games.map((g) => g.crawford), [false, false, false, false, true, false]);
  const atCrawford = run(3);                                             // games 2-4 are missing: game 5 (the Crawford game) follows game 1
  assert.deepEqual(atCrawford.match.games.map((g) => g.crawford), [false, true, false]);
  assert.match(atCrawford.infos.find((i) => /Crawford/.test(i.message)).message, /taken as the Crawford game/);
  const after = run(4);                                                  // games 2-5 are missing: game 6 has a double
  assert.deepEqual(after.match.games.map((g) => g.crawford), [false, false]);
  assert.match(after.infos.find((i) => /Crawford/.test(i.message)).message, /after the Crawford game/);
});

// ------------------------------------------------------------------------------------------------ damaged
test('damaged: plays that are missing (a roll written with no play although a play was possible) -> the match cannot be ingested, and is tagged', () => {
  const r = readMatch(read(DAMAGED));
  assert.equal(r.ok, false);
  assert.equal(r.damaged, true);
  const d = r.errors.filter((e) => e.code === 'V-DAMAGED');
  assert.equal(d.length, 7, 'one per game, and a summary');
  assert.match(d[0].message, /Game 1, move 27: the play of ouzelbird for 24 is missing \(3 different plays were possible\)/);
  assert.match(d[1].message, /Game 2, move 8: .* \(1 different play was possible\)/);
  assert.match(d[6].message, /This match is damaged: plays are missing in 6 of 6 game\(s\)/);
  assert.equal(r.errors.some((e) => e.code === 'V-LEGAL'), false, 'a missing play is not reported as an illegal one');
});

test('damaged: a dance (no play was possible) is not a missing play; a WRONG play is a typo (V-LEGAL), not damage', () => {
  assert.equal(readMatch(read('extmatchdb/hidden-play-and-empty-rows_13pt.txt')).ok, true, 'Cannot Move rows are fine');
  const m = parseMat(read('extmatchdb/game-ends-play-cut-after-one-die.mat'));
  const target = m.games[1].actions.filter((a) => a.kind === 'move' && a.moves.length > 1)[3];
  target.moves = [{ from: 3, to: 1 }];
  const typo = validateMatch(m);
  assert.equal(typo.damaged, undefined);
  assert.equal(typo.errors[0].code, 'V-LEGAL');
  target.moves = [];
  assert.equal(validateMatch(m).damaged, true, 'nothing written although a play existed');
});
