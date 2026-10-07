/**
 * How a game ends when there is no bear-off and no drop (docs/game-endings.md):
 *   body       the plays, replayed strictly
 *   tail       at most one last roll that may be junk, then only hidden plays; allowed only when the Wins line settles the game
 *   settlement the Wins line against the ledger (the score at the start of the next game, the end of the match)
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
import { toBgdbJson } from '../src/record.js';
import { FIXTURES } from './helpers.js';

const read = (rel) => fs.readFileSync(path.join(FIXTURES, rel), 'utf8');
const CUT_DIE = 'extmatchdb/game-ends-play-cut-after-one-die.mat';        // game 3 ends: finch4 rolls 64, plays 22/16 only, Wins 4 points for wren_87
const HIDDEN_ROWS = 'extmatchdb/hidden-play-and-empty-rows_13pt.txt';
const fresh = () => parseMat(read(CUT_DIE));
const BASE = contentHash(validateMatch(fresh()).match);
const lastOf = (g) => g.actions[g.actions.length - 1];
const unrolled = (side, row) => ({ side, kind: 'move', dice: [0, 0], moves: [], hidden: true, unrolled: true, row });

// ------------------------------------------------------------------------------------------------ the tail
const TAILS = {
  'dice and nothing played': (g) => { lastOf(g).moves = []; },
  'dice and a prefix of a legal play': () => {},
  'dice and moves that cannot be played': (g) => { lastOf(g).moves = [{ from: 22, to: 15 }]; },
  'dice and moves of a checker that is not there': (g) => { lastOf(g).moves = [{ from: 3, to: 1 }]; },
  'nothing rolled (00:)': (g) => { g.actions[g.actions.length - 1] = unrolled(0, lastOf(g).row); },
  'hidden play (????)': (g) => { Object.assign(lastOf(g), { moves: [], hidden: true }); },
  'a numbered row with nothing in it (no action at all)': (g) => { g.actions.pop(); },
  'a roll, then an empty slot of the other player': (g) => { g.actions.push(unrolled(1, 41)); },
};

for (const [name, mutate] of Object.entries(TAILS)) {
  test(`tail: ${name} -> the Wins line settles the game, and the identity is the same`, () => {
    const m = fresh();
    mutate(m.games[2]);
    const r = validateMatch(m);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(r.match.games[2].result, { winner: 1, points: 4, kind: 'single', how: 'resign', cube: 2 });
    assert.deepEqual(r.match.result, { winner: 1, score: [0, 11], finished: true });
    assert.equal(contentHash(r.match), BASE, 'whatever the site wrote in the last slot, the match is the same match');
    const back = readMatch(writeMat(r.match));                           // and the normalised file reads back to it
    assert.equal(back.ok, true, JSON.stringify(back.errors));
    assert.equal(contentHash(back.match), BASE);
  });
}

test('tail: moves that cannot be played are dropped with a warning (data is lost, so it is not only an info)', () => {
  const m = fresh();
  TAILS['dice and moves that cannot be played'](m.games[2]);
  const r = validateMatch(m);
  const w = r.warnings.find((x) => /not a possible play/.test(x.message));
  assert.ok(w, 'a warning names the dropped play');
  assert.match(w.message, /finch4 \(64: 22\/15\).*wren_87 wins/);
  assert.deepEqual(lastOf(r.match.games[2]).moves, []);
});

test('tail: the roller can be the winner (the opponent resigned in the middle of the turn)', () => {
  const m = fresh();
  const g = m.games[2];
  lastOf(g).moves = [{ from: 22, to: 16 }, { from: 16, to: 12 }];        // finch4 plays a complete legal 64
  g.actions.push({ side: 1, kind: 'move', dice: [6, 5], moves: [], row: 41 });   // wren_87 rolls 65 and nothing is played: the game stops
  const r = validateMatch(m);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.match(r.infos.find((x) => /wren_87 rolled 65 and played nothing/.test(x.message)).message, /wren_87 wins/);
});

test('tail: it takes a Wins line, a LAST roll and only hidden plays after it; otherwise the same text is an error', () => {
  const noWins = fresh(); noWins.games[2].declared = null;
  assert.equal(validateMatch(noWins).ok, false, 'no Wins line: the game is not settled');
  const notLast = fresh(); notLast.games[2].actions.push({ side: 1, kind: 'move', dice: [1, 1], moves: [], row: 41 });
  assert.equal(validateMatch(notLast).ok, false, 'a real roll after it: it is not a tail');
  const middle = fresh();
  const mv = middle.games[2].actions.filter((a) => a.kind === 'move' && a.moves.length > 1)[3];
  mv.moves = [{ from: 3, to: 1 }];
  const r = validateMatch(middle);
  assert.equal(r.ok, false, 'a wrong play in the middle of the game is never tolerated');
  assert.equal(r.errors[0].code, 'V-LEGAL');
});

test('tail: an empty slot after a game that was won by bear-off or drop is ignored', () => {
  const m = parseMat(read(HIDDEN_ROWS));
  const g = m.games[7];                                                  // game 8: Sage bears off, "Wins 4 point"
  g.actions.push(unrolled(1, g.actions.length));
  const r = validateMatch(m);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.match.games[7].result.how, 'bearOff');
});

// ------------------------------------------------------------------------------------------------ the settlement
test('ledger: the start score of each game is trusted: a Wins line that falls short of it is read as games missing, and says so', () => {
  const m = fresh();
  m.games[2].declared.points = 2;                                       // the next game starts at 0-7: 2 more points than the Wins line explains
  const r = validateMatch(m);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const w = r.warnings.find((x) => /Game 4 starts at 0-7 but game 3 ended at 0-5/.test(x.message));
  assert.ok(w, 'the gap is reported');
  assert.match(w.message, /the Wins line of game 3 says wren_87 wins 2 point\(s\)/);
  assert.match(w.hint, /the Wins line of the previous game is wrong/);
  assert.deepEqual(r.match.result.partial.gaps, [{ before: 4, from: [0, 5], to: [0, 7] }]);
});

test('ledger: a score that goes BACKWARDS, or reaches the match length, is never a gap: it is an error that names the Wins line', () => {
  const tooMuch = fresh();
  tooMuch.games[2].declared.points = 6;                                 // the Wins line explains more than the next game's score: the next score looks like it went down
  const r0 = validateMatch(tooMuch);
  assert.equal(r0.ok, false);
  assert.match(r0.errors.find((x) => x.code === 'V-SCORE').message, /Game 4 starts at 0-7 but the previous games add up to 0-9; the Wins line of game 3 says wren_87 wins 6 point\(s\)/);
  const behind = fresh();
  behind.games[3].startScore = [0, 4];                                  // 0-4 after a game that ended at 0-7
  assert.equal(validateMatch(behind).ok, false);
  const over = fresh();
  over.games[3].startScore = [0, 11];                                   // the match is 11 points: a game cannot start at 11
  assert.equal(validateMatch(over).ok, false);
});

test('ledger: with no Wins line at all (a hidden play ends the game) the next game\'s score says what the game was worth', () => {
  const m = parseMat(read(HIDDEN_ROWS));
  m.games[14].declared = null;                                          // game 15 ends with QX's "65: ????"; game 16 starts one point higher for Sage
  const r = validateMatch(m);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.match.games[14].result.points, 1);
  assert.match(r.infos.find((x) => /no points are written/.test(x.message)).message, /1 taken from the score at the start of game 16/);
});

test('ledger: points that the moves contradict are an error; when the next game\'s score agrees with the file, the message says so', () => {
  const trunc = () => { const m = parseMat(read(HIDDEN_ROWS)); m.games = m.games.slice(0, 9); return m; };
  const alone = trunc(); alone.games[7].declared.points = 2;
  const r1 = validateMatch(alone);
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => /Game 8: the file says 2 point\(s\) but the moves give 4$/.test(e.message)));
  const both = trunc(); both.games[7].declared.points = 2; both.games[8].startScore = [3, 8];
  const r2 = validateMatch(both);
  assert.equal(r2.ok, false, 'two lines of the file agreeing is not enough to override the moves');
  const e = r2.errors.find((x) => /Game 8: the file says 2/.test(x.message));
  assert.match(e.message, /game 9 starts at 3-8, which agrees with the file/);
  assert.match(e.hint, /a play of this game may be missing or misread/);
});

test('ledger: a double that nobody answered, with the doubler named as the winner, is a drop', () => {
  const m = parseMat(read(HIDDEN_ROWS));
  const g = m.games[0];
  g.actions.splice(g.actions.findIndex((a) => a.kind === 'drop'), 1);
  const r = validateMatch(m);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.match.games[0].result.how, 'drop');
  assert.match(r.infos.find((x) => /not answered/.test(x.message)).message, /Sage wins/);
});

test('ledger: a Wins line that says "and the match" in a match that is not over is reported', () => {
  const m = parseMat(read('extmatchdb/game-ends-dice-without-play_17pt.txt'));
  m.games.pop();
  m.games[m.games.length - 1].declared.matchEnd = true;
  const r = validateMatch(m);
  assert.ok(r.warnings.some((x) => /says the match ends with game 11, but the score is 15-13 in a 17-point match/.test(x.message)));
});

// ------------------------------------------------------------------------------------------------ the text of the file
test('Sage vs QX (Backgammon Studio): "00:" slots, Wins lines in the place of a move, empty rows -> a valid match', () => {
  const r = readMatch(read(HIDDEN_ROWS));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.match.games.length, 16);
  assert.deepEqual(r.match.result, { winner: 1, score: [9, 14], finished: true });
  const g9 = r.match.games[8];
  assert.deepEqual([g9.result.winner, g9.result.points, g9.result.how], [0, 1, 'resign']);
  assert.equal(g9.actions.filter((a) => a.unrolled).length, 1);
  assert.deepEqual(r.match.games.map((g) => g.result.how), ['drop', 'drop', 'drop', 'bearOff', 'drop', 'drop', 'bearOff', 'bearOff', 'resign', 'drop', 'bearOff', 'drop', 'drop', 'drop', 'resign', 'bearOff']);
});

test('"00:" in the text: with or without "????", the same match; and the slot can be removed altogether', () => {
  const text = read(HIDDEN_ROWS);
  const base = contentHash(readMatch(text).match);
  for (const variant of [text.replace('00: ????', '00:'), text.replace('00: ????', '00: ').replace(/00: \s*\r?\n/, '00:\n'), text.replace(/ +00: \?\?\?\?/, '')]) {
    const r = readMatch(variant);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(contentHash(r.match), base);
  }
  assert.equal(contentHash(readMatch(writeMat(readMatch(text).match)).match), base, 'the normalised file is the same match');
});

test('the replay data flags the roll where a game stopped', () => {
  const r = validateMatch(fresh());
  const j = toBgdbJson(r.match, { id: '0001/x', sides: r.match.sides });
  const acts = j.games[2].actions;
  assert.deepEqual([acts[acts.length - 1].ab, acts[acts.length - 1].d, acts[acts.length - 1].m], [1, [6, 4], [[22, 16, 0]]]);
  assert.equal(j.games[0].actions.some((a) => a.ab), false);
});

// ------------------------------------------------------------------------------------------------ every real resignation, mutated
test('every resignation of every text fixture survives a junk tail: same result, same identity (and still valid when a real last roll is garbled)', async () => {
  const { allTextFixtures } = await import('./helpers.js');
  let games = 0;
  for (const [file, text] of allTextFixtures()) {
    if (/\.sgf$/i.test(file)) continue;
    const whole = validateMatch(parseMat(text));
    if (!whole.ok) continue;
    const base = contentHash(whole.match);
    whole.match.games.forEach((g, gi) => {
      if (g.result.how !== 'resign') return;
      games++;
      const run = (mutate) => { const m = parseMat(text); const r = mutate(m.games[gi]); return r === false ? null : validateMatch(m); };
      const slot = (g2) => { const l = lastOf(g2); g2.actions.push(unrolled(1 - l.side, 99)); };
      const asUnrolled = (g2) => { const l = lastOf(g2); if (!(l.kind === 'move' && l.hidden)) return false; l.dice = [0, 0]; l.unrolled = true; };
      const junk = (g2) => { const l = lastOf(g2); if (!(l.kind === 'move' && !l.hidden)) return false; l.moves = [{ from: 3, to: 1 }]; };
      for (const [what, mutate, strict] of [['an empty slot after the end', slot, true], ['"00:" instead of "????"', asUnrolled, true], ['a garbled last roll', junk, false]]) {
        const r = run(mutate);
        if (!r) continue;
        assert.equal(r.ok, true, `${file} game ${gi + 1}, ${what}: ${JSON.stringify(r.errors.map((e) => e.message))}`);
        assert.equal(r.match.games[gi].result.how, 'resign', `${file} game ${gi + 1}, ${what}`);
        assert.equal(r.match.games[gi].result.points, g.result.points, `${file} game ${gi + 1}, ${what}`);
        if (strict) assert.equal(contentHash(r.match), base, `${file} game ${gi + 1}, ${what}`);
      }
    });
  }
  assert.ok(games >= 20, `${games} resignations were tried`);
});

test('evidence: in every text fixture the Wins line agrees with the next game\'s start score, except where the validator reports a gap (an excerpt)', async () => {
  const { allTextFixtures } = await import('./helpers.js');
  let pairs = 0;
  const excerpts = [];
  for (const [file, text] of allTextFixtures()) {
    if (/\.sgf$/i.test(file)) continue;
    const m = parseMat(text);
    const gaps = validateMatch(parseMat(text)).match.result?.partial?.gaps ?? [];
    for (let i = 0; i + 1 < m.games.length; i++) {
      const d = m.games[i].declared;
      const next = m.games[i + 1].startScore;
      const cur = m.games[i].startScore;
      if (!d) continue;                                                  // a game whose plays are lost may have no declared line in an odd file
      const agrees = next[d.winner] - cur[d.winner] === d.points && next[1 - d.winner] === cur[1 - d.winner];
      assert.equal(agrees, !gaps.some((x) => x.before === i + 2), `${file} game ${i + 1}: the Wins line and the next start score ${agrees ? 'agree' : 'disagree'}, and the validator ${agrees ? 'reports' : 'does not report'} a gap there`);
      if (!agrees) excerpts.push(file);
      pairs++;
    }
  }
  assert.ok(pairs >= 100, `${pairs} game pairs`);
  assert.deepEqual([...new Set(excerpts)], ['extmatchdb/excerpt-games-missing_19pt.mat'], 'the only excerpt among the fixtures');
});
