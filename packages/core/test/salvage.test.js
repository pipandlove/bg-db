/**
 * bgdb ingest --salvage (bulk imports of old archives, docs/partial-matches.md): keep what is clear of a match that fails.
 *   match play: a game whose moves cannot be read is kept by its result when two sources confirm it, else left out; the winner of the
 *               match must stay known
 *   money session: unreadable games are left out
 * Without salvage nothing changes: the errors are reported so that a contributor can fix the file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMat, validateMatch, matchHash16, writeMat, readMatch } from '../src/index.js';
import { read } from './helpers.js';

const MATCH = 'extmatchdb/game-ends-dice-without-play_17pt.txt';       // 17 points, 12 games, every game with a Wins line
const SALVAGE = { salvage: true };
/** game gi (0-based) gets a play that cannot be made: its first play goes from the 24 point to the 10 point */
const breakGame = (m, gi) => { m.games[gi].actions.find((a) => a.kind === 'move' && a.moves.length).moves = [{ from: 24, to: 10 }]; return m; };

test('without salvage a game that cannot be read is an error, as before', () => {
  assert.equal(validateMatch(breakGame(parseMat(read(MATCH)), 3)).ok, false);
});

test('salvage: a game that cannot be read and whose result is confirmed is kept by its result; the identity covers that result', () => {
  const m = breakGame(parseMat(read(MATCH)), 3);
  const r = validateMatch(m, SALVAGE);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.match.games.length, 12, 'the match stays complete');
  assert.equal(r.match.games[3].resultOnly, true);
  assert.ok(r.warnings.some((d) => d.code === 'V-PARTIAL' && /^Game 4: the moves cannot be read .*the result is confirmed by the score of game 5/.test(d.message)), JSON.stringify(r.warnings));
  assert.deepEqual(r.match.result.score, validateMatch(parseMat(read(MATCH))).match.result.score, 'the real final score');
  const other = parseMat(read(MATCH));
  other.games[3].declared.points += 0;                                   // same file: same identity
  assert.equal(matchHash16(validateMatch(breakGame(other, 3), SALVAGE).match), matchHash16(r.match));
  // the normalised .mat says which game is kept by its result, and reads back as the same match without salvage
  const back = readMatch(writeMat(r.match));
  assert.equal(back.ok, true, JSON.stringify(back.errors));
  assert.equal(matchHash16(back.match), matchHash16(r.match));
});

test('salvage: an unreadable game whose result is not confirmed is left out (the next game starts from its own score)', () => {
  const m = breakGame(parseMat(read(MATCH)), 3);
  delete m.games[3].declared;                                            // no Wins line: the result is not known
  const r = validateMatch(m, SALVAGE);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.match.games.length, 11);
  assert.ok(r.warnings.some((d) => /^Game 4: the moves cannot be read .*the game is left out/.test(d.message)));
  assert.equal(r.match.result.finished, true, 'the winner of the match is still known');
});

test('salvage refuses when the winner of the match would not be known, when nothing is readable, or when a score contradicts the file', () => {
  const last = breakGame(parseMat(read(MATCH)), 11);
  delete last.games[11].declared;
  assert.equal(validateMatch(last, SALVAGE).ok, false, 'the last game is lost: who won the match?');
  const all = parseMat(read(MATCH));
  all.games.forEach((g, gi) => breakGame(all, gi));
  assert.equal(validateMatch(all, SALVAGE).ok, false, 'nothing to replay');
  const clash = parseMat(read(MATCH));
  clash.games[3].declared.winner = 1 - clash.games[3].declared.winner;  // a winner that contradicts the moves: not a matter of reading
  assert.equal(validateMatch(clash, SALVAGE).ok, false);
});

test('salvage, money session: an unreadable game is left out and said so; the others are kept', () => {
  const m = parseMat(read(MATCH));
  m.matchLength = 0;
  for (const g of m.games) { g.crawford = false; if (g.declared) g.declared.matchEnd = false; }   // a money session keeps a running total
  assert.equal(validateMatch(structuredClone(m)).ok, true, 'a valid money session to start with');
  const r = validateMatch(breakGame(m, 3), SALVAGE);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.match.games.length, 11);
  assert.ok(r.warnings.some((d) => /^Game 4: the moves cannot be read .*the game is left out/.test(d.message)));
});
