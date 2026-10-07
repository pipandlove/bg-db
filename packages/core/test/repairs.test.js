import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseMat } from '../src/mat.js';
import { validateMatch } from '../src/validate.js';
import { readMatch } from '../src/read.js';
import { writeMat } from '../src/mat-writer.js';
import { contentHash } from '../src/identity.js';
import { startPosition, isPartialPlay } from '../src/rules.js';
import { FIXTURES } from './helpers.js';

const CUT_DIE = 'extmatchdb/game-ends-play-cut-after-one-die.mat';
const DICE_NO_PLAY = 'extmatchdb/game-ends-dice-without-play_17pt.txt';
const read = (rel) => fs.readFileSync(path.join(FIXTURES, rel), 'utf8');
const codes = (r) => [...r.errors, ...r.warnings, ...r.infos].map((d) => `${d.severity}:${d.code}`);

test('isPartialPlay: a prefix of a legal play is partial; a complete play, a wrong die or an impossible step is not', () => {
  const pos = startPosition();
  const m = (...x) => x.map(([from, to]) => ({ from, to }));
  assert.equal(isPartialPlay(pos, 0, 6, 2, []), true, 'rolled and moved nothing');
  assert.equal(isPartialPlay(pos, 0, 6, 2, m([24, 18])), true, 'one die of two');
  assert.equal(isPartialPlay(pos, 0, 6, 2, m([13, 11])), true, 'the other die, first');
  assert.equal(isPartialPlay(pos, 0, 6, 2, m([24, 18], [13, 11])), false, 'complete');
  assert.equal(isPartialPlay(pos, 0, 6, 2, m([24, 16])), false, 'not a prefix with these dice');
  assert.equal(isPartialPlay(pos, 0, 6, 2, m([24, 20])), false, 'a 4 was not rolled');
  assert.equal(isPartialPlay(pos, 0, 3, 3, m([8, 5], [8, 5])), true, 'two of four with doubles');
  assert.equal(isPartialPlay(pos, 0, 3, 3, m([8, 5], [8, 5], [6, 3], [6, 3])), false, 'all four');
});

test('a roll abandoned by the loser (one die played, or none) is read as a resignation, in both files', () => {
  const f = readMatch(read(CUT_DIE));
  assert.equal(f.ok, true, JSON.stringify(f.errors));
  assert.deepEqual(f.match.result, { winner: 1, score: [0, 11], finished: true });
  assert.deepEqual(f.match.games.map((g) => [g.result.winner, g.result.points, g.result.how]), [[1, 2, 'drop'], [1, 1, 'drop'], [1, 4, 'resign'], [1, 4, 'resign']]);
  assert.equal(f.infos.filter((d) => /the game stops there/.test(d.message)).length, 2);
  const d = readMatch(read(DICE_NO_PLAY));
  assert.equal(d.ok, true, JSON.stringify(d.errors));
  assert.deepEqual(d.match.result, { winner: 0, score: [17, 13], finished: true });
  assert.deepEqual(d.infos.filter((x) => /the game stops there/.test(x.message)).map((x) => x.game), [5, 11]);
  assert.match(d.infos.find((x) => /played nothing/.test(x.message)).message, /Michael Dixon rolled 16 and played nothing/);
});

test('the repaired matches are written as normalised .mat with the partial roll and a resignation marker, and read back identically', () => {
  for (const rel of [CUT_DIE, DICE_NO_PLAY]) {
    const first = readMatch(read(rel));
    const text = writeMat(first.match);
    assert.match(text, /Resigned Game/);
    const again = readMatch(text);
    assert.equal(again.ok, true, JSON.stringify(again.errors));
    assert.equal(contentHash(again.match), contentHash(first.match));
  }
  const cutText = writeMat(readMatch(read(CUT_DIE)).match);
  assert.match(cutText, /64: 22\/16\s*\n\s+Resigned Game/);
});

test('the repair needs the file to settle the game: without a Wins line the same play is an error', () => {
  const m = parseMat(read(CUT_DIE));
  m.games[2].declared = null;
  const r = validateMatch(m);
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /Game 3: the move .* is not legal for this roll/);
});

test('the Wins line cannot be flipped by the tail: if the roller is made the winner, the next game\'s score contradicts it', () => {
  const m = parseMat(read(CUT_DIE));
  m.games[2].declared.winner = 0;
  const r = validateMatch(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'V-SCORE' && /Game 4 starts at 0-7/.test(e.message)));
});

test('the repair only applies to the LAST roll of a game: a partial play in the middle stays an error', () => {
  const m = parseMat(read(CUT_DIE));
  const moves = m.games[2].actions.filter((a) => a.kind === 'move' && a.moves.length > 1);
  moves[3].moves = moves[3].moves.slice(0, 1);
  const r = validateMatch(m);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'V-LEGAL');
});

test('a last roll that is not even a prefix of a legal play (a die that was not rolled) is dropped with a warning, the game is still a resignation', () => {
  const m = parseMat(read(CUT_DIE));
  const last = m.games[2].actions[m.games[2].actions.length - 1];
  last.moves = [{ from: 22, to: 15 }];
  const r = validateMatch(m);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.match(r.warnings.find((w) => /not a possible play/.test(w.message)).message, /is ignored/);
  assert.equal(r.match.games[2].result.how, 'resign');
});

test('one broken game is reported once: later games do not complain about their start score', () => {
  const m = parseMat(read(DICE_NO_PLAY));
  const a = m.games[1].actions.filter((x) => x.kind === 'move' && x.moves.length)[6];
  a.moves = [{ from: 3, to: 1 }];                                        // a checker that is not there
  const r = validateMatch(m);
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => e.code), ['V-LEGAL']);
  assert.ok(!r.errors.some((e) => e.code === 'V-SCORE'), 'no cascade of V-SCORE errors');
});

// ------------------------------------------------------------------------------------------------ fragments: matches recorded from the middle
const BLUEJAY = 'backgammon-studio/Bluejay_-_tester_5pt_Backgammon_Studio_2026_08_16_13_00_36.mat';
/** the text of a match from game `n` on (the header lines before "Game 1" are kept) */
function fragment(rel, n) {
  const lines = read(rel).split(/\r?\n/);
  const first = lines.findIndex((l) => /^\s*Game\s+1\s*$/i.test(l));
  const from = lines.findIndex((l) => new RegExp(`^\\s*Game\\s+${n}\\s*$`, 'i').test(l));
  assert.ok(first > 0 && from >= first);
  return [...lines.slice(0, first), ...lines.slice(from)].join('\n');
}

test('a fragment that starts later is accepted, flagged, and its result is counted from its start score', () => {
  const r = readMatch(fragment(DICE_NO_PLAY, 5));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.match(r.warnings.find((w) => w.code === 'V-PARTIAL').message, /starts with the score already at 8-4 in a 17-point match/);
  assert.deepEqual(r.match.result, { winner: 0, score: [17, 13], finished: true, partial: { startScore: [8, 4] } });
  assert.deepEqual(r.match.games.map((g) => g.startScore)[0], [8, 4]);
  const full = readMatch(read(DICE_NO_PLAY));
  assert.notEqual(contentHash(r.match), contentHash(full.match), 'a fragment is not the whole match');
  assert.equal(full.match.result.partial, undefined, 'a whole match is not marked');
});

test('a fragment is written as normalised .mat and read back identically', () => {
  const r = readMatch(fragment(DICE_NO_PLAY, 5));
  const again = readMatch(writeMat(r.match));
  assert.equal(again.ok, true, JSON.stringify(again.errors));
  assert.equal(contentHash(again.match), contentHash(r.match));
});

test('fragment: the Crawford game is recognised from a start score one point from winning, with no double in it', () => {
  const whole = readMatch(read(BLUEJAY));
  assert.deepEqual(whole.match.games.map((g) => g.crawford), [false, false, false, false, true, false]);
  const r = readMatch(fragment(BLUEJAY, 5));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.match.games.map((g) => g.crawford), [true, false], 'same flags as in the whole match');
  assert.match(r.infos.find((i) => /Crawford/.test(i.message)).message, /taken as the Crawford game/);
});

test('fragment: a double in the first game shows that the Crawford game is behind; no Crawford game follows', () => {
  const r = readMatch(fragment(BLUEJAY, 6));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.match.games.map((g) => g.crawford), [false]);
  assert.match(r.infos.find((i) => /Crawford/.test(i.message)).message, /after the Crawford game/);
  assert.deepEqual(r.match.games[0].startScore, [3, 4]);
});

test('fragment: a gap between two games is an excerpt; a score that goes backwards, a finished score or a money game are still refused', () => {
  const gap = parseMat(fragment(DICE_NO_PLAY, 5));
  gap.games.splice(1, 1);                                                // game 6 is not in the file: the next game starts later than game 5 ends
  const r1 = validateMatch(gap);
  assert.equal(r1.ok, true, JSON.stringify(r1.errors));
  assert.ok(r1.warnings.some((w) => w.code === 'V-PARTIAL' && /^Game 7 starts at \d+-\d+ but game 5 ended at \d+-\d+/.test(w.message)));
  assert.equal(r1.match.result.partial.gaps.length, 1);
  const back = parseMat(fragment(DICE_NO_PLAY, 5));
  back.games[1].startScore = [7, 9];
  assert.ok(validateMatch(back).errors.some((e) => e.code === 'V-SCORE' && /Game 6 starts at 7-9/.test(e.message)), 'a score cannot go down (games keep the numbers of the file)');
  const over = parseMat(fragment(DICE_NO_PLAY, 5));
  over.games[0].startScore = [17, 4];
  assert.ok(validateMatch(over).errors.some((e) => /Game 5 starts at 17-4/.test(e.message)), 'the match was already over');
  const money = parseMat(read('xg-text/me-XG_Roller__03-10-2026.txt'));
  money.games[0].startScore = [3, 1];
  assert.ok(validateMatch(money).errors.some((e) => /Game 1 starts at 3-1/.test(e.message)), 'a money game has no score');
});
